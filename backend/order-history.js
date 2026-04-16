#!/usr/bin/env node

/**
 * Order History — query recent orders for a customer from Supabase
 * 
 * Usage: node order-history.js <customer_phone> [limit]
 * Output: JSON with recent orders + items
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).trim().replace(/[\s\-()]/g, '');
  if (p.startsWith('08')) p = '+62' + p.slice(1);
  if (p.startsWith('62') && !p.startsWith('+')) p = '+' + p;
  return p.startsWith('+') ? p : null;
}

async function getHistory(phone, limit = 5) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    console.error(JSON.stringify({ ok: false, error: 'Invalid phone number' }));
    process.exit(1);
  }

  // Get recent orders
  const { data: orders, error: ordErr } = await supabase
    .from('orders')
    .select('id, client_order_id, customer_name_snapshot, fulfillment_method, payment_method, payment_status, order_status, created_at')
    .eq('customer_phone_snapshot', normalized)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (ordErr) {
    console.error(JSON.stringify({ ok: false, error: ordErr.message }));
    process.exit(1);
  }

  if (!orders?.length) {
    console.log(JSON.stringify({ ok: true, phone: normalized, orders: [], message: 'Belum ada riwayat pesanan' }));
    return;
  }

  // Get items for each order
  const orderIds = orders.map(o => o.id);
  const { data: items } = await supabase
    .from('order_items')
    .select('order_id, menu_id, menu_name, qty, temperature')
    .in('order_id', orderIds);

  const itemsByOrder = {};
  for (const item of (items || [])) {
    if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
    itemsByOrder[item.order_id].push({
      menu: item.menu_name,
      qty: item.qty,
      temp: item.temperature
    });
  }

  // Get payment info
  const clientOrderIds = orders.map(o => o.client_order_id).filter(Boolean);
  const { data: payments } = await supabase
    .from('order_payments')
    .select('id, payment_status, amount, total_payment')
    .in('provider_order_id', clientOrderIds.map(id => `pakasir_${id}`));

  const paymentByOrderId = {};
  for (const p of (payments || [])) {
    const clientId = p.provider_order_id?.replace('pakasir_', '');
    if (clientId) paymentByOrderId[clientId] = p;
  }

  // Format output
  const result = orders.map(o => ({
    orderId: o.client_order_id,
    name: o.customer_name_snapshot,
    items: itemsByOrder[o.id] || [],
    fulfillment: o.fulfillment_method,
    payment: o.payment_method,
    paymentStatus: o.payment_status,
    orderStatus: o.order_status,
    total: paymentByOrderId[o.client_order_id]?.total_payment || null,
    date: o.created_at
  }));

  console.log(JSON.stringify({ ok: true, phone: normalized, orders: result }, null, 2));
}

const phone = process.argv[2];
const limit = Number(process.argv[3]) || 5;

if (!phone) {
  console.error(JSON.stringify({ ok: false, error: 'Usage: node order-history.js <phone> [limit]' }));
  process.exit(1);
}

getHistory(phone, limit).catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
