import { getSupabase } from '../supabase.js';

function mapPaymentRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    order_id: row.order_id,
    client_order_id: row.client_order_id,
    provider: row.provider,
    provider_project: row.provider_project,
    provider_order_id: row.provider_order_id,
    amount: row.amount,
    fee: row.fee,
    total_payment: row.total_payment,
    currency: row.currency,
    payment_method: row.payment_method,
    provider_status: row.provider_status,
    payment_status: row.payment_status,
    qr_string: row.qr_string,
    expired_at: row.expired_at,
    paid_at: row.paid_at,
    customer_phone_snapshot: row.customer_phone_snapshot,
    customer_name_snapshot: row.customer_name_snapshot,
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export async function getPaymentById(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('order_payments')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return mapPaymentRow(data);
}

export async function getPaymentByClientOrderId(clientOrderId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('order_payments')
    .select('*')
    .eq('client_order_id', clientOrderId)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return mapPaymentRow(row ?? null);
}

export async function getPaymentByProviderOrderId(providerOrderId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('order_payments')
    .select('*')
    .eq('provider_order_id', providerOrderId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  return mapPaymentRow(data);
}

export async function upsertPaymentSession(payment = {}) {
  const supabase = getSupabase();
  const payload = {
    order_id: payment.order_id,
    client_order_id: payment.client_order_id,
    provider: payment.provider ?? 'pakasir',
    provider_project: payment.provider_project,
    provider_order_id: payment.provider_order_id,
    amount: payment.amount,
    fee: payment.fee ?? null,
    total_payment: payment.total_payment ?? payment.amount,
    currency: payment.currency ?? 'IDR',
    payment_method: payment.payment_method ?? 'qris',
    provider_status: payment.provider_status ?? 'pending',
    payment_status: payment.payment_status ?? 'pending',
    qr_string: payment.qr_string ?? null,
    expired_at: payment.expired_at ?? null,
    paid_at: payment.paid_at ?? null,
    customer_phone_snapshot: payment.customer_phone_snapshot ?? null,
    customer_name_snapshot: payment.customer_name_snapshot ?? null,
    metadata: payment.metadata ?? {}
  };

  const { data, error } = await supabase
    .from('order_payments')
    .upsert(payload, { onConflict: 'client_order_id' })
    .select('*');

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return mapPaymentRow(row ?? null);
}

export async function updatePaymentStatusByProviderOrderId(providerOrderId, updates = {}) {
  const supabase = getSupabase();
  const payload = {
    provider_status: updates.provider_status,
    payment_status: updates.payment_status,
    paid_at: updates.paid_at ?? null,
    metadata: updates.metadata ?? undefined
  };

  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  const { data, error } = await supabase
    .from('order_payments')
    .update(payload)
    .eq('provider_order_id', providerOrderId)
    .select('*')
    .single();

  if (error) throw error;
  return mapPaymentRow(data);
}
