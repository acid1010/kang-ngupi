import { bridgeUrl } from './config.js';
import { listInboxFiles, moveOutboxFile, readOutboxJson } from './fs.js';

const bridgeTimeoutMs = Number(process.env.OUTBOX_POST_TIMEOUT_MS || 15000);
if (!Number.isFinite(bridgeTimeoutMs) || bridgeTimeoutMs < 1000) {
  throw new Error('OUTBOX_POST_TIMEOUT_MS must be a number >= 1000');
}

async function postToBridge(payload) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.BACKEND_API_KEY) {
    headers['x-api-key'] = process.env.BACKEND_API_KEY;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), bridgeTimeoutMs);

  let response;
  try {
    response = await fetch(bridgeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Bridge POST timeout after ${bridgeTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bridge POST failed (${response.status}): ${text}`);
  }

  return response.json();
}

export async function processSobatNgupiOutboxOnce() {
  const files = await listInboxFiles();
  const results = [];

  for (const file of files) {
    try {
      const payload = await readOutboxJson(file);
      const response = await postToBridge(payload);
      const movedTo = await moveOutboxFile(file, 'processed');
      results.push({ file, status: 'processed', movedTo, response });
    } catch (error) {
      const movedTo = await moveOutboxFile(file, 'failed').catch(() => null);
      results.push({ file, status: 'failed', movedTo, error: error.message });
    }
  }

  return results;
}
