#!/usr/bin/env node

/**
 * SobatNgupi Integration Test
 * Tests the full order flow: create → sync → QRIS → payment → courier → Pawoon
 * 
 * Usage: node test-integration.js [phone]
 * Default phone: +6285155022960
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

const execFileAsync = promisify(execFile);
const BACKEND_URL = 'https://ngupingupi.me';
const API_KEY = process.env.BACKEND_API_KEY;
const STATE_DIR = join(__dirname, '..', 'state', 'orders-active');
const TEST_PHONE = process.argv[2] || '+6285155022960';

let passed = 0;
let failed = 0;
let skipped = 0;

function log(icon, msg) { console.log(`${icon} ${msg}`); }
function pass(msg) { passed++; log('✅', msg); }
function fail(msg, detail = '') { failed++; log('❌', `${msg}${detail ? ' — ' + detail : ''}`); }
function skip(msg) { skipped++; log('⏭️', msg); }
function section(msg) { console.log(`\n${'='.repeat(50)}\n📋 ${msg}\n${'='.repeat(50)}`); }

async function fetchJson(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  try { return { status: res.status, ok: res.ok, data: JSON.parse(text) }; }
  catch { return { status: res.status, ok: res.ok, data: text }; }
}

// ─── Test 1: Health Check ───
async function testHealth() {
  section('Test 1: Health Check');
  const res = await fetchJson(`${BACKEND_URL}/health`);
  if (res.ok && res.data?.db === 'ok') pass(`Health OK (uptime: ${res.data.uptime}s, memory: ${res.data.memoryMB}MB)`);
  else fail('Health check failed', JSON.stringify(res.data));
}

// ─── Test 2: Create Order State ───
function testCreateState() {
  section('Test 2: Create Order State');
  const orderId = `TEST-${Date.now().toString(36).toUpperCase()}`;
  const state = {
    orderId,
    customerId: TEST_PHONE,
    customerPhone: TEST_PHONE,
    customerName: 'Test Customer',
    channel: 'whatsapp',
    rawMessage: 'kopsu 1 ice',
    items: [{
      menuId: 'kopi-susu-original',
      menuName: 'Es Kopi Susu Original',
      quantity: 1,
      price: 18000,
      temperature: 'iced'
    }],
    fulfillment: 'delivery',
    fulfillmentMethod: 'delivery',
    shareloc: { lat: -6.575624, lng: 107.463524, source: 'test' },
    paymentMethod: 'qris',
    paymentStatus: 'pending',
    milestone: 'payment_selected',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const filepath = join(STATE_DIR, `${TEST_PHONE}.json`);
  try {
    writeFileSync(filepath, JSON.stringify(state, null, 2));
    pass(`State created: ${orderId}`);
    return { orderId, filepath, state };
  } catch (err) {
    fail('State creation failed', err.message);
    return null;
  }
}

// ─── Test 3: Sync State ───
async function testSyncState() {
  section('Test 3: Sync State (sync-state.js)');
  try {
    const { stdout } = await execFileAsync('node', [
      join(__dirname, 'sync-state.js'), 'sync', TEST_PHONE
    ], { timeout: 60_000 });
    
    const result = JSON.parse(stdout);
    if (result.ok) {
      pass(`Sync OK — clientOrderId: ${result.clientOrderId}`);
      if (result.whatsappSent) pass('WhatsApp QR sent');
      else if (result.qrisCreated) { pass('QRIS created'); skip('WhatsApp send (dedup or disabled)'); }
      else skip('QRIS not created (may already exist)');
      return result;
    } else {
      fail('Sync failed', JSON.stringify(result));
      return null;
    }
  } catch (err) {
    fail('Sync exec failed', err.message);
    return null;
  }
}

// ─── Test 4: Check Order in DB ───
async function testOrderInDb(clientOrderId) {
  section('Test 4: Order in Database');
  if (!clientOrderId) { skip('No clientOrderId'); return null; }

  const res = await fetchJson(`${BACKEND_URL}/bridge/order-context/${encodeURIComponent(TEST_PHONE)}`);
  if (res.ok && (res.data?.orderContext || res.data?.data?.orderContext)) {
    const ctx = res.data?.orderContext || res.data?.data?.orderContext;
    pass(`Order found: ${ctx.clientOrderId}`);
    if (ctx.paymentMethod === 'qris') pass('Payment method: QRIS');
    else fail('Wrong payment method', ctx.paymentMethod);
    return ctx;
  } else {
    fail('Order not found in DB', JSON.stringify(res.data));
    return null;
  }
}

// ─── Test 5: Check Payment Status ───
async function testPaymentStatus() {
  section('Test 5: Payment Status');
  try {
    const { stdout } = await execFileAsync('node', [
      join(__dirname, 'sync-state.js'), 'status', TEST_PHONE
    ], { timeout: 30_000 });
    
    const result = JSON.parse(stdout);
    if (result.ok) {
      pass(`Status: ${result.paymentStatus} (method: ${result.paymentMethod})`);
      return result;
    } else {
      fail('Status check failed', JSON.stringify(result));
      return null;
    }
  } catch (err) {
    fail('Status exec failed', err.message);
    return null;
  }
}

// ─── Test 6: Dashboard API ───
async function testDashboardApi() {
  section('Test 6: Dashboard API');
  
  // Login
  const loginRes = await fetchJson(`${BACKEND_URL}/dashboard/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ username: 'acid', password: 'ngupi2025' })
  });
  
  if (loginRes.ok && loginRes.data?.data?.token) {
    pass('Dashboard login OK');
    const token = loginRes.data.data.token;
    
    // Get orders
    const ordersRes = await fetchJson(`${BACKEND_URL}/dashboard/api/orders?per_page=3`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (ordersRes.ok) pass(`Orders API: ${ordersRes.data?.meta?.total || 0} total`);
    else fail('Orders API failed');
    
    // Get stats
    const statsRes = await fetchJson(`${BACKEND_URL}/dashboard/api/orders/stats/summary`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (statsRes.ok) pass(`Stats API: ${JSON.stringify(statsRes.data?.data)}`);
    else fail('Stats API failed');
    
    return token;
  } else {
    fail('Dashboard login failed', JSON.stringify(loginRes.data));
    return null;
  }
}

// ─── Test 7: Order History ───
async function testOrderHistory() {
  section('Test 7: Order History');
  try {
    const { stdout } = await execFileAsync('node', [
      join(__dirname, 'order-history.js'), TEST_PHONE, '3'
    ], { timeout: 30_000 });
    
    const result = JSON.parse(stdout);
    if (result.ok) {
      pass(`History: ${result.orders?.length || 0} orders found`);
    } else {
      fail('History failed', result.error);
    }
  } catch (err) {
    fail('History exec failed', err.message);
  }
}

// ─── Test 8: Menu Schema ───
function testMenuSchema() {
  section('Test 8: Menu Schema');
  const schemaPath = join(__dirname, '..', 'menu-schema.json');
  try {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const menus = schema.menus || [];
    const withImages = menus.filter(m => m.image).length;
    pass(`Menu: ${menus.length} items, ${withImages} with images`);
    
    // Check price consistency
    const kopsu = menus.find(m => m.id === 'kopi-susu-original' || m.id === 'es-kopi-susu-original');
    if (kopsu) pass(`Kopsu price: Rp${kopsu.price}`);
    else fail('Kopsu not found in menu');
    
    if (schema.syncSource === 'pawoon') pass('Synced from Pawoon');
    else skip('Not synced from Pawoon');
  } catch (err) {
    fail('Menu schema error', err.message);
  }
}

// ─── Test 9: Wacli ───
async function testWacli() {
  section('Test 9: Wacli');
  try {
    const { stdout } = await execFileAsync('wacli', ['--version'], { timeout: 5_000 });
    pass(`Wacli: ${stdout.trim()}`);
  } catch (err) {
    fail('Wacli not available', err.message);
  }
}

// ─── Test 10: Pawoon Connection ───
async function testPawoon() {
  section('Test 10: Pawoon POS');
  try {
    const tokenRes = await fetch('https://open-api.pawoon.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: process.env.PAWOON_CLIENT_ID,
        client_secret: process.env.PAWOON_CLIENT_SECRET
      })
    });
    const data = await tokenRes.json();
    if (data.access_token) pass('Pawoon auth OK');
    else fail('Pawoon auth failed');
  } catch (err) {
    fail('Pawoon connection failed', err.message);
  }
}

// ─── Cleanup ───
function cleanup() {
  section('Cleanup');
  const filepath = join(STATE_DIR, `${TEST_PHONE}.json`);
  try {
    if (existsSync(filepath)) {
      unlinkSync(filepath);
      pass('Test state file cleaned');
    }
  } catch { /* ignore */ }
}

// ─── Run All ───
async function run() {
  console.log('🧪 SobatNgupi Integration Test');
  console.log(`📱 Test phone: ${TEST_PHONE}`);
  console.log(`🕐 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
  
  await testHealth();
  const stateResult = testCreateState();
  const syncResult = await testSyncState();
  await testOrderInDb(syncResult?.clientOrderId || stateResult?.orderId);
  await testPaymentStatus();
  await testDashboardApi();
  await testOrderHistory();
  testMenuSchema();
  await testWacli();
  await testPawoon();
  cleanup();
  
  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 Results: ✅ ${passed} passed, ❌ ${failed} failed, ⏭️ ${skipped} skipped`);
  console.log(`${'='.repeat(50)}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
