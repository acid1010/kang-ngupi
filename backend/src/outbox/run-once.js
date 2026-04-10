import 'dotenv/config';
import logger from '../lib/logger.js';
import { ensureOutboxDirs } from './fs.js';
import { processSobatNgupiOutboxOnce } from './processor.js';

await ensureOutboxDirs();
const result = await processSobatNgupiOutboxOnce();
logger.info({ result }, 'Outbox run-once completed');
