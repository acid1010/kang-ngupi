/**
 * Backend Internal Scheduler
 * 
 * Handles time-based tasks internally without waking the agent:
 * - QRIS remind (30min) + cancel (1hr)
 * - Expire stale orders (>24h)
 * - Cleanup draft orders (midnight)
 * 
 * Runs inside the main backend process (ngupi-backend).
 */

import cron from 'node-cron';
import { readdir, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import logger from '../lib/logger.js';
import { getSupabase } from '../supabase.js';
import { runWacliSafe } from '../notifications/whatsapp.js';

const execFileAsync = promisify(execFile);

const ACTIVE_DIR = '/home/ubuntu/workspace-sobatngupi/state/orders-active';
const EXPIRED_DIR = '/home/ubuntu/workspace-sobatngupi/state/orders-expired';
const WACLI_BIN = process.env.WACLI_BIN || 'wacli';
const QRIS_REMIND_MS = 30 * 60 * 1000;   // 30 minutes
const QRIS_CANCEL_MS = 60 * 60 * 1000;   // 1 hour

// ─── Helpers ────────────────────────────────────────────────

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
    await runWacliSafe(['send', 'text', '--to', jid, '--message', message]);
  } catch (_) {}
}

// ─── QRIS Cancel/Remind ────────────────────────────────────

async function processQrisOrders() {
  try {
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

        // >1 hour → cancel
        if (elapsed >= QRIS_CANCEL_MS) {
          state.paymentStatus = 'expired';
          state.lastMilestone = 'order_cancelled';
          state.cancelledAt = new Date().toISOString();
          state.cancelReason = 'unpaid_timeout';

          // Cancel in DB
          try {
            const sb = getSupabase();
            await sb.from('orders').update({ order_status: 'cancelled', payment_status: 'expired' }).eq('client_order_id', orderId);
          } catch (_) {}

          await rename(filePath, join(EXPIRED_DIR, `${phone}-${orderId}-cancelled.json`));
          await sendWa(phone, `Hai kak ${name}, pesanan ${orderId} sudah dibatalkan karena belum dibayar dalam 1 jam. Kalau mau order lagi, tinggal chat aja ya 🙂`);
          cancelled++;
          logger.info('[scheduler] Cancelled: %s order %s (%dmin unpaid)', phone, orderId, Math.round(elapsed / 60000));
          continue;
        }

        // >30 min → remind (only once)
        if (elapsed >= QRIS_REMIND_MS && !state.paymentReminded) {
          state.paymentReminded = true;
          await writeFile(filePath, JSON.stringify(state, null, 2));
          await sendWa(phone, `Hai kak ${name}, QR pembayaran pesanan kamu masih menunggu nih 🙂 Kalau butuh QR baru, bilang aja ya!`);
          reminded++;
          logger.info('[scheduler] Reminded: %s order %s (%dmin)', phone, orderId, Math.round(elapsed / 60000));
          continue;
        }

        active++;
      } catch (err) {
        logger.warn('[scheduler] Error processing %s: %s', file, err.message);
      }
    }

    if (cancelled > 0 || reminded > 0) {
      logger.info('[scheduler] QRIS: %d cancelled, %d reminded, %d active', cancelled, reminded, active);
    }
  } catch (err) {
    logger.warn('[scheduler] processQrisOrders error: %s', err.message);
  }
}

// ─── Expire Stale Orders ───────────────────────────────────

async function expireStaleOrders() {
  try {
    await mkdir(EXPIRED_DIR, { recursive: true });
    const files = await readdir(ACTIVE_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const now = Date.now();
    const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
    let expired = 0;

    for (const file of jsonFiles) {
      try {
        const filePath = join(ACTIVE_DIR, file);
        const raw = await readFile(filePath, 'utf8');
        const state = JSON.parse(raw);

        // Skip confirmed/paid orders
        if (state.paymentStatus === 'confirmed' || state.paymentStatus === 'paid') continue;

        const createdAt = state.createdAt || state.updatedAt;
        if (!createdAt) continue;

        const age = now - new Date(createdAt).getTime();
        if (age >= MAX_AGE_MS) {
          const phone = basename(file, '.json');
          const orderId = state.orderId || 'unknown';
          await rename(filePath, join(EXPIRED_DIR, `${phone}-${orderId}-expired.json`));
          expired++;
          logger.info('[scheduler] Expired: %s order %s (%dh old)', phone, orderId, Math.round(age / 3600000));
        }
      } catch (err) {
        logger.warn('[scheduler] Error expiring %s: %s', file, err.message);
      }
    }

    if (expired > 0) {
      logger.info('[scheduler] Expired %d stale orders', expired);
    }
  } catch (err) {
    logger.warn('[scheduler] expireStaleOrders error: %s', err.message);
  }
}

// ─── Cleanup Drafts (midnight) ─────────────────────────────

async function cleanupDrafts() {
  try {
    await mkdir(EXPIRED_DIR, { recursive: true });
    const files = await readdir(ACTIVE_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    let cleaned = 0;

    for (const file of jsonFiles) {
      try {
        const filePath = join(ACTIVE_DIR, file);
        const raw = await readFile(filePath, 'utf8');
        const state = JSON.parse(raw);

        // Skip QRIS pending (handled by processQrisOrders)
        if (state.paymentMethod === 'qris' && state.paymentStatus === 'pending') continue;
        // Skip confirmed/paid
        if (state.paymentStatus === 'confirmed' || state.paymentStatus === 'paid') continue;

        const phone = basename(file, '.json');
        const orderId = state.orderId || state.orderContext?.clientOrderId || 'unknown';

        // Delete from DB
        try {
          const sb = getSupabase();
          const { data } = await sb.from('orders').select('id').eq('client_order_id', orderId).limit(1);
          if (data?.[0]) {
            await sb.from('order_items').delete().eq('order_id', data[0].id);
            await sb.from('orders').delete().eq('id', data[0].id);
          }
        } catch (_) {}

        await rename(filePath, join(EXPIRED_DIR, `${phone}-${orderId}-draft-expired.json`));
        cleaned++;
        logger.info('[scheduler] Draft cleaned: %s order %s', phone, orderId);
      } catch (err) {
        logger.warn('[scheduler] Error cleaning %s: %s', file, err.message);
      }
    }

    if (cleaned > 0) {
      logger.info('[scheduler] Cleaned %d draft orders', cleaned);
    }
  } catch (err) {
    logger.warn('[scheduler] cleanupDrafts error: %s', err.message);
  }
}

// ─── Schedule ──────────────────────────────────────────────

// ─── State File Watcher (auto-sync QRIS) ────────────────────

import { watch as fsWatch } from 'node:fs';

const _syncInFlight = new Set();

function initStateWatcher() {
  fsWatch(ACTIVE_DIR, (eventType, filename) => {
    if (!filename?.endsWith('.json') || _syncInFlight.has(filename)) return;
    
    const phone = filename.replace('.json', '');
    
    // Small delay to ensure file is fully written
    setTimeout(async () => {
      try {
        const { readFile: rf } = await import('node:fs/promises');
        const raw = await rf(join(ACTIVE_DIR, filename), 'utf8');
        const data = JSON.parse(raw);
        
        if (data.paymentMethod === 'qris' && data.paymentStatus === 'pending' && !data._synced) {
          _syncInFlight.add(filename);
          logger.info('[state-watcher] QRIS detected for %s, auto-syncing...', phone);
          
          try {
            await execFileAsync('node', ['/home/ubuntu/workspace-sobatngupi/backend/sync-state.js', 'sync', phone], { timeout: 30000 });
            logger.info('[state-watcher] Sync complete for %s', phone);
          } catch (err) {
            logger.warn('[state-watcher] Sync failed for %s: %s', phone, err.message);
          } finally {
            setTimeout(() => _syncInFlight.delete(filename), 10000);
          }
        }
      } catch (e) {
        // File might be partially written, ignore
      }
    }, 200);
  });
  
  logger.info('[state-watcher] Watching %s for QRIS auto-sync', ACTIVE_DIR);
}

export function startScheduler() {
  // State watcher disabled — causes double QRIS when agent also calls exec sync
  // try { initStateWatcher(); } catch (err) { logger.warn('[state-watcher] Failed to start: %s', err.message); }

  // QRIS remind/cancel: every 10 min during business hours (09-22 WIB)
  cron.schedule('*/10 9-22 * * *', processQrisOrders, { timezone: 'Asia/Jakarta' });

  // Expire stale orders: every 6 hours
  cron.schedule('0 */6 * * *', expireStaleOrders, { timezone: 'Asia/Jakarta' });

  // Cleanup drafts: midnight WIB
  cron.schedule('0 0 * * *', cleanupDrafts, { timezone: 'Asia/Jakarta' });

  // Customer profile sync + backup: 22:00 WIB daily
  cron.schedule('0 22 * * *', async () => {
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      // Sync customer profiles first
      const { stdout: syncOut } = await execFileAsync('node', ['/home/ubuntu/workspace-sobatngupi/backend/sync-customers.js'], { timeout: 30_000 });
      logger.info('[scheduler] Customer sync: %s', syncOut.trim());
      // Then backup
      const { stdout } = await execFileAsync('node', ['/home/ubuntu/workspace-sobatngupi/backend/backup-customers.js'], { timeout: 30_000 });
      logger.info('[scheduler] Customer backup: %s', stdout.trim());
    } catch (err) {
      logger.warn('[scheduler] Customer backup failed: %s', err.message);
    }
  }, { timezone: 'Asia/Jakarta' });

  logger.info('[scheduler] Internal scheduler started — QRIS(*/10 9-22), expire(*/6h), drafts(midnight), backup(22:00)');
}
