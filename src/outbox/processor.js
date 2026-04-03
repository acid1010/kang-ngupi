import { bridgeUrl } from './config.js';
import { listInboxFiles, moveOutboxFile, readOutboxJson } from './fs.js';

async function postToBridge(payload) {
  const response = await fetch(bridgeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

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
