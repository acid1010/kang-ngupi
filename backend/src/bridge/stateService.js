import { normalizePhone } from '../builders/orderPayload.js';
import { ensureQueueDirs } from '../queue/fs.js';
import { createEmptyOrderState, ensureStateDirs, loadActiveOrderState, saveActiveOrderState } from '../state/store.js';
import { evaluateAndEnqueue, mergeOrderContext } from './evaluator.js';

function hasValidIncomingItems(updates = {}) {
  if (!Array.isArray(updates.items)) return false;

  return updates.items.some((item) => {
    if (!item) return false;
    const menuName = item.menuName ?? item.menu_name ?? item.name ?? null;
    const qty = Number(item.qty ?? item.quantity ?? item.count ?? 0);
    return Boolean(menuName) && Number.isFinite(qty) && qty > 0;
  });
}

function isFinalEnough(state = {}) {
  const status = String(state.orderContext?.status ?? '').trim().toLowerCase();
  return Boolean(
    state.finalSentAt || ['ready_to_submit', 'submitted', 'cancelled'].includes(status)
  );
}

function shouldStartNewOrder(state, updates) {
  return isFinalEnough(state) && hasValidIncomingItems(updates);
}

function resetForNewOrder(state, customerPhone) {
  const next = createEmptyOrderState(customerPhone);
  next.orderContext.customerName = state.orderContext?.customerName ?? null;
  next.orderContext.customerPhone = state.orderContext?.customerPhone ?? customerPhone;
  next.orderContext.channel = state.orderContext?.channel ?? 'whatsapp';
  return next;
}

export async function upsertOrderContext(customerPhone, updates = {}) {
  await ensureStateDirs();
  await ensureQueueDirs();

  const normalizedPhone = normalizePhone(customerPhone);
  const loadedState = await loadActiveOrderState(normalizedPhone);
  const state = shouldStartNewOrder(loadedState, updates)
    ? resetForNewOrder(loadedState, normalizedPhone)
    : loadedState;

  state.orderContext = mergeOrderContext(state.orderContext, {
    ...updates,
    customerPhone: normalizedPhone
  });

  const result = await evaluateAndEnqueue(state);
  const filePath = await saveActiveOrderState(normalizedPhone, result.state);

  return {
    filePath,
    state: result.state,
    events: result.events
  };
}

export async function getOrderContextState(customerPhone) {
  await ensureStateDirs();
  const normalizedPhone = normalizePhone(customerPhone);
  return loadActiveOrderState(normalizedPhone);
}
