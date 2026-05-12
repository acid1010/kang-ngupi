#!/usr/bin/env node

/**
 * Order Counter — Persistent daily order counter for Kang Ngupi.
 * 
 * Usage:
 *   node order-counter.js next <type>   → get next order ID (DL-DDMM-HHMM-XXX / PU-DDMM-HHMM-XXX / DI-DDMM-HHMM-XXX)
 *   node order-counter.js peek <type>   → peek next number without incrementing
 *   node order-counter.js reset         → force reset (new day auto-resets)
 *   node order-counter.js status        → show current counters
 * 
 * Format: {TYPE}-{DDMM}-{HHMM}-{XXX}
 *   TYPE = DL (delivery) / PU (pickup) / DI (dine-in)
 *   DDMM = tanggal + bulan WIB
 *   HHMM = jam + menit WIB
 *   XXX  = sequential counter per hari per type
 * 
 * Counter resets daily at midnight WIB.
 * Data stored in: backend/data/order-counter.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COUNTER_PATH = join(__dirname, 'data', 'order-counter.json');

function getWIB() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return {
    date: wib.toISOString().slice(0, 10),
    day: String(wib.getUTCDate()).padStart(2, '0'),
    month: String(wib.getUTCMonth() + 1).padStart(2, '0'),
    hours: String(wib.getUTCHours()).padStart(2, '0'),
    minutes: String(wib.getUTCMinutes()).padStart(2, '0'),
    ddmm: String(wib.getUTCDate()).padStart(2, '0') + String(wib.getUTCMonth() + 1).padStart(2, '0'),
    hhmm: String(wib.getUTCHours()).padStart(2, '0') + String(wib.getUTCMinutes()).padStart(2, '0')
  };
}

function loadCounter() {
  try {
    return JSON.parse(readFileSync(COUNTER_PATH, 'utf8'));
  } catch (_) {
    return { date: null, DL: 0, PU: 0, DI: 0 };
  }
}

function saveCounter(data) {
  mkdirSync(dirname(COUNTER_PATH), { recursive: true });
  writeFileSync(COUNTER_PATH, JSON.stringify(data, null, 2));
}

function ensureToday(counter) {
  const { date } = getWIB();
  if (counter.date !== date) {
    // New day — reset all counters
    counter.date = date;
    counter.DL = 0;
    counter.PU = 0;
    counter.DI = 0;
  }
  return counter;
}

function run() {
  const [action, type] = process.argv.slice(2);

  if (!action || action === 'status') {
    const counter = ensureToday(loadCounter());
    saveCounter(counter);
    console.log(JSON.stringify(counter, null, 2));
    return;
  }

  if (action === 'reset') {
    const counter = { date: getWIB().date, DL: 0, PU: 0, DI: 0 };
    saveCounter(counter);
    console.log(JSON.stringify({ reset: true, ...counter }));
    return;
  }

  if (action === 'next' || action === 'peek') {
    const validTypes = ['DL', 'PU', 'DI'];
    const t = (type || '').toUpperCase();
    if (!validTypes.includes(t)) {
      console.error(`Error: type must be one of ${validTypes.join(', ')}`);
      process.exit(1);
    }

    const counter = ensureToday(loadCounter());
    const { ddmm, hhmm } = getWIB();

    if (action === 'next') {
      counter[t]++;
      saveCounter(counter);
    }

    const num = String(counter[t] || 1).padStart(3, '0');
    const orderId = `${t}-${ddmm}-${hhmm}-${num}`;

    console.log(JSON.stringify({ orderId, type: t, sequence: counter[t], date: counter.date }));
    return;
  }

  console.error('Usage: node order-counter.js [next|peek|reset|status] [DL|PU|DI]');
  process.exit(1);
}

run();
