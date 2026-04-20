#!/usr/bin/env node

/**
 * Sync customer profiles from DB — rich profiles with order history + preferences
 * 
 * Creates state/customers/<phone>.json with:
 * - name, phone, firstOrder, lastOrder
 * - orderCount, totalSpent
 * - favoriteItems (top 5 most ordered)
 * - preferences (language, notes — preserved from existing)
 * 
 * Run: node backend/sync-customers.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const CUSTOMERS_DIR = join(__dirname, '..', 'state', 'customers');

async function syncCustomers() {
  mkdirSync(CUSTOMERS_DIR, { recursive: true });

  // Fetch all orders with items
  const { data: orders, error } = await sb
    .from('orders')
    .select('id, customer_name_snapshot, customer_phone_snapshot, payment_method, payment_status, fulfillment_method, created_at')
    .not('customer_phone_snapshot', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('DB error:', error.message);
    process.exit(1);
  }

  // Fetch all order items
  const orderIds = (orders || []).map(o => o.id);
  let allItems = [];
  // Batch fetch (Supabase has URL length limits)
  for (let i = 0; i < orderIds.length; i += 50) {
    const batch = orderIds.slice(i, i + 50);
    const { data: items } = await sb
      .from('order_items')
      .select('order_id, menu_name, qty, price')
      .in('order_id', batch);
    if (items) allItems.push(...items);
  }

  // Build customer profiles
  const customerMap = new Map();

  for (const order of (orders || [])) {
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

    // Update name (latest order wins)
    if (order.customer_name_snapshot && order.created_at >= profile.lastOrder) {
      profile.name = order.customer_name_snapshot;
      profile.lastOrder = order.created_at;
    }
    if (order.created_at < profile.firstOrder) {
      profile.firstOrder = order.created_at;
    }

    // Count paid orders
    if (['confirmed', 'paid', 'settled'].includes(order.payment_status)) {
      profile.paidOrderCount++;

      // Count items
      const orderItems = allItems.filter(i => i.order_id === order.id);
      for (const item of orderItems) {
        const qty = item.qty || 1;
        const price = Number(item.price || 0) * qty;
        profile.totalSpent += price;
        profile.itemCounts[item.menu_name] = (profile.itemCounts[item.menu_name] || 0) + qty;
      }
    }

    // Track payment + fulfillment preferences
    if (order.payment_method) {
      profile.paymentMethods[order.payment_method] = (profile.paymentMethods[order.payment_method] || 0) + 1;
    }
    if (order.fulfillment_method) {
      profile.fulfillmentMethods[order.fulfillment_method] = (profile.fulfillmentMethods[order.fulfillment_method] || 0) + 1;
    }
  }

  // Write profiles
  let written = 0;
  for (const [phone, data] of customerMap) {
    const filename = phone.replace(/[^a-zA-Z0-9+._-]/g, '_') + '.json';
    const filepath = join(CUSTOMERS_DIR, filename);

    // Load existing profile to preserve manual preferences
    let existing = {};
    try {
      if (existsSync(filepath)) {
        existing = JSON.parse(readFileSync(filepath, 'utf8'));
      }
    } catch (_) {}

    // Top 5 favorite items
    const favoriteItems = Object.entries(data.itemCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // Preferred payment & fulfillment
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
      // Preserve manual preferences (set by agent during conversation)
      preferences: existing.preferences || {},
      // preferences example:
      // {
      //   language: "sunda",
      //   notes: "suka less ice",
      //   nickname: "Kang Asep",
      //   allergies: "kacang",
      //   customGreeting: "Kumaha damang kang?"
      // }
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
