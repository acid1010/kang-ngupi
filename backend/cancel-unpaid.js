#!/usr/bin/env node

/**
 * Auto-Cancel Unpaid Orders
 * - QRIS pending >1 hour → cancel
 * - Moves state to orders-expired/
 * - Updates DB order status if possible
 * 
 * Run via cron: every 30 minutes
 */

import 'dotenv/config';
import { readdir, readFile, rename, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

const ACTIVE_DIR = '/home/ubuntu/workspace-sobatngupi/state/orders-active';
const EXPIRED_DIR = '/home/ubuntu/workspace-sobatngupi/state/orders-expired';
const UNPAID_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

let supabase = null;

async function getSupabase() {
  if (supabase) return supabase;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    }
  } catch (_) {}
  return supabase;
}

async function cancelInDb(clientOrderId) {
  const db = await getSupabase();
  if (!db || !clientOrderId) return;
  
  try {
    await db
      .from('orders')
      .update({ order_status: 'cancelled', payment_status: 'expired' })
      .eq('client_order_id', clientOrderId);
  } catch (err) {
    console.error(`DB cancel failed for ${clientOrderId}: ${err.message}`);
  }
}

async function run() {
  await mkdir(EXPIRED_DIR, { recursive: true });

  const files = await readdir(ACTIVE_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  let cancelled = 0;
  let active = 0;
  const now = Date.now();

  for (const file of jsonFiles) {
    try {
      const filePath = join(ACTIVE_DIR, file);
      const raw = await readFile(filePath, 'utf8');
      const state = JSON.parse(raw);

      // Only auto-cancel QRIS pending orders
      if (state.paymentMethod !== 'qris' || state.paymentStatus !== 'pending') {
        active++;
        continue;
      }

      // Check when payment was selected
      const paymentSelectedAt = state.updatedAt || state.lastUpdatedAt || state.createdAt;
      if (!paymentSelectedAt) {
        active++;
        continue;
      }

      const elapsed = now - new Date(paymentSelectedAt).getTime();
      if (elapsed < UNPAID_TIMEOUT_MS) {
        active++;
        continue;
      }

      // Cancel: move to expired
      const orderId = state.orderId || state.orderContext?.clientOrderId || 'unknown';
      const phone = basename(file, '.json');
      const expiredName = `${phone}-${orderId}-cancelled.json`;

      // Mark as cancelled in state before moving
      state.paymentStatus = 'expired';
      state.lastMilestone = 'order_cancelled';
      state.cancelledAt = new Date().toISOString();
      state.cancelReason = 'unpaid_timeout';

      // Update DB
      await cancelInDb(orderId);

      // Move file
      await rename(filePath, join(EXPIRED_DIR, expiredName));
      cancelled++;
      console.log(`Cancelled: ${phone} order ${orderId} (${Math.round(elapsed / 60000)}min unpaid)`);
    } catch (err) {
      console.error(`Error processing ${file}: ${err.message}`);
    }
  }

  if (cancelled > 0 || active > 0) {
    console.log(`Done: ${cancelled} cancelled, ${active} active`);
  } else {
    console.log('No orders to process');
  }
}

run().catch(console.error);
