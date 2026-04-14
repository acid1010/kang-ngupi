import { normalizePhone } from '../builders/orderPayload.js';
import logger from '../lib/logger.js';
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

function shouldResetOrder(state, updates) {
  const ctx = state.orderContext ?? {};
  const hasItems = hasValidIncomingItems(updates);
  // Reset if previous order was finished AND new items arrive
  if (isFinalEnough(state) && hasItems) {
    return true;
  }
  // If we already have a clientOrderId with pending QRIS payment, do NOT reset —
  // preserve the existing QR context so we don't lose the pending payment
  const hasPendingQris = ctx.paymentMethod === 'qris' &&
    ['pending', 'waiting', 'awaiting_payment'].includes(ctx.paymentStatus);
  if (hasPendingQris && ctx.clientOrderId && !state.finalSentAt) {
    return false;
  }
  // Reset if we have a stale pending payment from a previous session AND new items arrive
  if (ctx.paymentMethod === 'qris' && ctx.paymentStatus === 'pending' && !state.finalSentAt && hasItems) {
    return true;
  }
  return false;
}

function shouldStartNewOrder(state, updates) {
  return shouldResetOrder(state, updates);
}

function hasNonPaymentUpdates(updates = {}) {
  const keys = Object.keys(updates);
  if (keys.length === 0) return false;

  const paymentOnlyKeys = new Set(['paymentMethod', 'paymentStatus', 'customerPhone']);
  return keys.some((key) => !paymentOnlyKeys.has(key));
}

function resetForNewOrder(state, customerPhone) {
  const next = createEmptyOrderState(customerPhone);
  const ctx = state.orderContext ?? {};
  next.orderContext.customerName = ctx.customerName ?? null;
  next.orderContext.customerPhone = ctx.customerPhone ?? customerPhone;
  next.orderContext.channel = ctx.channel ?? 'whatsapp';
  // Preserve fulfillment method from previous session
  next.orderContext.fulfillmentMethod = ctx.fulfillmentMethod ?? null;
  next.orderContext.deliveryProvider = ctx.deliveryProvider ?? null;
  // Preserve QRIS payment context if we have an active pending payment
  const hasPendingQris = ctx.paymentMethod === 'qris' &&
    ['pending', 'waiting', 'awaiting_payment'].includes(ctx.paymentStatus);
  if (hasPendingQris && ctx.clientOrderId) {
    next.draftSentAt = state.draftSentAt ?? null;
    next.finalSentAt = state.finalSentAt ?? null;
    next.orderContext.clientOrderId = ctx.clientOrderId;
    next.orderContext.paymentMethod = ctx.paymentMethod;
    next.orderContext.paymentStatus = ctx.paymentStatus;
  }
  return next;
}

export async function upsertOrderContext(customerPhone, updates = {}) {
  await ensureStateDirs();
  await ensureQueueDirs();

  const normalizedPhone = normalizePhone(customerPhone);
  if (!normalizedPhone) {
    throw new Error('invalid customer phone');
  }
  const loadedState = await loadActiveOrderState(normalizedPhone);

  // Deduplicate rapid QRIS calls — if we just set qris and are waiting for WhatsApp delivery,
  // skip creating another QR within 5 seconds
  const isQrisUpdate = updates.paymentMethod === 'qris' && updates.paymentStatus === 'pending';
  const recentQrisSend = loadedState.lastQrisSentAt
    ? Date.now() - new Date(loadedState.lastQrisSentAt).getTime() < 5000
    : false;

  const state = shouldStartNewOrder(loadedState, updates)
    ? resetForNewOrder(loadedState, normalizedPhone)
    : loadedState;

  // Skip no-op duplicate QR bridge calls shortly after the previous send.
  // Keep non-payment updates flowing so state does not lose changes.
  if (isQrisUpdate && recentQrisSend && !hasNonPaymentUpdates(updates)) {
    logger.info('[stateService] Skipping duplicate QRIS bridge call for %s (cooldown active)', normalizedPhone);
    return {
      filePath: null,
      state: loadedState,
      events: [],
      skipQris: true
    };
  }

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
  if (!normalizedPhone) {
    throw new Error('invalid customer phone');
  }
  return loadActiveOrderState(normalizedPhone);
}
