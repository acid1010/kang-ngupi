#!/usr/bin/env node

/**
 * sync-state.js — CLI bridge for Kang Ngupi agent
 *
 * Usage:
 *   node backend/sync-state.js sync  <customer_phone>   — sync state + auto-trigger QRIS
 *   node backend/sync-state.js status <customer_phone>   — check payment status
 *
 * This script is called by the agent via `exec` tool.
 * It reads the local state file and communicates with the remote backend.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Load .env from backend directory ───────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');

try {
  const envContent = await fs.readFile(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
} catch {
  // .env not found — rely on existing env vars
}

// ─── Configuration ──────────────────────────────────────────────────────────
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL
  || process.env.PUBLIC_BASE_URL
  || 'http://localhost:3001';
const API_KEY = process.env.BACKEND_API_KEY || '';
const REQUEST_TIMEOUT_MS = 30_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizePhone(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  if (!raw) return null;
  const compact = raw.replace(/[\s()-]/g, '');
  const hasPlusPrefix = compact.startsWith('+');
  const digits = compact.replace(/\D/g, '');
  if (!digits || digits.length < 8 || digits.length > 16) return null;
  if (hasPlusPrefix) return `+${digits}`;
  if (digits.startsWith('0')) return `+62${digits.slice(1)}`;
  if (digits.startsWith('62')) return `+${digits}`;
  return `+${digits}`;
}

function makeStateFileName(phone) {
  return `${String(phone).replace(/[^a-zA-Z0-9+._-]/g, '_')}.json`;
}

function stateFilePath(phone) {
  return path.join(WORKSPACE_ROOT, 'state', 'orders-active', makeStateFileName(phone));
}

async function loadState(phone) {
  const filePath = stateFilePath(phone);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  return headers;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    if (!response.ok) {
      return { ok: false, status: response.status, error: text || response.statusText, data: parsed };
    }
    return { ok: true, status: response.status, ...(parsed || {}) };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, error: `Request timeout after ${REQUEST_TIMEOUT_MS}ms` };
    }
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

function die(message, exitCode = 1) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(exitCode);
}

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * If WhatsApp delivery failed, retry via /payments/resend (force mode).
 * Returns updated whatsappSent status.
 */
async function retryWhatsAppIfNeeded(paymentId, whatsappSent) {
  if (whatsappSent || !paymentId) return whatsappSent;

  // Small delay before retry to let the payment settle
  await sleep(1500);

  const resendResult = await fetchJson(`${BACKEND_BASE_URL}/payments/resend`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ payment_id: paymentId })
  });

  return resendResult.ok && resendResult.data?.whatsapp_sent === true;
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdSync(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) die(`Invalid phone: ${phone}`);

  const state = await loadState(normalized);
  if (!state) {
    die(`No active order state found for ${normalized}. File expected at: ${stateFilePath(normalized)}`);
  }

  // Support both nested (orderContext wrapper) and flat state formats
  const ctx = state.orderContext || state;

  // Persist/update customer profile for returning customer greeting + personalization
  const customerName = ctx.customerName || state.customerName;
  if (customerName && normalized) {
    try {
      const custDir = path.join(WORKSPACE_ROOT, 'state', 'customers');
      await fs.mkdir(custDir, { recursive: true });
      const custFile = path.join(custDir, makeStateFileName(normalized));
      // Load existing to preserve preferences
      let existing = {};
      try { existing = JSON.parse(await fs.readFile(custFile, 'utf8')); } catch (_) {}
      const updated = {
        ...existing,
        name: customerName,
        phone: normalized,
        lastOrder: new Date().toISOString(),
        preferences: existing.preferences || {}
      };
      await fs.writeFile(custFile, JSON.stringify(updated, null, 2));
    } catch (_) {}
  }

  // Determine if this is a QRIS payment trigger
  const isQris = ctx.paymentMethod === 'qris' &&
    ['pending', 'waiting', 'awaiting_payment'].includes(ctx.paymentStatus);

  // Step 1: Sync state to bridge
  const bridgePayload = {
    customer_phone: normalized,
    updates: {
      customerName: ctx.customerName || state.customerName || null,
      customerPhone: normalized,
      rawMessage: ctx.rawMessage || state.rawMessage || null,
      items: ctx.items || state.items || [],
      fulfillmentMethod: ctx.fulfillmentMethod || state.fulfillment || null,
      locationStatus: ctx.locationStatus || null,
      shareloc: ctx.shareloc || state.shareloc || null,
      address: ctx.address || null,
      paymentMethod: ctx.paymentMethod || state.paymentMethod || null,
      paymentStatus: ctx.paymentStatus || state.paymentStatus || null,
      deliveryProvider: ctx.deliveryProvider || state.deliveryProvider || null,
      notes: Array.isArray(ctx.notes) ? ctx.notes : (typeof ctx.notes === 'string' ? [ctx.notes] : []),
      customerNotes: Array.isArray(ctx.customerNotes) ? ctx.customerNotes : (typeof ctx.customerNotes === 'string' ? [ctx.customerNotes] : (state.customerNotes ? (Array.isArray(state.customerNotes) ? state.customerNotes : [state.customerNotes]) : [])),
      channel: ctx.channel || 'whatsapp'
    }
  };

  // clientOrderId: use from ctx, or generate from orderId in flat format
  const clientOrderId = ctx.clientOrderId || state.orderId || null;
  if (clientOrderId) {
    bridgePayload.updates.clientOrderId = clientOrderId;
  }

  const bridgeResult = await fetchJson(`${BACKEND_BASE_URL}/bridge/order-context`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(bridgePayload)
  });

  if (!bridgeResult.ok) {
    // If bridge fails, try qris/direct as fallback for QRIS flow
    if (isQris) {
      return await cmdSyncQrisDirect(normalized, ctx);
    }
    die(`Bridge sync failed: ${bridgeResult.error || JSON.stringify(bridgeResult)}`);
  }

  // Step 2: If QRIS payment, ensure QRIS is created
  if (isQris) {
    const clientOrderId = bridgeResult.data?.state?.orderContext?.clientOrderId;

    // Check if evaluator already auto-created QRIS
    const events = bridgeResult.data?.events || [];
    const qrisEvent = events.find(e => e.type === 'qris_payment_created');

    if (qrisEvent) {
      // Evaluator already created QRIS and attempted WhatsApp send.
      // Do NOT retry here — evaluator's send is the single source of truth.
      // Retrying causes double QR sends to customer.
      const whatsappSent = qrisEvent.whatsappSent || false;
      const paymentId = qrisEvent.paymentId || null;

      output({
        ok: true,
        action: 'sync',
        phone: normalized,
        bridgeSynced: true,
        qrisCreated: true,
        whatsappSent,
        clientOrderId,
        paymentId,
        source: 'evaluator_auto'
      });
      return;
    }

    if (clientOrderId) {
      // Try creating QRIS via the standard endpoint
      const qrisResult = await fetchJson(`${BACKEND_BASE_URL}/payments/pakasir/qris`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ client_order_id: clientOrderId })
      });

      if (qrisResult.ok) {
        const waDelivery = qrisResult.data?.whatsapp_qris_delivery;
        // Trust the endpoint's delivery result — do NOT retry here to avoid double sends
        const whatsappSent = waDelivery?.ok === true || (qrisResult.data?.payment?.metadata?.whatsapp_sent_at != null);
        const paymentId = qrisResult.data?.payment?.id || null;

        output({
          ok: true,
          action: 'sync',
          phone: normalized,
          bridgeSynced: true,
          qrisCreated: true,
          qrisReused: qrisResult.data?.reused || false,
          whatsappSent,
          whatsappSkipped: waDelivery?.skipped === true,
          whatsappError: whatsappSent ? null : (waDelivery?.error || null),
          clientOrderId,
          qrImageUrl: qrisResult.data?.payment?.qr_image_url || null
        });
        return;
      }

      // QRIS creation failed via standard endpoint — try direct
      return await cmdSyncQrisDirect(normalized, ctx);
    }

    // No clientOrderId — fallback to direct
    return await cmdSyncQrisDirect(normalized, ctx);
  }

  // Non-QRIS sync
  output({
    ok: true,
    action: 'sync',
    phone: normalized,
    bridgeSynced: true,
    events: bridgeResult.data?.events || [],
    clientOrderId: bridgeResult.data?.state?.orderContext?.clientOrderId || null
  });
}

async function cmdSyncQrisDirect(phone, ctx) {
  // Fallback: use /payments/qris/direct which handles the full flow in one call
  const directPayload = {
    customer_phone: phone,
    customer_name: ctx.customerName || null,
    items: ctx.items || [],
    fulfillment_method: ctx.fulfillmentMethod || ctx.fulfillment || null,
    shareloc: ctx.shareloc || null,
    delivery_provider: ctx.deliveryProvider || null,
    raw_message: ctx.rawMessage || null
  };

  const result = await fetchJson(`${BACKEND_BASE_URL}/payments/qris/direct`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(directPayload)
  });

  if (!result.ok) {
    die(`QRIS direct failed: ${result.error || JSON.stringify(result)}`);
  }

  output({
    ok: true,
    action: 'sync',
    phone,
    bridgeSynced: true,
    qrisCreated: !result.data?.skipped,
    whatsappSent: result.data?.whatsapp_sent || false,
    whatsappError: result.data?.whatsapp_error || null,
    clientOrderId: result.data?.client_order_id || null,
    qrImageUrl: result.data?.qr_image_url || null
  });
}

async function cmdStatus(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) die(`Invalid phone: ${phone}`);

  // Check local state first
  const state = await loadState(normalized);
  if (!state) {
    die(`No active order state found for ${normalized}`);
  }

  // Support both nested and flat state formats
  const ctx = state.orderContext || state;

  // Query bridge for live state
  const bridgeResult = await fetchJson(
    `${BACKEND_BASE_URL}/bridge/order-context/${encodeURIComponent(normalized)}`,
    { method: 'GET', headers: buildHeaders() }
  );

  if (bridgeResult.ok && bridgeResult.data) {
    const liveCtx = bridgeResult.data.orderContext || bridgeResult.data || {};
    output({
      ok: true,
      action: 'status',
      phone: normalized,
      paymentMethod: liveCtx.paymentMethod || ctx.paymentMethod || state.paymentMethod || null,
      paymentStatus: liveCtx.paymentStatus || ctx.paymentStatus || state.paymentStatus || null,
      orderStatus: liveCtx.status || ctx.status || null,
      clientOrderId: liveCtx.clientOrderId || ctx.clientOrderId || state.orderId || null,
      customerName: liveCtx.customerName || ctx.customerName || state.customerName || null,
      source: 'bridge'
    });
    return;
  }

  // Fallback to local state
  output({
    ok: true,
    action: 'status',
    phone: normalized,
    paymentMethod: ctx.paymentMethod || state.paymentMethod || null,
    paymentStatus: ctx.paymentStatus || state.paymentStatus || null,
    orderStatus: ctx.status || null,
    clientOrderId: ctx.clientOrderId || state.orderId || null,
    customerName: ctx.customerName || null,
    source: 'local_state'
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

const [,, command, phone] = process.argv;

if (!command || !['sync', 'status'].includes(command)) {
  die('Usage: node backend/sync-state.js <sync|status> <customer_phone>');
}

if (!phone) {
  die(`Usage: node backend/sync-state.js ${command} <customer_phone>`);
}

try {
  if (command === 'sync') {
    await cmdSync(phone);
  } else if (command === 'status') {
    await cmdStatus(phone);
  }
} catch (err) {
  die(`Unexpected error: ${err.message}`);
}
