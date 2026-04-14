import 'dotenv/config';
import logger from '../lib/logger.js';
import { ensureOutboxDirs } from './fs.js';
import { processSobatNgupiOutboxOnce } from './processor.js';
import { outboxScanIntervalMs } from './config.js';

await ensureOutboxDirs();
logger.info(`SobatNgupi outbox watcher running every ${outboxScanIntervalMs}ms`);

let isTickRunning = false;
let timer = null;

async function tick() {
  if (isTickRunning) {
    logger.warn('[outbox] Previous tick still running, skipping overlap');
    return;
  }

  isTickRunning = true;
  try {
    const result = await processSobatNgupiOutboxOnce();
    if (result.length > 0) {
      logger.info({ result }, 'Outbox watcher processed');
    }
  } catch (error) {
    logger.error('Outbox watcher error: %s', error.message);
  } finally {
    isTickRunning = false;
  }
}

const shutdown = (signal) => {
  logger.info('[outbox] %s received — shutting down', signal);
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await tick();
timer = setInterval(() => {
  void tick();
}, outboxScanIntervalMs);
