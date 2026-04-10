import path from 'node:path';
import { createPakasirQrisPayment } from '../payments/service.js';
import { inferQueueKindFromFileName, listQueueFiles, moveToBucket, readJson } from './fs.js';
import { webhookUrl } from './config.js';

async function postPayload(payload) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webhook POST failed (${response.status}): ${text}`);
  }

  return response.json();
}

function shouldAutoCreateQris(payload = {}) {
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
