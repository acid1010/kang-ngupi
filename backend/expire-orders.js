#!/usr/bin/env node

/**
 * State Expiry — moves stale orders (>24h no update) to orders-expired/
 * Run via cron: every hour
 */

import { readdir, readFile, rename, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

const ACTIVE_DIR = '/home/ubuntu/workspace-sobatngupi/state/orders-active';
const EXPIRED_DIR = '/home/ubuntu/workspace-sobatngupi/state/orders-expired';
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

async function run() {
  await mkdir(EXPIRED_DIR, { recursive: true });

  const files = await readdir(ACTIVE_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  let moved = 0;
  let skipped = 0;
  const now = Date.now();

  for (const file of jsonFiles) {
    try {
      const filePath = join(ACTIVE_DIR, file);
      const raw = await readFile(filePath, 'utf8');
      const state = JSON.parse(raw);

      // Check last update time
      const updatedAt = state.updatedAt || state.lastUpdatedAt || state.createdAt;
      if (!updatedAt) {
        skipped++;
        continue;
      }

      const elapsed = now - new Date(updatedAt).getTime();
      if (elapsed < STALE_MS) {
        skipped++;
        continue;
      }

      // Skip if payment is pending QRIS (don't expire mid-payment)
      if (state.paymentMethod === 'qris' && state.paymentStatus === 'pending') {
        skipped++;
        continue;
      }

      // Move to expired with order ID in filename
      const orderId = state.orderId || state.orderContext?.clientOrderId || 'unknown';
      const phone = basename(file, '.json');
      const expiredName = `${phone}-${orderId}.json`;
      const destPath = join(EXPIRED_DIR, expiredName);

      await rename(filePath, destPath);
      moved++;
      console.log(`Expired: ${file} -> ${expiredName} (${Math.round(elapsed / 3600000)}h old)`);
    } catch (err) {
      console.error(`Error processing ${file}: ${err.message}`);
    }
  }

  console.log(`Done: ${moved} expired, ${skipped} active`);
}

run().catch(console.error);
