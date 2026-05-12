import { buildDraftOrderPayload, buildFinalOrderPayload, normalizeNotes, normalizePhone } from '../builders/orderPayload.js';
import { buildQueueFileName, writeQueueFile } from '../queue/fs.js';
import logger from '../lib/logger.js';
import { resolveCatalogEntryForItem } from '../catalog/menuPricing.js';

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

  if (normalized === 'go_ngupi' || (normalized.includes('ngupi') && normalized.includes('express'))) return 'ngupi_express';
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
  if (normalized.includes('caffe latte') || normalized.includes('cafe latte') || normalized.includes('kopi latte')) {
    return 'caffe-latte';
  }
  if (normalized.includes('cappuccino')) return 'cappuccino';
  if (normalized.includes('matcha')) return 'matcha-latte';
  if (normalized.includes('chocolate') || normalized.includes('coklat') || normalized.includes('cokelat')) {
    return 'chocolate';
  }
  if (normalized === 'teh' || normalized.includes('tea')) return 'teh';

  return fallback;
}

function normalizeItems(items = []) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      if (!item) return null;

      const catalogEntry = resolveCatalogEntryForItem(item);
      const menuName = item.menuName ?? item.menu_name ?? item.name ?? catalogEntry?.name ?? null;
      const qtyRaw = Number(item.qty ?? item.quantity ?? item.count ?? 0);
      const qty = Math.trunc(qtyRaw);
      const incomingPrice = Number(item.price ?? item.unitPrice ?? item.unit_price);
      const price = Number.isFinite(incomingPrice) && incomingPrice > 0
        ? Math.round(incomingPrice)
        : (catalogEntry?.price ?? null);

      const explicitMenuId = item.menuId ?? item.menu_id ?? null;
      const menuId = explicitMenuId ?? catalogEntry?.menuId ?? inferMenuId(menuName, null);

      if ((!menuName && !menuId) || !Number.isFinite(qtyRaw) || qty <= 0) return null;

      return {
        menuId,
        menuName: menuName ?? catalogEntry?.name ?? menuId,
        qty,
        price,
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
    if (context.paymentMethod === 'cod' || context.paymentMethod === 'cash_at_counter') {
      return true; // Pickup COD/kasir — push immediately
    }
    return context.paymentStatus === 'confirmed';
  }

  if (context.fulfillmentMethod === 'delivery') {
    if (context.paymentMethod === 'cod') {
      return true; // COD delivery — push immediately (kurir collect cash)
    }
    return context.paymentStatus === 'confirmed';
  }

  if (context.fulfillmentMethod === 'dine_in') {
    if (context.paymentMethod === 'cash_at_counter') {
      return true; // Always push to Pawoon (barista sees every order, printer fires)
    }
    return context.paymentStatus === 'confirmed'; // QRIS paid
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

const QRIS_COOLDOWN_MS = 60 * 1000; // 60s cooldown — enough to prevent spam, allows quick resend

function shouldAutoCreateQris(state) {
  // If using Doku as QRIS provider, skip evaluator auto-create
  // sync-state.js handles Doku QRIS generation directly
  if ((process.env.QRIS_PROVIDER || 'pakasir') === 'doku') return false;

  const context = state.orderContext ?? {};
  if (!state.draftSentAt) return false;
  if (!context.clientOrderId) return false;
  if (context.paymentMethod !== 'qris') return false;
  if (!['pending', 'waiting', 'awaiting_payment'].includes(context.paymentStatus)) return false;
  return true;
}

async function maybeAutoCreateQris(state, events) {
  const context = state.orderContext ?? {};
  const clientOrderId = context.clientOrderId;

  if (!clientOrderId) return null;

  // Check cooldown first to avoid unnecessary DB lookups
  if (state.lastQrisSentAt) {
    const elapsed = Date.now() - new Date(state.lastQrisSentAt).getTime();
    if (elapsed < QRIS_COOLDOWN_MS) {
      logger.info('[evaluator] Skipping QRIS — dedup cooldown (%ds elapsed, %ds remaining)',
        Math.floor(elapsed / 1000), Math.floor((QRIS_COOLDOWN_MS - elapsed) / 1000));
      return { deduplicated: true, skipped: true };
    }
  }

  // Skip if evaluator is not needed — /qris/direct endpoint handles payment creation and WhatsApp
  // Evaluator auto-create only needed when order comes from queue/draft (not from /qris/direct)
  if (state.qrisAutoCreateResult) {
    const expiredAt = state.qrisAutoCreateResult.payment?.expired_at;
    if (expiredAt && new Date(expiredAt) < new Date()) {
      logger.info('[evaluator] Previous QRIS auto-create result expired, allowing new generation');
      delete state.qrisAutoCreateResult;
    } else {
      return { skipped: true, reason: 'already_handled_by_endpoint' };
    }
  }

  if (!shouldAutoCreateQris(state)) {
    return null;
  }

  try {
    // Lazy import to avoid circular dependency
    const { createPakasirQrisPayment } = await import('../payments/service.js');

    let skipWhatsApp = false;
    let result;
    try {
      result = await createPakasirQrisPayment({ clientOrderId, skipWhatsApp });
    } catch (firstError) {
      // Order may not be persisted yet when called from bridge evaluator.
      if (String(firstError?.message || '').includes('Order not found for client_order_id=')) {
        const { processAllQueues } = await import('../queue/processor.js');
        await processAllQueues();
        result = await createPakasirQrisPayment({ clientOrderId, skipWhatsApp });
      } else {
        throw firstError;
      }
    }

    // Mark lastQrisSentAt so we don't spam WhatsApp within the cooldown window
    state.lastQrisSentAt = new Date().toISOString();
    
    // Check WhatsApp delivery status and surface failures
    const waDelivery = result?.whatsapp_qris_delivery;
    if (waDelivery && !waDelivery.ok) {
      logger.warn('[evaluator] QRIS created but WhatsApp delivery failed for %s: %s (reason: %s)',
        clientOrderId, waDelivery.error, waDelivery.reason);
      state.qrisDeliveryFailed = true;
      state.qrisDeliveryError = waDelivery.error || waDelivery.reason || 'whatsapp_delivery_failed';
    } else {
      state.qrisDeliveryFailed = false;
      state.qrisDeliveryError = null;
    }
    
    logger.info('[evaluator] Auto-created QRIS payment for %s (lastQrisSentAt=%s, whatsappSent=%s)',
      clientOrderId, state.lastQrisSentAt, waDelivery?.ok === true);
    events.push({ type: 'qris_payment_created', clientOrderId, paymentId: result.payment?.id, whatsappSent: waDelivery?.ok === true });
  } catch (error) {
    logger.error('[evaluator] Failed to auto-create QRIS payment: %s', error.message);
    state.qrisDeliveryFailed = true;
    state.qrisDeliveryError = error.message;
    return { error: error.message };
  }
}

export async function evaluateAndEnqueue(state) {
  const events = [];
  state.orderContext = mergeOrderContext({}, state.orderContext ?? {});

  if (isDraftReady(state) && !state.finalSentAt) {
    const payload = buildDraftOrderPayload(state.orderContext);
    state.orderContext.clientOrderId = payload.order.client_order_id;
    const queued = await enqueuePayload(payload);
    state.draftSentAt = state.draftSentAt || new Date().toISOString();
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
