import 'dotenv/config';
import logger from '../lib/logger.js';
import { ensureOutboxDirs } from './fs.js';
import { processSobatNgupiOutboxOnce } from './processor.js';
import { outboxScanIntervalMs } from './config.js';

await ensureOutboxDirs();
logger.info(`SobatNgupi outbox watcher running every ${outboxScanIntervalMs}ms`);

async function tick() {
  try {
    const result = await processSobatNgupiOutboxOnce();
    if (result.length > 0) {
      logger.info({ result }, 'Outbox watcher processed');
    }
  } catch (error) {
    logger.error('Outbox watcher error: %s', error.message);
  }
}

await tick();
setInterval(tick, outboxScanIntervalMs);
