/**
 * Simple Reservation System for Kedai Ngupi Ngupi
 * 
 * Stores reservations in JSON files. No Pawoon integration (API doesn't support tables).
 * Reservations are for dine-in only, 09:00-17:00 WIB.
 * 
 * Usage:
 *   node backend/reservasi.js create <phone> <date> <time> <pax> <name>
 *   node backend/reservasi.js list [date]
 *   node backend/reservasi.js cancel <phone> <date>
 *   node backend/reservasi.js check <date> <time>
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const RESERVASI_DIR = '/home/ubuntu/workspace-sobatngupi/state/reservasi';
const MAX_TABLES = 15;
const OPEN_HOUR = 9;  // 09:00 WIB
const CLOSE_HOUR = 17; // 17:00 WIB
const MAX_PAX_PER_TABLE = 6;

async function ensureDir() {
  await mkdir(RESERVASI_DIR, { recursive: true });
}

function getDateFile(date) {
  return join(RESERVASI_DIR, `${date}.json`);
}

async function loadReservations(date) {
  try {
    const raw = await readFile(getDateFile(date), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveReservations(date, reservations) {
  await ensureDir();
  await writeFile(getDateFile(date), JSON.stringify(reservations, null, 2));
}

function validateTime(time) {
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return false;
  if (h < OPEN_HOUR || h >= CLOSE_HOUR) return false;
  return true;
}

function validateDate(date) {
  const d = new Date(date + 'T00:00:00+07:00');
  if (isNaN(d.getTime())) return false;
  const now = new Date(Date.now() + 7 * 3600000);
  const today = now.toISOString().slice(0, 10);
  if (date < today) return false;
  return true;
}

// Check availability for a given date+time slot
async function checkAvailability(date, time) {
  const reservations = await loadReservations(date);
  const hour = parseInt(time.split(':')[0]);
  
  // Count reservations in the same hour slot
  const sameSlot = reservations.filter(r => {
    const rHour = parseInt(r.time.split(':')[0]);
    return Math.abs(rHour - hour) < 2; // Within 2 hour window
  });
  
  const tablesUsed = sameSlot.reduce((sum, r) => sum + Math.ceil(r.pax / MAX_PAX_PER_TABLE), 0);
  const available = MAX_TABLES - tablesUsed;
  
  return {
    date,
    time,
    totalTables: MAX_TABLES,
    tablesUsed,
    tablesAvailable: available,
    reservations: sameSlot.length,
    available: available > 0
  };
}

// Create reservation
async function createReservation(phone, date, time, pax, name) {
  if (!validateDate(date)) {
    return { ok: false, error: 'Tanggal tidak valid atau sudah lewat' };
  }
  if (!validateTime(time)) {
    return { ok: false, error: `Reservasi hanya bisa jam ${OPEN_HOUR}:00 - ${CLOSE_HOUR}:00 WIB` };
  }
  if (pax < 1 || pax > 20) {
    return { ok: false, error: 'Jumlah orang harus 1-20' };
  }

  const availability = await checkAvailability(date, time);
  if (!availability.available) {
    return { ok: false, error: 'Maaf, slot penuh untuk waktu tersebut', availability };
  }

  const reservations = await loadReservations(date);
  
  // Check duplicate
  const existing = reservations.find(r => r.phone === phone && r.status === 'confirmed');
  if (existing) {
    return { ok: false, error: 'Sudah ada reservasi aktif untuk tanggal ini', existing };
  }

  const reservation = {
    id: `RSV-${date.replace(/-/g, '')}-${String(reservations.length + 1).padStart(3, '0')}`,
    phone,
    name,
    date,
    time,
    pax,
    tablesNeeded: Math.ceil(pax / MAX_PAX_PER_TABLE),
    status: 'confirmed',
    createdAt: new Date().toISOString()
  };

  reservations.push(reservation);
  await saveReservations(date, reservations);

  return { ok: true, reservation };
}

// Cancel reservation
async function cancelReservation(phone, date) {
  const reservations = await loadReservations(date);
  const idx = reservations.findIndex(r => r.phone === phone && r.status === 'confirmed');
  
  if (idx === -1) {
    return { ok: false, error: 'Reservasi tidak ditemukan' };
  }

  reservations[idx].status = 'cancelled';
  reservations[idx].cancelledAt = new Date().toISOString();
  await saveReservations(date, reservations);

  return { ok: true, cancelled: reservations[idx] };
}

// List reservations for a date
async function listReservations(date) {
  const reservations = await loadReservations(date);
  const active = reservations.filter(r => r.status === 'confirmed');
  return { date, total: active.length, reservations: active };
}

// CLI
const [,, action, ...args] = process.argv;

await ensureDir();

switch (action) {
  case 'create': {
    const [phone, date, time, pax, ...nameParts] = args;
    const name = nameParts.join(' ') || 'Guest';
    const result = await createReservation(phone, date, time, parseInt(pax), name);
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case 'list': {
    const date = args[0] || new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const result = await listReservations(date);
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case 'cancel': {
    const [phone, date] = args;
    const result = await cancelReservation(phone, date);
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case 'check': {
    const [date, time] = args;
    const result = await checkAvailability(date, time || '12:00');
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  default:
    console.log('Usage: node reservasi.js <create|list|cancel|check> [args]');
}
