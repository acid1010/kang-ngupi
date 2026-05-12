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

  // Issue 2 fix: Detect stale state (>2 hours old, still pending) and archive before proceeding
  const ctx0 = state.orderContext || state;
  const stateCreatedAt = ctx0.createdAt || state.createdAt;
  if (stateCreatedAt) {
    const ageMs = Date.now() - new Date(stateCreatedAt).getTime();
    const isStale = ageMs > 2 * 60 * 60 * 1000; // >2 hours
    const isPending = !ctx0.paymentStatus || ctx0.paymentStatus === 'pending';
    if (isStale && isPending) {
      // Archive stale state
      const expiredDir = path.join(WORKSPACE_ROOT, 'state', 'orders-expired');
      await fs.mkdir(expiredDir, { recursive: true });
      const staleId = ctx0.clientOrderId || ctx0.orderId || state.orderId || 'unknown';
      await fs.rename(stateFilePath(normalized), path.join(expiredDir, `${normalized}-${staleId}-stale-expired.json`)).catch(() => {});
      die(`Stale order detected (${staleId}, ${Math.round(ageMs / 60000)}min old). Archived. Please write a fresh state file.`);
    }
  }

  // Support both nested (orderContext wrapper) and flat state formats
  const ctx = state.orderContext || state;

  // Preserve Pawoon tracking fields (bot may overwrite state file without these)
  // Read from separate tracking file that bot doesn't touch
  const trackingFile = path.join(WORKSPACE_ROOT, 'state', 'orders-active', `.${makeStateFileName(normalized)}.pawoon`);
  let _pawoonPushed = false;
  let _pawoonLastItemCount = 0;
  try {
    const trackRaw = await fs.readFile(trackingFile, 'utf8');
    const trackData = JSON.parse(trackRaw);
    _pawoonPushed = trackData._pawoonPushed || false;
    _pawoonLastItemCount = trackData._pawoonLastItemCount || 0;
  } catch (_) {}
  // Also check state file as fallback
  if (!_pawoonPushed) {
    _pawoonPushed = ctx._pawoonPushed || state._pawoonPushed || false;
    _pawoonLastItemCount = ctx._pawoonLastItemCount || state._pawoonLastItemCount || 0;
  }

  // Issue 3 fix: Ensure createdAt exists for scheduler age tracking
  if (!ctx.createdAt && !state.createdAt) {
    ctx.createdAt = new Date().toISOString();
    // Write back so scheduler can read it
    await fs.writeFile(stateFilePath(normalized), JSON.stringify(state.orderContext ? state : ctx, null, 2), 'utf8');
  }

  // Do not auto-write customer profiles during sync.
  // Customer profile persistence should happen only from deliberate customer/profile flows,
  // not from payment sync or admin/test traffic, otherwise first greeting can become polluted.

  // Determine if this is a QRIS payment trigger
  // If paymentMethod is qris but no paymentStatus, assume pending (bot sometimes omits it)
  const effectivePaymentStatus = ctx.paymentStatus || (ctx.paymentMethod === 'qris' ? 'pending' : null);
  const isQris = ctx.paymentMethod === 'qris' &&
    ['pending', 'waiting', 'awaiting_payment'].includes(effectivePaymentStatus);

  // Step 1: Sync state to bridge
  const bridgePayload = {
    customer_phone: normalized,
    updates: {
      customerName: ctx.customerName || state.customerName || null,
      customerPhone: normalized,
      rawMessage: ctx.rawMessage || state.rawMessage || null,
      items: ctx.items || state.items || [],
      fulfillmentMethod: ctx.fulfillmentMethod || state.fulfillment || null,
      tableNumber: ctx.tableNumber || state.tableNumber || null,
      locationStatus: ctx.locationStatus || null,
      shareloc: ctx.shareloc || state.shareloc || null,
      address: ctx.address || null,
      paymentMethod: ctx.paymentMethod || state.paymentMethod || null,
      paymentStatus: ctx.paymentStatus || state.paymentStatus || null,
      deliveryProvider: ctx.deliveryProvider || state.deliveryProvider || null,
      deliveryFee: Number(ctx.deliveryFee || ctx.ongkir || state.deliveryFee || 0),
      notes: Array.isArray(ctx.notes) ? ctx.notes : (typeof ctx.notes === 'string' ? [ctx.notes] : []),
      customerNotes: Array.isArray(ctx.customerNotes) ? ctx.customerNotes : (typeof ctx.customerNotes === 'string' ? [ctx.customerNotes] : (state.customerNotes ? (Array.isArray(state.customerNotes) ? state.customerNotes : [state.customerNotes]) : [])),
      channel: ctx.channel || 'whatsapp'
    }
  };

  // clientOrderId: use from ctx, or auto-generate based on fulfillment
  let clientOrderId = ctx.clientOrderId || state.orderId || null;
  if (!clientOrderId) {
    // Auto-generate using order-counter.js for collision-safe IDs
    const prefix = ctx.fulfillmentMethod === 'delivery' ? 'DL'
      : ctx.fulfillmentMethod === 'dine_in' ? 'DI'
      : 'PU';
    try {
      const { execFileSync } = await import('node:child_process');
      const counterOut = execFileSync('node', ['/home/ubuntu/workspace-sobatngupi/backend/order-counter.js', 'next', prefix], { timeout: 5000, encoding: 'utf8' });
      const counterData = JSON.parse(counterOut.trim());
      clientOrderId = counterData.orderId;
    } catch (_) {
      const now = new Date(Date.now() + 7 * 3600000);
      const ddmm = String(now.getDate()).padStart(2, '0') + String(now.getMonth() + 1).padStart(2, '0');
      const hhmm = now.toISOString().slice(11, 16).replace(':', '');
      clientOrderId = `${prefix}-${ddmm}-${hhmm}-${Date.now().toString(36).slice(-3)}`;
    }
  }
  bridgePayload.updates.clientOrderId = clientOrderId;

  // Pass Pawoon tracking fields to bridge so evaluator can detect delta pushes
  bridgePayload.updates._pawoonPushed = _pawoonPushed;
  bridgePayload.updates._pawoonLastItemCount = _pawoonLastItemCount;

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
    const qrisProvider = process.env.QRIS_PROVIDER || 'pakasir';
    const clientOrderId = bridgeResult.data?.state?.orderContext?.clientOrderId || ctx.clientOrderId || state.orderId;

    // If Doku provider, go directly to Doku flow (skip evaluator/Pakasir entirely)
    if (qrisProvider === 'doku') {
      const itemsTotal = (ctx.items || []).reduce((sum, i) => sum + (Number(i.price || 0) * (i.quantity || 1)), 0);
      const deliveryFee = Number(ctx.deliveryFee || ctx.ongkir || 0);
      const totalAmount = itemsTotal + deliveryFee;
      return await cmdSyncQrisDoku(normalized, { ...ctx, clientOrderId }, totalAmount);
    }

    // Check if evaluator already auto-created QRIS (Pakasir path)
    const events = bridgeResult.data?.events || [];
    const qrisEvent = events.find(e => e.type === 'qris_payment_created');

    if (qrisEvent) {
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
  // For cash_at_counter dine-in: push EVERY time (barista sees each order, printer fires)
  // Use table session tracking (DB + file) to add sequence labels
  if (ctx.paymentMethod === 'cash_at_counter') {
    const trackFile = path.join(WORKSPACE_ROOT, 'state', 'orders-active', `.${makeStateFileName(normalized)}.pawoon`);
    (async () => {
      try {
        // Read tracking to get session order count
        const trackRaw = await fs.readFile(trackFile, 'utf8').catch(() => '{}');
        const trackData = JSON.parse(trackRaw);
        const orderSeq = (trackData.trackedOrderId === clientOrderId && trackData._pawoonPushed)
          ? (trackData.orderSeq || 1) + 1
          : 1;

        // Build items for this push (ALL current items)
        const allItems = (ctx.items || []).map(i => ({
          menu_name: i.menuName || i.menu_name,
          qty: i.quantity || i.qty || 1,
          price: Number(i.price || 0),
          notes: i.notes || null
        }));

        // Calculate running total
        const orderAmount = allItems.reduce((sum, i) => sum + (i.price * i.qty), 0);

        // Session label for Pawoon notes
        const sessionLabel = orderSeq === 1
          ? `Meja ${ctx.tableNumber} - Order #1`
          : `Meja ${ctx.tableNumber} - Order #${orderSeq} (Total: Rp${orderAmount.toLocaleString('id-ID')})`;

        // If this is a re-push (item added), only push NEW items
        let pushItems = allItems;
        if (orderSeq > 1 && trackData._pawoonLastItemCount) {
          // Push only the new items (delta)
          pushItems = allItems.slice(trackData._pawoonLastItemCount);
          if (pushItems.length === 0) return; // No new items, skip
        }

        const pushRes = await fetchJson(`${BACKEND_BASE_URL}/integrations/pawoon/push`, {
          method: 'POST',
          headers: buildHeaders(),
          body: JSON.stringify({
            client_order_id: clientOrderId + (orderSeq > 1 ? '-' + orderSeq : ''),
            customer_name: ctx.customerName || null,
            customer_phone: normalized,
            fulfillment_method: ctx.fulfillmentMethod || 'dine_in',
            table_number: ctx.tableNumber || null,
            payment_method: 'cash',
            payment_status: ctx.paymentStatus,
            items: pushItems,
            notes: sessionLabel
          })
        });

        // Track in DB (table_sessions)
        try {
          const { getOrCreateTableSession, addOrderToSession } = await import('./src/table-session.js');
          const session = await getOrCreateTableSession(ctx.tableNumber, {
            customerPhone: normalized,
            customerName: ctx.customerName || null
          });
          await addOrderToSession(session.id, {
            orderId: clientOrderId + (orderSeq > 1 ? '-' + orderSeq : ''),
            pawoonOrderId: pushRes?.pawoonOrderId || null,
            amount: pushItems.reduce((sum, i) => sum + (i.price * (i.qty || 1)), 0)
          });
        } catch (dbErr) {
          // Non-fatal — file tracking is primary, DB is bonus
          console.error('[sync] table_sessions DB error:', dbErr.message);
        }

        // Write tracking file
        await fs.writeFile(trackFile, JSON.stringify({
          _pawoonPushed: true,
          _pawoonLastItemCount: allItems.length,
          pawoonOrderId: pushRes?.pawoonOrderId || null,
          trackedOrderId: clientOrderId,
          orderSeq,
          pushedAt: new Date().toISOString()
        }), 'utf8');
      } catch (_) {}
    })();
  }

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
  // Calculate total amount including delivery fee
  const itemsTotal = (ctx.items || []).reduce((sum, i) => sum + (Number(i.price || 0) * (i.quantity || 1)), 0);
  const deliveryFee = Number(ctx.deliveryFee || ctx.ongkir || 0);
  const totalAmount = itemsTotal + deliveryFee;

  const qrisProvider = process.env.QRIS_PROVIDER || 'pakasir';

  if (qrisProvider === 'doku') {
    return await cmdSyncQrisDoku(phone, ctx, totalAmount);
  }

  // Fallback: use /payments/qris/direct which handles the full flow in one call
  const directPayload = {
    customer_phone: phone,
    customer_name: ctx.customerName || null,
    items: ctx.items || [],
    fulfillment_method: ctx.fulfillmentMethod || ctx.fulfillment || null,
    shareloc: ctx.shareloc || null,
    delivery_provider: ctx.deliveryProvider || null,
    raw_message: ctx.rawMessage || null,
    amount: totalAmount > 0 ? totalAmount : null
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

async function cmdSyncQrisDoku(phone, ctx, totalAmount) {
  let orderId = ctx.clientOrderId || ctx.orderId;
  if (!orderId) {
    // Use order-counter.js for collision-safe ID generation
    const prefix = ctx.fulfillmentMethod === 'delivery' ? 'DL'
      : ctx.fulfillmentMethod === 'dine_in' ? 'DI' : 'PU';
    try {
      const { execFileSync } = await import('node:child_process');
      const counterOut = execFileSync('node', ['/home/ubuntu/workspace-sobatngupi/backend/order-counter.js', 'next', prefix], { timeout: 5000, encoding: 'utf8' });
      const counterData = JSON.parse(counterOut.trim());
      orderId = counterData.orderId;
    } catch (counterErr) {
      // Fallback: use timestamp-based ID if counter fails
      const now = new Date(Date.now() + 7 * 3600000);
      const ddmm = (now.getDate() + '').padStart(2, '0') + (now.getMonth() + 1 + '').padStart(2, '0');
      const hhmm = now.toISOString().slice(11, 16).replace(':', '');
      orderId = `${prefix}-${ddmm}-${hhmm}-${Date.now().toString(36).slice(-3)}`;
    }
  }
  const amount = totalAmount > 0 ? totalAmount : null;

  if (!amount) {
    die('Cannot generate QRIS: total amount is 0 or missing');
  }

  // Step 0: Ensure order exists in DB (so webhook/poller can update it later)
  try {
    const dbCheck = await fetchJson(`${BACKEND_BASE_URL}/orders/${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: buildHeaders()
    });
    if (!dbCheck.ok || !dbCheck.data?.id) {
      // Create order in DB via webhook endpoint
      const orderPayload = {
        event_type: 'final_order',
        order: {
          client_order_id: orderId,
          customer: { name: ctx.customerName || null, phone },
          channel: 'whatsapp',
          raw_message: ctx.rawMessage || null,
          items: (ctx.items || []).map(i => ({
            menu_id: i.menuId || null,
            menu_name: i.menuName || i.menu_name || 'Unknown',
            qty: i.qty || i.quantity || 1,
            temperature: i.temperature || null,
            notes: i.notes || null
          })),
          fulfillment: {
            method: ctx.fulfillmentMethod || 'delivery',
            shareloc: ctx.deliveryLocation || ctx.shareloc || null,
            delivery_fee: ctx.deliveryFee || 0
          },
          payment: { method: 'qris', status: 'pending' },
          status: 'awaiting_payment',
          notes: ctx.customerNotes ? [ctx.customerNotes] : []
        }
      };
      const createResult = await fetchJson(`${BACKEND_BASE_URL}/webhooks/orders`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(orderPayload)
      });
      if (createResult.ok) {
        // Order created in DB
      }
    }
  } catch (_) {
    // Non-fatal — order may not exist in DB but QRIS flow continues
  }

  // Step 1: Generate QRIS via Doku (with retry on duplicate orderId)
  let dokuResult = await fetchJson(`${BACKEND_BASE_URL}/payments/doku/qris`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ orderId, amount, validityMinutes: 30 })
  });

  // Retry with unique suffix if Doku rejects duplicate orderId (4044718)
  if (!dokuResult.ok && JSON.stringify(dokuResult).includes('4044718')) {
    const retryId = `${orderId}-${Date.now().toString(36).slice(-4)}`;
    dokuResult = await fetchJson(`${BACKEND_BASE_URL}/payments/doku/qris`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ orderId: retryId, amount, validityMinutes: 30 })
    });
    if (dokuResult.ok) {
      // Update orderId reference for tracking
      orderId = retryId;
    }
  }

  if (!dokuResult.ok) {
    die(`Doku QRIS generation failed: ${dokuResult.error || JSON.stringify(dokuResult)}`);
  }

  const qrContent = dokuResult.qrContent;
  const referenceNo = dokuResult.referenceNo;

  if (!qrContent) {
    die('Doku returned empty qrContent');
  }

  // Step 2: Track payment for auto-verification polling
  const pendingDir = path.join(WORKSPACE_ROOT, 'state', 'doku-pending');
  try {
    await fs.mkdir(pendingDir, { recursive: true });
    await fs.writeFile(path.join(pendingDir, `${orderId}.json`), JSON.stringify({
      orderId,
      referenceNo,
      phone,
      customerName: ctx.customerName || null,
      amount,
      fulfillmentMethod: ctx.fulfillmentMethod || ctx.fulfillment || null,
      createdAt: new Date().toISOString(),
      attempts: 0
    }, null, 2));
  } catch (e) {
    // Non-fatal — poller just won't track this one
  }

  // Step 3: Send QR image to customer via WhatsApp (wacli)
  const { sendQrisImageWhatsApp } = await import('./src/notifications/whatsapp.js');
  const waResult = await sendQrisImageWhatsApp({
    to: phone,
    customerName: ctx.customerName || null,
    amount,
    qrString: qrContent,
    force: true
  });

  output({
    ok: true,
    action: 'sync',
    phone,
    provider: 'doku',
    bridgeSynced: true,
    qrisCreated: true,
    whatsappSent: waResult.ok || false,
    whatsappError: waResult.ok ? null : (waResult.error || waResult.reason || null),
    clientOrderId: orderId,
    referenceNo,
    amount
  });
}

async function cmdFinalBill(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) die(`Invalid phone: ${phone}`);

  const state = await loadState(normalized);
  if (!state) die(`No active order state found for ${normalized}`);

  const ctx = state.orderContext || state;
  const clientOrderId = ctx.clientOrderId || state.orderId || null;
  const tableNum = ctx.tableNumber || null;

  if (!clientOrderId) die('No clientOrderId in state');
  if (ctx.fulfillmentMethod !== 'dine_in') die('final-bill only for dine-in orders');

  // Build ALL items for final bill
  const allItems = (ctx.items || []).map(i => ({
    menu_name: i.menuName || i.menu_name,
    qty: i.quantity || i.qty || 1,
    price: Number(i.price || 0),
    notes: i.notes || null
  }));

  if (allItems.length === 0) die('No items in order');

  const totalAmount = allItems.reduce((sum, i) => sum + (i.price * i.qty), 0);

  // Push FINAL BILL to Pawoon (all items, marked as final)
  const pushRes = await fetchJson(`${BACKEND_BASE_URL}/integrations/pawoon/push`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      client_order_id: clientOrderId,
      customer_name: ctx.customerName || null,
      customer_phone: normalized,
      fulfillment_method: 'dine_in',
      table_number: tableNum,
      payment_method: 'cash',
      payment_status: ctx.paymentStatus || 'pending_at_counter',
      items: allItems,
      _isFinalBill: true
    })
  });

  output({
    ok: true,
    action: 'final-bill',
    phone: normalized,
    clientOrderId,
    tableNumber: tableNum,
    totalAmount,
    itemCount: allItems.length,
    pawoonOrderId: pushRes?.pawoonOrderId || null
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
  const qrisProvider = process.env.QRIS_PROVIDER || 'pakasir';

  // If Doku provider and we have a referenceNo, query Doku directly
  if (qrisProvider === 'doku' && (ctx.referenceNo || state.referenceNo)) {
    const refNo = ctx.referenceNo || state.referenceNo;
    const partnerRef = ctx.clientOrderId || state.orderId || null;

    const dokuStatus = await fetchJson(`${BACKEND_BASE_URL}/payments/doku/query`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ originalReferenceNo: refNo, partnerReferenceNo: partnerRef })
    });

    if (dokuStatus.ok) {
      const paid = dokuStatus.paid === true;
      output({
        ok: true,
        action: 'status',
        phone: normalized,
        paymentMethod: 'qris',
        paymentStatus: paid ? 'confirmed' : 'pending',
        orderStatus: paid ? 'paid' : 'awaiting_payment',
        clientOrderId: partnerRef,
        customerName: ctx.customerName || state.customerName || null,
        provider: 'doku',
        paidTime: dokuStatus.paidTime || null,
        source: 'doku_query'
      });
      return;
    }
  }

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

if (!command || !['sync', 'status', 'final-bill'].includes(command)) {
  die('Usage: node backend/sync-state.js <sync|status|final-bill> <customer_phone>');
}

if (!phone) {
  die(`Usage: node backend/sync-state.js ${command} <customer_phone>`);
}

try {
  if (command === 'sync') {
    await cmdSync(phone);
  } else if (command === 'status') {
    await cmdStatus(phone);
  } else if (command === 'final-bill') {
    await cmdFinalBill(phone);
  }
} catch (err) {
  die(`Unexpected error: ${err.message}`);
}
