import 'dotenv/config';
import { ensureQueueDirs } from './fs.js';
import { retryFailedQueues } from './processor.js';

await ensureQueueDirs();
const result = await retryFailedQueues();
console.log(JSON.stringify(result, null, 2));
