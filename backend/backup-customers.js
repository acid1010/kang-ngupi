#!/usr/bin/env node

/**
 * Customer Data Backup — backup nama + nomor customer dari DB setiap hari
 * 
 * Usage: node backend/backup-customers.js
 * Output: backend/backups/customers-YYYY-MM-DD.json
 * 
 * Data source: orders table (unique customer_name + customer_phone)
 */

import { readFileSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
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
const BACKUP_DIR = join(__dirname, 'backups');
const MAX_BACKUPS = 30; // Keep last 30 days

async function backupCustomers() {
  mkdirSync(BACKUP_DIR, { recursive: true });

  // Fetch unique customers from orders
  const { data: orders, error } = await sb
    .from('orders')
    .select('customer_name_snapshot, customer_phone_snapshot, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('DB error:', error.message);
    process.exit(1);
  }

  // Deduplicate by phone number, keep latest name
  const customerMap = new Map();
  for (const order of (orders || [])) {
    const phone = order.customer_phone_snapshot;
    if (!phone) continue;
    
    if (!customerMap.has(phone)) {
      customerMap.set(phone, {
        name: order.customer_name_snapshot || 'Unknown',
        phone,
        firstOrder: order.created_at,
        lastOrder: order.created_at,
        orderCount: 1
      });
    } else {
      const existing = customerMap.get(phone);
      existing.orderCount++;
      // Update name if newer order has a name
      if (order.customer_name_snapshot && order.created_at > existing.lastOrder) {
        existing.name = order.customer_name_snapshot;
        existing.lastOrder = order.created_at;
      }
      if (order.created_at < existing.firstOrder) {
        existing.firstOrder = order.created_at;
      }
    }
  }

  const customers = [...customerMap.values()].sort((a, b) => b.orderCount - a.orderCount);

  // Also fetch from state files (customers who chatted but maybe didn't complete order)
  try {
    const stateDir = join(__dirname, '..', 'state', 'orders-active');
    const files = readdirSync(stateDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const state = JSON.parse(readFileSync(join(stateDir, file), 'utf8'));
        const phone = state.customerId || file.replace('.json', '');
        const name = state.customerName;
        if (phone && !customerMap.has(phone)) {
          customers.push({
            name: name || 'Unknown',
            phone,
            firstOrder: state.createdAt || null,
            lastOrder: state.updatedAt || state.createdAt || null,
            orderCount: 0,
            source: 'state_file'
          });
        }
      } catch (_) {}
    }
  } catch (_) {}

  // Write backup
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
  const backupFile = join(BACKUP_DIR, `customers-${today}.json`);
  
  const backup = {
    date: today,
    generatedAt: new Date().toISOString(),
    totalCustomers: customers.length,
    totalOrders: orders?.length || 0,
    customers
  };

  writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`Backup saved: ${backupFile}`);
  console.log(`Customers: ${customers.length}, Orders: ${orders?.length || 0}`);

  // Cleanup old backups (keep last 30)
  const backupFiles = readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('customers-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (backupFiles.length > MAX_BACKUPS) {
    const toDelete = backupFiles.slice(MAX_BACKUPS);
    for (const f of toDelete) {
      unlinkSync(join(BACKUP_DIR, f));
      console.log(`Deleted old backup: ${f}`);
    }
  }
}

backupCustomers().catch(err => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
