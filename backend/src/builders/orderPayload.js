function pad(value) {
  return String(value).padStart(2, '0');
}

function localDateTimeSlug(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}-${mi}-${ss}`;
}

export function generateClientOrderId(prefix = 'draft') {
  return `${prefix}_${localDateTimeSlug()}`;
}

export function normalizePhone(phone) {
  if (phone === null || phone === undefined) return null;

  const raw = String(phone).trim();
  if (!raw) return null;

  const compact = raw.replace(/[\s()-]/g, '');
  const hasPlusPrefix = compact.startsWith('+');
  const digits = compact.replace(/\D/g, '');

  if (!digits) return null;
  if (digits.length < 8 || digits.length > 16) return null;

  if (hasPlusPrefix) {
    return `+${digits}`;
  }

  if (digits.startsWith('0')) {
    if (digits.length <= 1) return null;
    return `+62${digits.slice(1)}`;
  }

  if (digits.startsWith('62')) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

export function normalizeNotes(notes = []) {
  if (!Array.isArray(notes)) return [];
  return [...new Set(notes.filter(Boolean).map((note) => String(note).trim()))];
}

export function mapItems(items = []) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      if (!item) return null;

      const menuName = item.menuName ?? item.menu_name ?? item.name ?? null;
      const qtyRaw = Number(item.qty ?? item.quantity ?? item.count ?? 0);
      const qty = Math.trunc(qtyRaw);
      const menuId = item.menuId ?? item.menu_id ?? null;
      const normalizedMenuName = menuName ?? (menuId ? String(menuId) : null);

      if (!normalizedMenuName || !Number.isFinite(qtyRaw) || qty <= 0) {
        return null;
      }

      return {
        menu_id: menuId,
        menu_name: normalizedMenuName,
        qty,
        temperature: item.temperature ?? null,
        notes: item.notes ?? null
      };
    })
    .filter(Boolean);
}

function mapFulfillment(context = {}) {
  const fulfillment = context.fulfillment ?? {};
  const shareloc = fulfillment.shareloc ?? context.shareloc ?? null;

  return {
    method: fulfillment.method ?? context.fulfillmentMethod ?? null,
    location_status: fulfillment.locationStatus ?? fulfillment.location_status ?? context.locationStatus ?? null,
    shareloc: shareloc
      ? {
          lat: shareloc.lat ?? null,
          lng: shareloc.lng ?? null,
          label: shareloc.label ?? null,
          source: shareloc.source ?? 'whatsapp'
        }
      : null,
    delivery_provider:
      fulfillment.deliveryProvider ?? fulfillment.delivery_provider ?? context.deliveryProvider ?? null
  };
}

function normalizePaymentStatusForStorage(value, fallbackStatus = 'pending') {
  const raw = value ?? fallbackStatus;
  if (!raw) return fallbackStatus;

  const normalized = String(raw).trim().toLowerCase();

  if (['confirmed', 'paid', 'success', 'settled'].includes(normalized)) return 'confirmed';
  if (['failed', 'expired', 'rejected'].includes(normalized)) return 'failed';
  if (['pending_on_delivery', 'pay_on_delivery', 'cod_pending', 'pending', 'awaiting_payment', 'waiting'].includes(normalized)) {
    return 'pending';
  }

  return fallbackStatus;
}

function mapPayment(context = {}, fallbackStatus = 'pending') {
  const payment = context.payment ?? {};
  return {
    method: payment.method ?? context.paymentMethod ?? null,
    status: normalizePaymentStatusForStorage(payment.status ?? context.paymentStatus, fallbackStatus)
  };
}

function basePayload(eventType, context = {}) {
  const existingId = context.clientOrderId ?? context.client_order_id ?? null;
  const prefix = eventType === 'final_order' ? 'final' : 'draft';
  const clientOrderId = existingId || generateClientOrderId(prefix);

  return {
    event_type: eventType,
    order: {
      client_order_id: clientOrderId,
      channel: context.channel ?? 'whatsapp',
      customer: {
        name: context.customerName ?? context.customer?.name ?? null,
        phone: normalizePhone(context.customerPhone ?? context.customer?.phone ?? null)
      },
      items: mapItems(context.items),
      fulfillment: mapFulfillment(context),
      payment: mapPayment(context),
      status: context.status ?? (eventType === 'final_order' ? 'ready_to_submit' : 'draft'),
      raw_message: context.rawMessage ?? context.raw_message ?? null,
      notes: normalizeNotes(context.notes)
    }
  };
}

export function buildDraftOrderPayload(context = {}) {
  const payload = basePayload('draft_order', context);
  payload.order.payment = mapPayment(context, 'pending');
  payload.order.status = context.status ?? 'draft';
  return payload;
}

export function buildFinalOrderPayload(context = {}) {
  const payload = basePayload('final_order', context);
  payload.order.payment = mapPayment(context, 'confirmed');
  payload.order.status = context.status ?? 'ready_to_submit';
  return payload;
}

export function generateUniqueClientOrderId(prefix = 'draft') {
  return generateClientOrderId(prefix);
}
