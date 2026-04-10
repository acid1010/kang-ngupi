import 'dotenv/config';
import logger from '../lib/logger.js';
import { ensureQueueDirs } from './fs.js';
import { retryFailedQueues } from './processor.js';

await ensureQueueDirs();
const result = await retryFailedQueues();
logger.info({ result }, 'Queue retry-failed completed');
