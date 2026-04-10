import fs from 'node:fs/promises';
import path from 'node:path';
import { queueDirs } from './config.js';

export async function ensureQueueDirs() {
  await Promise.all(Object.values(queueDirs).map((dir) => fs.mkdir(dir, { recursive: true })));
}

export async function listQueueFiles(kind) {
  const dir = queueDirs[kind];
  const entries = await fs.readdir(dir);
  return entries.filter((name) => name.endsWith('.json')).sort().map((name) => path.join(dir, name));
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function moveToBucket(filePath, bucket) {
  const fileName = path.basename(filePath);
  const target = path.join(queueDirs[bucket], fileName);
  await fs.rename(filePath, target);
  return target;
}

export function inferQueueKindFromFileName(fileName) {
  if (String(fileName).startsWith('final_')) return 'final';
  return 'draft';
}

export function buildQueueFileName(kind, clientOrderId) {
  const safeId = String(clientOrderId).replace(/[^a-zA-Z0-9._-]/g, '_');
  const normalizedId = safeId.startsWith(`${kind}_`) ? safeId.slice(kind.length + 1) : safeId;
  return `${kind}_${normalizedId}.json`;
}

export async function writeQueueFile(kind, fileName, payload) {
  const filePath = path.join(queueDirs[kind], fileName);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}
