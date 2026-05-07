import path from 'node:path';
import { createPakasirQrisPayment } from '../payments/service.js';
import { inferQueueKindFromFileName, listQueueFiles, moveToBucket, readJson } from './fs.js';
import { webhookUrl } from './config.js';

const webhookTimeoutMs = Number(process.env.QUEUE_POST_TIMEOUT_MS || 15000);
if (!Number.isFinite(webhookTimeoutMs) || webhookTimeoutMs < 1000) {
  throw new Error('QUEUE_POST_TIMEOUT_MS must be a number >= 1000');
}

async function postPayload(payload) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.BACKEND_API_KEY) {
    headers['x-api-key'] = process.env.BACKEND_API_KEY;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), webhookTimeoutMs);

  let response;
  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Webhook POST timeout after ${webhookTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webhook POST failed (${response.status}): ${text}`);
  }

  return response.json();
}

function shouldAutoCreateQris(payload = {}) {
  // Disabled: QRIS is now handled by Doku via sync-state.js
  // Pakasir QRIS auto-create caused double QR (Doku + Pakasir)
  const qrisProvider = process.env.QRIS_PROVIDER || 'doku';
  if (qrisProvider === 'doku') return false;

  if (payload?.event_type !== 'draft_order') return false;

  const clientOrderId = payload?.order?.client_order_id ?? null;
  const paymentMethod = String(payload?.order?.payment?.method ?? '').trim().toLowerCase();
  const paymentStatus = String(payload?.order?.payment?.status ?? '').trim().toLowerCase();

  return Boolean(clientOrderId) && paymentMethod === 'qris' && ['pending', 'awaiting_payment', 'waiting'].includes(paymentStatus);
}

async function maybeCreateQrisPayment(payload) {
  if (!shouldAutoCreateQris(payload)) {
    return { ok: false, skipped: true, reason: 'not-applicable' };
  }

  try {
    const result = await createPakasirQrisPayment({
      clientOrderId: payload.order.client_order_id,
      baseUrl: process.env.PUBLIC_BASE_URL || null
    });

    return {
      ok: true,
      skipped: false,
      data: result
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: error.message
    };
  }
}

export async function processQueueKind(kind) {
  const files = await listQueueFiles(kind);
  const results = [];

  for (const file of files) {
    try {
      const payload = await readJson(file);
      const response = await postPayload(payload);
      const qrisPayment = await maybeCreateQrisPayment(payload);
      const movedTo = await moveToBucket(file, 'processed');
      results.push({ file, status: 'processed', movedTo, response, qrisPayment });
    } catch (error) {
      const movedTo = await moveToBucket(file, 'failed').catch(() => null);
      results.push({ file, status: 'failed', movedTo, error: error.message });
    }
  }

  return results;
}

export async function processAllQueues() {
  // Process draft first, then final.
  // This avoids a race where both queue kinds for the same client_order_id
  // hit the webhook concurrently and duplicate item inserts for one order.
  const draft = await processQueueKind('draft');
  const final = await processQueueKind('final');

  return { draft, final };
}

export async function retryFailedQueues() {
  const failedFiles = await listQueueFiles('failed');
  const requeued = [];

  for (const file of failedFiles) {
    const kind = inferQueueKindFromFileName(path.basename(file));
    const movedTo = await moveToBucket(file, kind);
    requeued.push({ file, kind, movedTo });
  }

  const processed = await processAllQueues();
  return { requeued, processed };
}
