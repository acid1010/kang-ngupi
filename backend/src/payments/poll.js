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

const intervalMs = Number(process.env.PAYMENT_POLL_INTERVAL_MS || 15000);

if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
  throw new Error('PAYMENT_POLL_INTERVAL_MS must be a number >= 1000');
}

logger.info('Payment poller starting (interval: %dms)', intervalMs);

async function tick() {
  try {
    const results = await pollPendingPaymentsAndVerify();
    const verified = results.filter(r => r.status === 'verified').length;
    const errors = results.filter(r => r.status === 'error').length;

    if (results.length > 0) {
      logger.info('Poll complete: %d checked, %d verified, %d errors', results.length, verified, errors);
    }
  } catch (err) {
    logger.error({ err }, 'Poll tick failed');
  }
}

// Initial tick
await tick();

// Schedule recurring ticks
setInterval(tick, intervalMs);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Payment poller shutting down (SIGTERM)');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Payment poller shutting down (SIGINT)');
  process.exit(0);
});
