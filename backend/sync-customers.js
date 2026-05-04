#!/usr/bin/env node

/**
 * Sync customer profiles from DB — rich profiles with order history + preferences
 *
 * Creates state/customers/<phone>.json with:
 * - name, phone, firstOrder, lastOrder
 * - orderCount, paidOrderCount, totalSpent
 * - favoriteItems (top 3 most ordered from paid orders)
 * - preferences (language, notes — preserved from existing)
 *
 * Run: node backend/sync-customers.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAID_STATUSES = new Set(['confirmed', 'paid', 'settled']);

// Load .env
try {
  const envContent = readFileSync(join(__dirname, '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) process.env[trimmed.substring(0, eq).trim()] ||= trimmed.substring(eq + 1).trim();
  }
} catch (_) {}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const CUSTOMERS_DIR = join(__dirname, '..', 'state', 'customers');

async function fetchInBatches(table, select, column, values, batchSize = 100) {
  const rows = [];

  for (let i = 0; i < values.length; i += batchSize) {
    const batch = values.slice(i, i + batchSize);
    if (!batch.length) continue;

    const { data, error } = await sb
      .from(table)
      .select(select)
      .in(column, batch);

    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }

    if (data) rows.push(...data);
  }

  return rows;
}

async function syncCustomers() {
  mkdirSync(CUSTOMERS_DIR, { recursive: true });

  const { data: orders, error } = await sb
    .from('orders')
    .select('id, customer_name_snapshot, customer_phone_snapshot, payment_method, payment_status, fulfillment_method, created_at')
    .not('customer_phone_snapshot', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('DB error:', error.message);
    process.exit(1);
  }

  const orderIds = (orders || []).map(order => order.id).filter(Boolean);
  const payments = orderIds.length
    ? await fetchInBatches('order_payments', 'order_id, payment_status, total_payment, paid_at, created_at', 'order_id', orderIds)
    : [];

  const paymentsByOrderId = new Map();
  for (const payment of payments) {
    if (!payment?.order_id) continue;
    const existing = paymentsByOrderId.get(payment.order_id);
    if (!existing) {
      paymentsByOrderId.set(payment.order_id, payment);
      continue;
    }

    const existingPaid = PAID_STATUSES.has(existing.payment_status);
    const currentPaid = PAID_STATUSES.has(payment.payment_status);
    const existingTime = existing.paid_at || existing.created_at || '';
    const currentTime = payment.paid_at || payment.created_at || '';

    if ((!existingPaid && currentPaid) || (existingPaid === currentPaid && currentTime > existingTime)) {
      paymentsByOrderId.set(payment.order_id, payment);
    }
  }

  const paidOrderIds = (orders || [])
    .filter(order => {
      const payment = paymentsByOrderId.get(order.id);
      return PAID_STATUSES.has(payment?.payment_status) || PAID_STATUSES.has(order.payment_status);
    })
    .map(order => order.id);

  const paidItems = paidOrderIds.length
    ? await fetchInBatches('order_items', 'order_id, menu_name, qty', 'order_id', paidOrderIds)
    : [];

  const itemsByOrderId = new Map();
  for (const item of paidItems) {
    if (!item?.order_id) continue;
    if (!itemsByOrderId.has(item.order_id)) itemsByOrderId.set(item.order_id, []);
    itemsByOrderId.get(item.order_id).push(item);
  }

  const customerMap = new Map();

  for (const order of orders || []) {
    const phone = order.customer_phone_snapshot;
    if (!phone) continue;

    if (!customerMap.has(phone)) {
      customerMap.set(phone, {
        name: order.customer_name_snapshot || 'Unknown',
        phone,
        firstOrder: order.created_at,
        lastOrder: order.created_at,
        orderCount: 0,
        paidOrderCount: 0,
        totalSpent: 0,
        itemCounts: {},
        paymentMethods: {},
        fulfillmentMethods: {},
      });
    }

    const profile = customerMap.get(phone);
    profile.orderCount++;

    if (order.customer_name_snapshot && order.created_at >= profile.lastOrder) {
      profile.name = order.customer_name_snapshot;
      profile.lastOrder = order.created_at;
    }
    if (order.created_at < profile.firstOrder) {
      profile.firstOrder = order.created_at;
    }

    const payment = paymentsByOrderId.get(order.id);
    const isPaid = PAID_STATUSES.has(payment?.payment_status) || PAID_STATUSES.has(order.payment_status);
    if (isPaid) {
      profile.paidOrderCount++;
      profile.totalSpent += Number(payment?.total_payment || 0);

      for (const item of itemsByOrderId.get(order.id) || []) {
        if (!item?.menu_name) continue;
        const qty = Number(item.qty || 0) || 1;
        profile.itemCounts[item.menu_name] = (profile.itemCounts[item.menu_name] || 0) + qty;
      }
    }

    if (order.payment_method) {
      profile.paymentMethods[order.payment_method] = (profile.paymentMethods[order.payment_method] || 0) + 1;
    }
    if (order.fulfillment_method) {
      profile.fulfillmentMethods[order.fulfillment_method] = (profile.fulfillmentMethods[order.fulfillment_method] || 0) + 1;
    }
  }

  let written = 0;
  for (const [phone, data] of customerMap) {
    const filename = phone.replace(/[^a-zA-Z0-9+._-]/g, '_') + '.json';
    const filepath = join(CUSTOMERS_DIR, filename);

    let existing = {};
    try {
      if (existsSync(filepath)) {
        existing = JSON.parse(readFileSync(filepath, 'utf8'));
      }
    } catch (_) {}

    const favoriteItems = Object.entries(data.itemCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));

    const preferredPayment = Object.entries(data.paymentMethods).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const preferredFulfillment = Object.entries(data.fulfillmentMethods).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const profile = {
      name: data.name,
      phone: data.phone,
      firstOrder: data.firstOrder,
      lastOrder: data.lastOrder,
      orderCount: data.orderCount,
      paidOrderCount: data.paidOrderCount,
      totalSpent: data.totalSpent,
      favoriteItems,
      preferredPayment,
      preferredFulfillment,
      preferences: existing.preferences || {},
      updatedAt: new Date().toISOString()
    };

    writeFileSync(filepath, JSON.stringify(profile, null, 2));
    written++;
  }

  console.log(`Synced ${written} customer profiles to state/customers/`);
}

syncCustomers().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
