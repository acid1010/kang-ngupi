import fs from 'node:fs/promises';
import path from 'node:path';
import { outboxDirs } from './config.js';

export async function ensureOutboxDirs() {
  await Promise.all(Object.values(outboxDirs).map((dir) => fs.mkdir(dir, { recursive: true })));
}

export async function listInboxFiles() {
  const entries = await fs.readdir(outboxDirs.inbox);
  return entries
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(outboxDirs.inbox, name));
}

export async function readOutboxJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function moveOutboxFile(filePath, bucket) {
  const fileName = path.basename(filePath);
  const target = path.join(outboxDirs[bucket], fileName);
  await fs.rename(filePath, target);
  return target;
}
