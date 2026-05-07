#!/usr/bin/env node
/**
 * Go Ngupi Ongkir Daily Report
 * 
 * Calculates total delivery fees (ongkir) collected today.
 * Sources: state files (active + expired) + Supabase orders
 * 
 * Usage: node backend/ongkir-report.js [date]
 * Default: today (WIB)
 * Example: node backend/ongkir-report.js 2026-05-06
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const WORKSPACE = '/home/ubuntu/workspace-sobatngupi';
const ACTIVE_DIR = join(WORKSPACE, 'state', 'orders-active');
const EXPIRED_DIR = join(WORKSPACE, 'state', 'orders-expired');
const DOKU_PENDING_DIR = join(WORKSPACE, 'state', 'doku-pending');

// Get target date (WIB)
const targetDate = process.argv[2] || new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const wib = new Date(d.getTime() + 7 * 3600000);
  return wib.toISOString().slice(0, 10) === targetDate;
}

async function scanStateFiles(dir) {
  const results = [];
  try {
    const files = await readdir(dir);
    for (const file of files.filter(f => f.endsWith('.json'))) {
      try {
        const raw = await readFile(join(dir, file), 'utf-8');
        const state = JSON.parse(raw);
        const ctx = state.orderContext || state;
        
        // Only delivery orders with ongkir
        if (ctx.fulfillmentMethod !== 'delivery' && ctx.fulfillment !== 'delivery') continue;
        
        const fee = Number(ctx.deliveryFee || ctx.ongkir || ctx.delivery_fee || 0);
        if (fee <= 0) continue;
        
        // Check if today
        const orderDate = ctx.paidAt || ctx.createdAt || state.lastUpdatedAt || state.createdAt;
        if (!isToday(orderDate)) continue;
        
        // Only confirmed/paid orders
        const status = ctx.paymentStatus || state.paymentStatus;
        if (!['confirmed', 'paid', 'pending_on_delivery'].includes(status)) continue;
        
        results.push({
          orderId: ctx.clientOrderId || ctx.orderId || state.orderId || basename(file, '.json'),
          customer: ctx.customerName || state.customerName || '-',
          fee,
          paidAt: ctx.paidAt || orderDate
        });
      } catch (_) {}
    }
  } catch (_) {}
  return results;
}

async function scanDokuPending() {
  const results = [];
  try {
    const files = await readdir(DOKU_PENDING_DIR);
    for (const file of files.filter(f => f.endsWith('.json'))) {
      try {
        const raw = await readFile(join(DOKU_PENDING_DIR, file), 'utf-8');
        const payment = JSON.parse(raw);
        
        if (payment.fulfillmentMethod !== 'delivery') continue;
        const fee = Number(payment.deliveryFee || 0);
        if (fee <= 0) continue;
        if (!isToday(payment.createdAt || payment.paidAt)) continue;
        
        results.push({
          orderId: payment.orderId || basename(file, '.json'),
          customer: payment.customerName || '-',
          fee,
          paidAt: payment.paidAt || payment.createdAt
        });
      } catch (_) {}
    }
  } catch (_) {}
  return results;
}

async function querySupabase() {
  const results = [];
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    // Get today's delivery orders from DB
    const startOfDay = `${targetDate}T00:00:00+07:00`;
    const endOfDay = `${targetDate}T23:59:59+07:00`;
    
    const { data: orders } = await sb
      .from('orders')
      .select('client_order_id, customer_name_snapshot, fulfillment_method, notes, created_at')
      .eq('fulfillment_method', 'delivery')
      .in('payment_status', ['confirmed', 'paid'])
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);
    
    // Note: delivery_fee not in DB yet, so we can't get it from here
    // This is a placeholder for when we add the column
    if (orders) {
      for (const order of orders) {
        // Try to extract ongkir from notes or other fields
        // For now, skip — state files are the source of truth
      }
    }
  } catch (_) {}
  return results;
}

// Main
const [activeResults, expiredResults, dokuResults] = await Promise.all([
  scanStateFiles(ACTIVE_DIR),
  scanStateFiles(EXPIRED_DIR),
  scanDokuPending()
]);

// Deduplicate by orderId
const allResults = [...activeResults, ...expiredResults, ...dokuResults];
const seen = new Set();
const unique = [];
for (const r of allResults) {
  if (!seen.has(r.orderId)) {
    seen.add(r.orderId);
    unique.push(r);
  }
}

// Sort by time
unique.sort((a, b) => new Date(a.paidAt || 0) - new Date(b.paidAt || 0));

const totalOngkir = unique.reduce((sum, r) => sum + r.fee, 0);
const totalOrders = unique.length;

// Output
const fmtRp = (n) => 'Rp' + Number(n).toLocaleString('id-ID');

console.log(`🛵 LAPORAN ONGKIR GO NGUPI`);
console.log(`Tanggal: ${targetDate}`);
console.log(`─────────────────────────`);

if (unique.length === 0) {
  console.log(`Belum ada delivery hari ini.`);
} else {
  for (const r of unique) {
    const time = r.paidAt ? new Date(r.paidAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) : '-';
    console.log(`  ${time} | ${r.customer} | ${r.orderId} | ${fmtRp(r.fee)}`);
  }
  console.log(`─────────────────────────`);
  console.log(`Total delivery: ${totalOrders} order`);
  console.log(`Total ongkir: ${fmtRp(totalOngkir)}`);
}

// JSON output for programmatic use
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ date: targetDate, totalOrders, totalOngkir, orders: unique }, null, 2));
}
