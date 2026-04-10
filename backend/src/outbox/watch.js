import 'dotenv/config';
import { ensureOutboxDirs } from './fs.js';
import { processSobatNgupiOutboxOnce } from './processor.js';
import { outboxScanIntervalMs } from './config.js';

await ensureOutboxDirs();
console.log(`SobatNgupi outbox watcher running every ${outboxScanIntervalMs}ms`);

async function tick() {
  try {
    const result = await processSobatNgupiOutboxOnce();
    if (result.length > 0) {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error('Outbox watcher error:', error.message);
  }
}

await tick();
setInterval(tick, outboxScanIntervalMs);
