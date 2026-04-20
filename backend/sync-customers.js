#!/usr/bin/env node

/**
 * Sync customer names from DB to persistent state files
 * 
 * Creates state/customers/<phone>.json with customer name
 * These files are NOT cleaned up by daily cron — they persist forever
 * Agent reads these to greet returning customers by name
 * 
 * Run: node backend/sync-customers.js
 * Also called after every successful order
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

  const { data: orders, error } = await sb
    .from('orders')
    .select('customer_name_snapshot, customer_phone_snapshot, created_at')
    .not('customer_name_snapshot', 'is', null)
    .not('customer_phone_snapshot', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('DB error:', error.message);
    process.exit(1);
  }

  // Deduplicate — keep latest name per phone
  const customerMap = new Map();
  for (const order of (orders || [])) {
    const phone = order.customer_phone_snapshot;
    if (!phone || !order.customer_name_snapshot) continue;
    if (!customerMap.has(phone)) {
      customerMap.set(phone, {
        name: order.customer_name_snapshot,
        phone,
        lastOrder: order.created_at
      });
    }
  }

  let written = 0;
  for (const [phone, data] of customerMap) {
    const filename = phone.replace(/[^a-zA-Z0-9+._-]/g, '_') + '.json';
    const filepath = join(CUSTOMERS_DIR, filename);
    writeFileSync(filepath, JSON.stringify(data, null, 2));
    written++;
  }

  console.log(`Synced ${written} customer profiles to state/customers/`);
}

syncCustomers().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
