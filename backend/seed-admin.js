#!/usr/bin/env node

/**
 * Seed dashboard admin user
 * Usage: node seed-admin.js <username> <password> [name]
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

// Ensure data dir exists
mkdirSync(join(__dirname, 'data'), { recursive: true });

const { createUser } = await import('./src/dashboard/auth.js');

const username = process.argv[2];
const password = process.argv[3];
const name = process.argv[4] || username;

if (!username || !password) {
  console.error('Usage: node seed-admin.js <username> <password> [name]');
  process.exit(1);
}

try {
  const user = createUser({ username, password, role: 'admin', name });
  console.log('Admin user created:', JSON.stringify(user, null, 2));
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
