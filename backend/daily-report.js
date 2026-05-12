#!/usr/bin/env node

/**
 * Daily Sales Report — kirim summary penjualan hari ini ke WA admin
 * 
 * Usage: node backend/daily-report.js [date]
 * Default: hari ini (WIB)
 * Example: node backend/daily-report.js 2026-04-18
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from backend dir
const __dirname = dirname(fileURLToPath(import.meta.url));
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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WACLI_BIN = process.env.WACLI_BIN || 'wacli';
const ADMIN_PHONES = (process.env.ADMIN_PHONE || '+6285155022960').split(',').map(p => p.trim()).filter(Boolean);

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function toJid(phone) {
  let p = String(phone).trim().replace(/[\s\-()]/g, '');
  if (p.startsWith('08')) p = '+62' + p.slice(1);
  if (p.startsWith('62') && !p.startsWith('+')) p = '+' + p;
  return p.startsWith('+') ? p.slice(1) + '@s.whatsapp.net' : null;
}

function fmtRp(n) {
  return 'Rp' + Number(n || 0).toLocaleString('id-ID');
}

async function generateReport(dateStr) {
  // Date range in UTC (WIB = UTC+7)
  const startWIB = new Date(dateStr + 'T00:00:00+07:00');
  const endWIB = new Date(dateStr + 'T23:59:59+07:00');

  // Fetch completed/paid orders for the day (exclude test/draft orders)
  const { data: orders, error } = await sb
    .from('orders')
    .select('id, client_order_id, customer_name_snapshot, fulfillment_method, payment_method, payment_status, order_status, created_at')
    .gte('created_at', startWIB.toISOString())
    .lte('created_at', endWIB.toISOString())
    .in('payment_status', ['confirmed', 'paid', 'settled'])
    .in('order_status', ['preparing', 'completed', 'delivered', 'ready_for_pickup']);

  if (error) {
    console.error('DB error:', error.message);
    return null;
  }

  if (!orders || orders.length === 0) {
    return { empty: true, date: dateStr };
  }

  // Fetch items for all orders (no price column in DB — use menu lookup)
  const orderIds = orders.map(o => o.id);
  const { data: allItems } = await sb
    .from('order_items')
    .select('order_id, menu_name, qty')
    .in('order_id', orderIds);

  // Load menu-schema for price lookup (order_items may not have price)
  let menuPrices = {};
  try {
    const menuRaw = readFileSync(join(__dirname, '..', 'menu-schema.json'), 'utf8');
    const menu = JSON.parse(menuRaw);
    const items = menu.menus || menu.products || [];
    for (const item of items) {
      if (item.name && item.price) {
        menuPrices[item.name.toLowerCase()] = item.price;
      }
    }
  } catch (_) {}

  function lookupPrice(menuName) {
    const key = (menuName || '').toLowerCase();
    // Exact match first
    if (menuPrices[key]) return menuPrices[key];
    // Try without variant suffix (e.g. "Chicken Cordon Bleu - Nasi" → "Chicken Cordon Bleu")
    const base = key.split(' - ')[0];
    if (menuPrices[base]) return menuPrices[base];
    return 0;
  }

  // Calculate stats
  let totalRevenue = 0;
  let totalItems = 0;
  const itemCounts = {};
  let pickupCount = 0;
  let deliveryCount = 0;
  let dineInCount = 0;
  let qrisCount = 0;
  let kasirCount = 0;

  for (const order of orders) {
    const items = (allItems || []).filter(i => i.order_id === order.id);
    let orderTotal = 0;

    for (const item of items) {
      const qty = item.qty || 1;
      const price = Number(item.price || 0) || lookupPrice(item.menu_name);
      const lineTotal = price * qty;
      orderTotal += lineTotal;
      totalItems += qty;

      const name = item.menu_name || 'Unknown';
      itemCounts[name] = (itemCounts[name] || 0) + qty;
    }

    totalRevenue += orderTotal;

    if (order.fulfillment_method === 'delivery') deliveryCount++;
    else if (order.fulfillment_method === 'dine_in') dineInCount++;
    else pickupCount++;

    if (order.payment_method === 'qris') qrisCount++;
    else kasirCount++;
  }

  // Top 5 items
  const topItems = Object.entries(itemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Calculate ongkir from DB (delivery_fee column)
  let totalOngkir = 0;
  const deliveryOrders = orders.filter(o => o.fulfillment_method === 'delivery');
  if (deliveryOrders.length > 0) {
    const { data: dlOrders } = await sb
      .from('orders')
      .select('delivery_fee')
      .in('id', deliveryOrders.map(o => o.id));
    if (dlOrders) {
      totalOngkir = dlOrders.reduce((sum, o) => sum + (Number(o.delivery_fee) || 0), 0);
    }
  }

  return {
    empty: false,
    date: dateStr,
    orderCount: orders.length,
    totalRevenue,
    totalItems,
    dineInCount,
    pickupCount,
    deliveryCount,
    qrisCount,
    kasirCount,
    topItems,
    totalOngkir
  };
}

function formatReport(report) {
  if (report.empty) {
    return `📊 *LAPORAN HARIAN*\n${report.date}\n\nBelum ada transaksi hari ini.`;
  }

  let msg = `📊 *LAPORAN HARIAN*\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `Kedai Ngupi Ngupi Purwakarta\n`;
  msg += `Tanggal: ${report.date}\n\n`;

  msg += `💰 *Revenue: ${fmtRp(report.totalRevenue)}*\n`;
  msg += `📦 Total Order: ${report.orderCount}\n`;
  msg += `🧋 Total Item: ${report.totalItems}\n\n`;

  msg += `📍 *Fulfillment:*\n`;
  msg += `- Dine-in: ${report.dineInCount}\n`;
  msg += `- Pickup: ${report.pickupCount}\n`;
  msg += `- Delivery: ${report.deliveryCount}\n\n`;

  msg += `💳 *Pembayaran:*\n`;
  msg += `- QRIS: ${report.qrisCount}\n`;
  msg += `- Kasir: ${report.kasirCount}\n\n`;

  if (report.totalOngkir > 0) {
    msg += `🛵 *Ongkir Go Ngupi:*\n`;
    msg += `- ${report.deliveryCount} delivery | Total: ${fmtRp(report.totalOngkir)}\n\n`;
  }

  if (report.topItems.length > 0) {
    msg += `🏆 *Top Menu:*\n`;
    for (const [name, qty] of report.topItems) {
      msg += `- ${name} x${qty}\n`;
    }
  }

  msg += `\n━━━━━━━━━━━━━━━━━━\n`;
  msg += `Kang Ngupi — Auto Report`;

  return msg;
}

async function sendToAdmin(message) {
  let sent = false;
  for (const phone of ADMIN_PHONES) {
    const jid = toJid(phone);
    if (!jid) {
      console.error('Invalid admin phone:', phone);
      continue;
    }
    try {
      await execFileAsync(WACLI_BIN, ['send', 'text', '--to', jid, '--message', message], { timeout: 15_000 });
      console.log('Report sent to', phone);
      sent = true;
    } catch (err) {
      console.error('Failed to send to %s:', phone, err.message);
    }
  }
  return sent;
}

// Main
const dateArg = process.argv[2];
const today = dateArg || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD

console.log(`Generating report for ${today}...`);
const report = await generateReport(today);

if (!report) {
  console.error('Failed to generate report');
  process.exit(1);
}

const message = formatReport(report);
console.log(message);

// Send to admin
const sent = await sendToAdmin(message);
console.log(sent ? 'Done!' : 'Send failed');
