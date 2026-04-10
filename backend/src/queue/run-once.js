import 'dotenv/config';
import logger from '../lib/logger.js';
import { ensureQueueDirs } from './fs.js';
import { processAllQueues } from './processor.js';

await ensureQueueDirs();
const result = await processAllQueues();
logger.info({ result }, 'Queue run-once completed');
