#!/usr/bin/env node

/**
 * Payment Poller — polls pending QRIS payments and verifies them via Pakasir.
 *
 * This runs as a standalone PM2 process (ngupi-payment-poller).
 * It periodically checks all pending payments and updates their status.
 */

import 'dotenv/config';
import logger from '../lib/logger.js';
import { pollPendingPaymentsAndVerify } from './service.js';

const BASE_INTERVAL_MS = Number(process.env.PAYMENT_POLL_INTERVAL_MS || 15000);
const MAX_INTERVAL_MS = 60000; // Back off to 60s when idle
const IDLE_BACKOFF_MULTIPLIER = 2;

if (!Number.isFinite(BASE_INTERVAL_MS) || BASE_INTERVAL_MS < 1000) {
  throw new Error('PAYMENT_POLL_INTERVAL_MS must be a number >= 1000');
}

logger.info('Payment poller starting (base interval: %dms, max: %dms)', BASE_INTERVAL_MS, MAX_INTERVAL_MS);

let currentInterval = BASE_INTERVAL_MS;
let consecutiveIdle = 0;
let timer = null;

async function tick() {
  try {
    const results = await pollPendingPaymentsAndVerify();
    const verified = results.filter(r => r.status === 'verified').length;
    const errors = results.filter(r => r.status === 'error').length;
    const total = results.length;

    if (verified > 0 || errors > 0) {
      // Activity detected — reset to base interval
      logger.info('Poll: %d checked, %d verified, %d errors', total, verified, errors);
      consecutiveIdle = 0;
      currentInterval = BASE_INTERVAL_MS;
    } else if (total > 0) {
      // Pending payments exist but no changes — log occasionally
      consecutiveIdle++;
      if (consecutiveIdle % 12 === 1) {
        // Log every ~12 ticks (roughly every 3 minutes at base rate)
        logger.info('Poll: %d pending, no changes (idle x%d)', total, consecutiveIdle);
      }
    } else {
      // No pending payments at all — back off
      consecutiveIdle++;
      currentInterval = Math.min(currentInterval * IDLE_BACKOFF_MULTIPLIER, MAX_INTERVAL_MS);
      if (consecutiveIdle % 60 === 1) {
        logger.info('Poll: no pending payments (idle x%d, interval: %ds)', consecutiveIdle, Math.round(currentInterval / 1000));
      }
    }
  } catch (err) {
    logger.error({ err }, 'Poll tick failed');
    consecutiveIdle = 0;
    currentInterval = BASE_INTERVAL_MS; // Reset on error
  }

  // Schedule next tick with adaptive interval
  timer = setTimeout(tick, currentInterval);
}

// Initial tick
await tick();

// Graceful shutdown
function shutdown(signal) {
  logger.info('Payment poller shutting down (%s)', signal);
  if (timer) clearTimeout(timer);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
