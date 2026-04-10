import 'dotenv/config';
import { ensureOutboxDirs } from './fs.js';
import { processSobatNgupiOutboxOnce } from './processor.js';

await ensureOutboxDirs();
const result = await processSobatNgupiOutboxOnce();
console.log(JSON.stringify(result, null, 2));
