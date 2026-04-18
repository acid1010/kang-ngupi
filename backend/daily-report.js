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
const ADMIN_PHONE = process.env.ADMIN_PHONE || '+6283872201310';

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

  // Fetch completed/paid orders for the day
  const { data: orders, error } = await sb
    .from('orders')
    .select('id, client_order_id, customer_name_snapshot, fulfillment_method, payment_method, payment_status, order_status, created_at')
    .gte('created_at', startWIB.toISOString())
    .lte('created_at', endWIB.toISOString())
    .in('payment_status', ['confirmed', 'paid', 'settled']);

  if (error) {
    console.error('DB error:', error.message);
    return null;
  }

  if (!orders || orders.length === 0) {
    return { empty: true, date: dateStr };
  }

  // Fetch items for all orders
  const orderIds = orders.map(o => o.id);
  const { data: allItems } = await sb
    .from('order_items')
    .select('order_id, menu_name, qty, price')
    .in('order_id', orderIds);

  // Calculate stats
  let totalRevenue = 0;
  let totalItems = 0;
  const itemCounts = {};
  let pickupCount = 0;
  let deliveryCount = 0;
  let qrisCount = 0;
  let codCount = 0;

  for (const order of orders) {
    const items = (allItems || []).filter(i => i.order_id === order.id);
    let orderTotal = 0;

    for (const item of items) {
      const qty = item.qty || 1;
      const price = Number(item.price || 0) * qty;
      orderTotal += price;
      totalItems += qty;

      const name = item.menu_name || 'Unknown';
      itemCounts[name] = (itemCounts[name] || 0) + qty;
    }

    totalRevenue += orderTotal;

    if (order.fulfillment_method === 'delivery') deliveryCount++;
    else pickupCount++;

    if (order.payment_method === 'qris') qrisCount++;
    else codCount++;
  }

  // Top 5 items
  const topItems = Object.entries(itemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return {
    empty: false,
    date: dateStr,
    orderCount: orders.length,
    totalRevenue,
    totalItems,
    pickupCount,
    deliveryCount,
    qrisCount,
    codCount,
    topItems
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
  msg += `- Pickup: ${report.pickupCount}\n`;
  msg += `- Delivery: ${report.deliveryCount}\n\n`;

  msg += `💳 *Pembayaran:*\n`;
  msg += `- QRIS: ${report.qrisCount}\n`;
  msg += `- COD: ${report.codCount}\n\n`;

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
  const jid = toJid(ADMIN_PHONE);
  if (!jid) {
    console.error('Invalid admin phone:', ADMIN_PHONE);
    return false;
  }

  try {
    await execFileAsync(WACLI_BIN, ['send', 'text', '--to', jid, '--message', message], { timeout: 15_000 });
    console.log('Report sent to', ADMIN_PHONE);
    return true;
  } catch (err) {
    console.error('Failed to send:', err.message);
    return false;
  }
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
