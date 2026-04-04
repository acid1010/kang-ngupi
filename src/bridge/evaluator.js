import { buildDraftOrderPayload, buildFinalOrderPayload, normalizeNotes, normalizePhone } from '../builders/orderPayload.js';
import { buildQueueFileName, writeQueueFile } from '../queue/fs.js';
import { getPaymentByClientOrderId } from '../repositories/payments.js';

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeFulfillmentMethod(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();

  if (['delivery', 'deliv', 'deliver'].includes(normalized)) return 'delivery';
  if (['pickup', 'pick_up', 'self_pickup', 'self-pickup', 'self pickup'].includes(normalized)) {
    return 'self_pickup';
  }

  return normalized;
}

function normalizePaymentMethod(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();

  if (normalized === 'cash on delivery') return 'cod';
  if (['cod', 'qris', 'transfer'].includes(normalized)) return normalized;

  return normalized;
}

function normalizePaymentStatus(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();

  if (['paid', 'confirmed', 'success', 'settled'].includes(normalized)) return 'confirmed';
  if (['pending_on_delivery', 'pay_on_delivery', 'cod_pending'].includes(normalized)) return 'pending_on_delivery';
  if (['pending', 'waiting', 'awaiting_payment'].includes(normalized)) return 'pending';

  return normalized;
}

function normalizeDeliveryProvider(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');

  if (normalized.includes('ngupi') && normalized.includes('express')) return 'ngupi_express';
  if (normalized.includes('grab')) return 'grab';
  if (normalized.includes('gojek') || normalized.includes('gocar') || normalized.includes('goride')) return 'gojek';

  return normalized;
}

function normalizeLocationStatus(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');

  if (normalized.includes('shareloc')) return 'shareloc_received';
  if (normalized.includes('address')) return 'address_received';

  return normalized;
}

function normalizeTemperature(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();

  if (['ice', 'iced', 'cold', 'dingin'].includes(normalized)) return 'iced';
  if (['hot', 'warm', 'panas'].includes(normalized)) return 'hot';

  return normalized;
}

function inferMenuId(menuName, fallback = null) {
  if (!menuName) return fallback;
  const normalized = String(menuName).trim().toLowerCase();

  if (normalized.includes('kopi susu')) return 'kopi-susu-original';
  if (normalized.includes('americano')) return 'americano';
  if (normalized.includes('latte')) return 'caffe-latte';
  if (normalized.includes('cappuccino')) return 'cappuccino';

  return fallback;
}

function normalizeItems(items = []) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      if (!item) return null;

      const menuName = item.menuName ?? item.menu_name ?? item.name ?? null;
      const qty = Number(item.qty ?? item.quantity ?? item.count ?? 0);

      if (!menuName || !Number.isFinite(qty) || qty <= 0) return null;

      return {
        menuId: item.menuId ?? item.menu_id ?? inferMenuId(menuName, null),
        menuName,
        qty,
        temperature: normalizeTemperature(item.temperature ?? item.temp ?? null),
        notes: item.notes ?? null
      };
    })
    .filter(Boolean);
}

function parseSharelocFromString(value) {
  const text = String(value).trim();
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);

  if (!match) {
    return null;
  }

  return {
    lat: Number(match[1]),
    lng: Number(match[2]),
    label: null,
    source: 'whatsapp'
  };
}

function normalizeShareloc(shareloc, existingShareloc = null) {
  if (!shareloc) return existingShareloc ?? null;

  if (typeof shareloc === 'string') {
    return parseSharelocFromString(shareloc) ?? existingShareloc ?? null;
  }

  if (Array.isArray(shareloc) && shareloc.length >= 2) {
    const lat = toFiniteNumber(shareloc[0]);
    const lng = toFiniteNumber(shareloc[1]);

    if (lat !== null && lng !== null) {
      return {
        lat,
        lng,
        label: null,
        source: 'whatsapp'
      };
    }

    return existingShareloc ?? null;
  }

  if (typeof shareloc === 'object') {
    const joinedString = Object.keys(shareloc).every((key) => /^\d+$/.test(key))
      ? Object.values(shareloc).join('')
      : null;

    if (joinedString) {
      return parseSharelocFromString(joinedString) ?? existingShareloc ?? null;
    }

    const lat = toFiniteNumber(shareloc.lat ?? shareloc.latitude ?? shareloc.y ?? null);
    const lng = toFiniteNumber(shareloc.lng ?? shareloc.lon ?? shareloc.longitude ?? shareloc.x ?? null);

    if (lat !== null && lng !== null) {
      return {
        lat,
        lng,
        label: shareloc.label ?? shareloc.name ?? existingShareloc?.label ?? null,
        source: shareloc.source ?? existingShareloc?.source ?? 'whatsapp'
      };
    }
  }

  return existingShareloc ?? null;
}

function hasValidItems(items) {
  return Array.isArray(items) && items.some((item) => item && item.menuName && Number(item.qty) > 0);
}

function buildStableRawMessage(items = [], fallback = null) {
  if (!Array.isArray(items) || items.length === 0) {
    return fallback ?? null;
  }

  const parts = items
    .filter((item) => item && item.menuName && Number(item.qty) > 0)
    .map((item) => `${String(item.menuName).trim().toLowerCase()} ${Number(item.qty)}`);

  return parts.length > 0 ? parts.join(', ') : (fallback ?? null);
}

function hasShareloc(context) {
  return Boolean(
    context.locationStatus === 'shareloc_received' &&
      context.shareloc &&
      typeof context.shareloc.lat === 'number' &&
      typeof context.shareloc.lng === 'number'
  );
}

export function isDraftReady(state) {
  const context = state.orderContext ?? {};

  if (!context.customerName) return false;
  if (!context.customerPhone) return false;
  if (!context.rawMessage) return false;
  if (!hasValidItems(context.items)) return false;
  if (!context.fulfillmentMethod) return false;

  if (context.fulfillmentMethod === 'delivery' && !hasShareloc(context)) {
    return false;
  }

  return true;
}

export function isFinalReady(state) {
  if (!state.draftSentAt) return false;
  if (!isDraftReady(state)) return false;

  const context = state.orderContext ?? {};

  if (!context.paymentMethod) return false;

  if (context.fulfillmentMethod === 'self_pickup') {
    return context.paymentStatus === 'confirmed';
  }

  if (context.fulfillmentMethod === 'delivery') {
    if (context.paymentMethod === 'cod') {
      return Boolean(context.deliveryProvider);
    }

    return context.paymentStatus === 'confirmed';
  }

  return false;
}

export function mergeOrderContext(existing = {}, updates = {}) {
  const incomingItems = Array.isArray(updates.items) ? normalizeItems(updates.items) : null;
  const normalizedShareloc = updates.shareloc !== undefined
    ? normalizeShareloc(updates.shareloc, normalizeShareloc(existing.shareloc ?? null, null))
    : normalizeShareloc(existing.shareloc ?? null, null);

  const next = {
    ...existing,
    ...updates,
    clientOrderId:
      updates.clientOrderId ??
      updates.client_order_id ??
      existing.clientOrderId ??
      existing.client_order_id ??
      null,
    customerName: updates.customerName ?? existing.customerName ?? null,
    customerPhone: normalizePhone(updates.customerPhone ?? existing.customerPhone ?? null),
    rawMessage: existing.rawMessage ?? updates.rawMessage ?? existing.rawMessage ?? null,
    fulfillmentMethod: normalizeFulfillmentMethod(updates.fulfillmentMethod ?? existing.fulfillmentMethod ?? null),
    locationStatus: normalizeLocationStatus(updates.locationStatus ?? existing.locationStatus ?? null),
    paymentMethod: normalizePaymentMethod(updates.paymentMethod ?? existing.paymentMethod ?? null),
    paymentStatus: normalizePaymentStatus(updates.paymentStatus ?? existing.paymentStatus ?? null),
    deliveryProvider: normalizeDeliveryProvider(updates.deliveryProvider ?? existing.deliveryProvider ?? null),
    status: updates.status ?? existing.status ?? 'draft',
    items: incomingItems ?? normalizeItems(existing.items ?? []),
    shareloc: normalizedShareloc,
    address: updates.address ?? existing.address ?? null,
    channel: updates.channel ?? existing.channel ?? 'whatsapp',
    notes: normalizeNotes([...(existing.notes ?? []), ...(updates.notes ?? [])])
  };

  if (!next.locationStatus && next.shareloc) {
    next.locationStatus = 'shareloc_received';
  }

  if (hasValidItems(next.items)) {
    next.rawMessage = buildStableRawMessage(next.items, next.rawMessage);
  }

  return next;
}

async function enqueuePayload(payload) {
  const queueKind = payload.event_type === 'final_order' ? 'final' : 'draft';
  const fileName = buildQueueFileName(queueKind, payload.order.client_order_id);
  const filePath = await writeQueueFile(queueKind, fileName, payload);
  return { queueKind, filePath, clientOrderId: payload.order.client_order_id };
}

function shouldAutoCreateQris(state) {
  const context = state.orderContext ?? {};
  if (!state.draftSentAt) return false;
  if (!context.clientOrderId) return false;
  if (context.paymentMethod !== 'qris') return false;
  if (!['pending', 'waiting', 'awaiting_payment'].includes(context.paymentStatus)) return false;
  return true;
}

async function maybeAutoCreateQris(state, events) {
  if (!shouldAutoCreateQris(state)) {
    return null;
  }

  const clientOrderId = state.orderContext.clientOrderId;

  try {
    const existingPayment = await getPaymentByClientOrderId(clientOrderId);
    if (existingPayment && ['pending', 'confirmed'].includes(existingPayment.payment_status)) {
      console.log('[evaluator] QRIS payment already exists for', clientOrderId);
      return { skipped: true, reason: 'already-exists', paymentId: existingPayment.id };
    }

    // Lazy import to avoid circular dependency
    const { createPakasirQrisPayment } = await import('../payments/service.js');
    const result = await createPakasirQrisPayment({ clientOrderId });

    console.log('[evaluator] Auto-created QRIS payment for', clientOrderId);
    events.push({ type: 'qris_payment_created', clientOrderId, paymentId: result.payment?.id });

    return result;
  } catch (error) {
    console.error('[evaluator] Failed to auto-create QRIS payment:', error.message);
    return { error: error.message };
  }
}

export async function evaluateAndEnqueue(state) {
  const events = [];
  state.orderContext = mergeOrderContext({}, state.orderContext ?? {});

  if (!state.draftSentAt && isDraftReady(state)) {
    const payload = buildDraftOrderPayload(state.orderContext);
    state.orderContext.clientOrderId = payload.order.client_order_id;
    const queued = await enqueuePayload(payload);
    state.draftSentAt = new Date().toISOString();
    state.orderContext.status = payload.order.status;
    events.push({ type: 'draft_order', ...queued });
  }

  if (!state.finalSentAt && isFinalReady(state)) {
    const payload = buildFinalOrderPayload({
      ...state.orderContext,
      clientOrderId: state.orderContext.clientOrderId,
      status: 'ready_to_submit'
    });
    state.orderContext.clientOrderId = payload.order.client_order_id;
    const queued = await enqueuePayload(payload);
    state.finalSentAt = new Date().toISOString();
    state.orderContext.status = payload.order.status;
    events.push({ type: 'final_order', ...queued });
  }

  // Auto-create QRIS payment if conditions met
  const qrisResult = await maybeAutoCreateQris(state, events);
  if (qrisResult) {
    state.qrisAutoCreateResult = qrisResult;
  }

  return { state, events };
}
