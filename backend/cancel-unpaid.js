#!/usr/bin/env node

/**
 * Auto-Cancel Unpaid Orders & Cleanup Drafts
 * 
 * 1. QRIS pending >30min → notify customer "QR masih menunggu pembayaran"
 * 2. QRIS pending >1 hour → cancel + notify customer
 * 3. Draft orders (no payment) → cancel at midnight (run by separate cron)
 * 
 * Run via cron: every 15 minutes
 */

import 'dotenv/config';
import { readdir, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ACTIVE_DIR = '/home/ubuntu/workspace-sobatngupi/state/orders-active';
const EXPIRED_DIR = '/home/ubuntu/workspace-sobatngupi/state/orders-expired';
const QRIS_REMIND_MS = 30 * 60 * 1000;   // 30 minutes → remind
const QRIS_CANCEL_MS = 60 * 60 * 1000;   // 1 hour → cancel
const WACLI_BIN = process.env.WACLI_BIN || 'wacli';

const MODE = process.argv[2] || 'qris'; // 'qris' or 'drafts'

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

function toJid(phone) {
  let p = String(phone).trim().replace(/[\s\-()]/g, '');
  if (p.startsWith('08')) p = '+62' + p.slice(1);
  if (p.startsWith('62') && !p.startsWith('+')) p = '+' + p;
  return p.startsWith('+') ? p.slice(1) + '@s.whatsapp.net' : null;
}

async function sendWa(phone, message) {
  const jid = toJid(phone);
  if (!jid) return;
  try {
    await execFileAsync(WACLI_BIN, ['send', 'text', '--to', jid, '--message', message], { timeout: 15_000 });
  } catch (_) {}
}

function hasUsableOrderId(orderId) {
  return typeof orderId === 'string' && orderId.trim() !== '' && orderId.trim().toLowerCase() !== 'unknown';
}

async function cancelInDb(clientOrderId) {
  const db = await getSupabase();
  if (!db || !clientOrderId) return;
  try {
    await db.from('orders').update({ order_status: 'cancelled', payment_status: 'expired' }).eq('client_order_id', clientOrderId);
  } catch (err) {
    console.error(`DB cancel failed for ${clientOrderId}: ${err.message}`);
  }
}

async function deleteFromDb(clientOrderId) {
  const db = await getSupabase();
  if (!db || !clientOrderId) return;
  try {
    const { data } = await db.from('orders').select('id').eq('client_order_id', clientOrderId).limit(1);
    if (data?.[0]) {
      await db.from('order_items').delete().eq('order_id', data[0].id);
      await db.from('orders').delete().eq('id', data[0].id);
    }
  } catch (err) {
    console.error(`DB delete failed for ${clientOrderId}: ${err.message}`);
  }
}

async function processQris() {
  await mkdir(EXPIRED_DIR, { recursive: true });
  const files = await readdir(ACTIVE_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  let reminded = 0, cancelled = 0, active = 0;
  const now = Date.now();

  for (const file of jsonFiles) {
    try {
      const filePath = join(ACTIVE_DIR, file);
      const raw = await readFile(filePath, 'utf8');
      const state = JSON.parse(raw);

      if (state.paymentMethod !== 'qris' || state.paymentStatus !== 'pending') {
        active++;
        continue;
      }

      const paymentSelectedAt = state.updatedAt || state.lastUpdatedAt || state.createdAt;
      if (!paymentSelectedAt) { active++; continue; }

      const elapsed = now - new Date(paymentSelectedAt).getTime();
      const phone = basename(file, '.json');
      const orderId = state.orderId || state.orderContext?.clientOrderId || 'unknown';
      const name = state.customerName || 'kak';

      if (!hasUsableOrderId(orderId)) {
        active++;
        console.log(`Skipped: ${phone} pending QRIS without usable orderId`);
        continue;
      }

      // >1 hour → cancel
      if (elapsed >= QRIS_CANCEL_MS) {
        state.paymentStatus = 'expired';
        state.lastMilestone = 'order_cancelled';
        state.cancelledAt = new Date().toISOString();
        state.cancelReason = 'unpaid_timeout';

        await cancelInDb(orderId);
        await rename(filePath, join(EXPIRED_DIR, `${phone}-${orderId}-cancelled.json`));
        await sendWa(phone, `Hai kak ${name}, pesanan ${orderId} sudah dibatalkan karena belum dibayar dalam 1 jam. Kalau mau order lagi, tinggal chat aja ya 🙂`);
        cancelled++;
        console.log(`Cancelled: ${phone} order ${orderId} (${Math.round(elapsed / 60000)}min unpaid)`);
        continue;
      }

      // >30 min → remind (only once)
      if (elapsed >= QRIS_REMIND_MS && !state.paymentReminded) {
        state.paymentReminded = true;
        await writeFile(filePath, JSON.stringify(state, null, 2));
        await sendWa(phone, `Hai kak ${name}, QR pembayaran pesanan kamu masih menunggu nih 🙂 Kalau butuh QR baru, bilang aja ya!`);
        reminded++;
        console.log(`Reminded: ${phone} order ${orderId} (${Math.round(elapsed / 60000)}min)`);
        continue;
      }

      active++;
    } catch (err) {
      console.error(`Error processing ${file}: ${err.message}`);
    }
  }

  console.log(`QRIS: ${cancelled} cancelled, ${reminded} reminded, ${active} active`);
}

async function processDrafts() {
  await mkdir(EXPIRED_DIR, { recursive: true });
  const files = await readdir(ACTIVE_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  let cleaned = 0;

  for (const file of jsonFiles) {
    try {
      const filePath = join(ACTIVE_DIR, file);
      const raw = await readFile(filePath, 'utf8');
      const state = JSON.parse(raw);

      // Skip QRIS pending (handled by processQris)
      if (state.paymentMethod === 'qris' && state.paymentStatus === 'pending') continue;
      // Skip confirmed/paid orders
      if (state.paymentStatus === 'confirmed' || state.paymentStatus === 'paid') continue;

      const phone = basename(file, '.json');
      const orderId = state.orderId || state.orderContext?.clientOrderId || 'unknown';

      // Delete draft from DB
      await deleteFromDb(orderId);

      // Move to expired
      await rename(filePath, join(EXPIRED_DIR, `${phone}-${orderId}-draft-expired.json`));
      cleaned++;
      console.log(`Draft cleaned: ${phone} order ${orderId}`);
    } catch (err) {
      console.error(`Error processing ${file}: ${err.message}`);
    }
  }

  console.log(`Drafts: ${cleaned} cleaned`);
}

if (MODE === 'drafts') {
  processDrafts().catch(console.error);
} else {
  processQris().catch(console.error);
}
