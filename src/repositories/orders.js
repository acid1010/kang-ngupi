import { getSupabase } from '../supabase.js';

function normalizePaymentStatusForDb(value) {
  const normalized = String(value ?? 'pending').trim().toLowerCase();

  if (['confirmed', 'paid', 'success', 'settled'].includes(normalized)) return 'confirmed';
  if (['failed', 'expired', 'rejected'].includes(normalized)) return 'failed';
  return 'pending';
}

function mapOrderRow(row, items = []) {
  return {
    id: row.id,
    client_order_id: row.client_order_id,
    customer_id: row.customer_id,
    customer_name_snapshot: row.customer_name_snapshot,
    customer_phone_snapshot: row.customer_phone_snapshot,
    channel: row.channel,
    raw_message: row.raw_message,
    fulfillment_method: row.fulfillment_method,
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    order_status: row.order_status,
    location_status: row.location_status,
    location_lat: row.location_lat,
    location_lng: row.location_lng,
    location_label: row.location_label,
    delivery_provider: row.delivery_provider,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    items
  };
}

export async function upsertCustomer(customer = {}) {
  const supabase = getSupabase();
  const payload = {
    name: customer.name ?? null,
    phone: customer.phone,
    display_name: customer.name ?? null,
    last_seen_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('customers')
    .upsert(payload, { onConflict: 'phone' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function createOrUpdateOrder(eventType, order) {
  const supabase = getSupabase();
  const customer = await upsertCustomer(order.customer);

  const orderRow = {
    client_order_id: order.client_order_id,
    customer_id: customer.id,
    customer_name_snapshot: order.customer?.name ?? null,
    customer_phone_snapshot: order.customer?.phone ?? null,
    channel: order.channel ?? 'whatsapp',
    raw_message: order.raw_message ?? null,
    fulfillment_method: order.fulfillment?.method ?? null,
    payment_method: order.payment?.method ?? null,
    payment_status: normalizePaymentStatusForDb(order.payment?.status),
    order_status: order.status ?? (eventType === 'final_order' ? 'ready_to_submit' : 'draft'),
    location_status: order.fulfillment?.location_status ?? null,
    location_lat: order.fulfillment?.shareloc?.lat ?? null,
    location_lng: order.fulfillment?.shareloc?.lng ?? null,
    location_label: order.fulfillment?.shareloc?.label ?? null,
    delivery_provider: order.fulfillment?.delivery_provider ?? null,
    notes: order.notes ?? []
  };

  const { data: savedOrderRows, error: orderError } = await supabase
    .from('orders')
    .upsert(orderRow, { onConflict: 'client_order_id' })
    .select('*');

  if (orderError) throw orderError;

  const savedOrder = Array.isArray(savedOrderRows) ? savedOrderRows[0] : savedOrderRows;
  if (!savedOrder?.id) throw new Error('Failed to persist order');

  await supabase.from('order_items').delete().eq('order_id', savedOrder.id);

  if (Array.isArray(order.items) && order.items.length > 0) {
    const itemRows = order.items.map((item) => ({
      order_id: savedOrder.id,
      menu_id: item.menu_id ?? null,
      menu_name: item.menu_name,
      qty: item.qty,
      temperature: item.temperature ?? null,
      notes: item.notes ?? null
    }));

    const { error: itemError } = await supabase.from('order_items').insert(itemRows);
    if (itemError) throw itemError;
  }

  return getOrderById(savedOrder.id);
}

async function getItemsByOrderIds(orderIds) {
  if (!orderIds.length) return new Map();

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('order_items')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const map = new Map();
  for (const item of data) {
    const list = map.get(item.order_id) ?? [];
    list.push(item);
    map.set(item.order_id, list);
  }

  return map;
}

export async function listOrders() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  const itemsByOrderId = await getItemsByOrderIds(data.map((row) => row.id));
  return data.map((row) => mapOrderRow(row, itemsByOrderId.get(row.id) ?? []));
}

async function getOrderByFilter(column, value) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq(column, value)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error(`Order not found for ${column}=${value}`);
  }

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', row.id)
    .order('created_at', { ascending: true });

  if (itemsError) throw itemsError;
  return mapOrderRow(row, items);
}

export async function getOrderById(id) {
  return getOrderByFilter('id', id);
}

export async function getOrderByClientOrderId(clientOrderId) {
  return getOrderByFilter('client_order_id', clientOrderId);
}

export async function updateOrderPaymentSummary(clientOrderId, updates = {}) {
  const supabase = getSupabase();
  const payload = {
    payment_method: updates.payment_method ?? updates.paymentMethod,
    payment_status: updates.payment_status
      ? normalizePaymentStatusForDb(updates.payment_status)
      : updates.paymentStatus
        ? normalizePaymentStatusForDb(updates.paymentStatus)
        : undefined,
    order_status: updates.order_status ?? updates.orderStatus ?? undefined
  };

  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  const { error } = await supabase
    .from('orders')
    .update(payload)
    .eq('client_order_id', clientOrderId);

  if (error) throw error;
  return getOrderByClientOrderId(clientOrderId);
}
