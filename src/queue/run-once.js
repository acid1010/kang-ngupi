import 'dotenv/config';
import { ensureQueueDirs } from './fs.js';
import { processAllQueues } from './processor.js';

await ensureQueueDirs();
const result = await processAllQueues();
console.log(JSON.stringify(result, null, 2));
