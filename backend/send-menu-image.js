#!/usr/bin/env node

/**
 * Send menu image to customer via WhatsApp
 * Usage: node send-menu-image.js <customer_phone> <menu_id>
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

const execFileAsync = promisify(execFile);
const WACLI_BIN = process.env.WACLI_BIN || 'wacli';
const IMAGES_DIR = join(__dirname, 'public', 'menu-images');
const MENU_SCHEMA_PATH = join(__dirname, '..', 'menu-schema.json');

function normalizePhone(phone) {
  let p = String(phone).trim().replace(/[\s\-()]/g, '');
  if (p.startsWith('08')) p = '+62' + p.slice(1);
  if (p.startsWith('62') && !p.startsWith('+')) p = '+' + p;
  return p.startsWith('+') ? p : null;
}

function toJid(phone) {
  const n = normalizePhone(phone);
  if (!n) return null;
  return n.slice(1) + '@s.whatsapp.net';
}

function findMenu(query) {
  const schema = JSON.parse(readFileSync(MENU_SCHEMA_PATH, 'utf8'));
  const q = query.toLowerCase().trim();
  
  // Exact match by id
  let found = schema.menus.find(m => m.id === q);
  if (found) return found;
  
  // Match by name
  found = schema.menus.find(m => m.name.toLowerCase() === q);
  if (found) return found;
  
  // Match by alias
  found = schema.menus.find(m => (m.aliases || []).some(a => a.toLowerCase() === q));
  if (found) return found;
  
  // Fuzzy match
  found = schema.menus.find(m => m.name.toLowerCase().includes(q) || q.includes(m.name.toLowerCase()));
  if (found) return found;
  
  return null;
}

function formatPrice(price) {
  return `Rp${new Intl.NumberFormat('id-ID').format(price)}`;
}

async function run() {
  const phone = process.argv[2];
  const menuQuery = process.argv.slice(3).join(' ');
  
  if (!phone || !menuQuery) {
    console.error(JSON.stringify({ ok: false, error: 'Usage: node send-menu-image.js <phone> <menu_name_or_id>' }));
    process.exit(1);
  }
  
  const jid = toJid(phone);
  if (!jid) {
    console.error(JSON.stringify({ ok: false, error: 'Invalid phone number' }));
    process.exit(1);
  }
  
  const menu = findMenu(menuQuery);
  if (!menu) {
    console.log(JSON.stringify({ ok: false, error: `Menu not found: ${menuQuery}` }));
    process.exit(0);
  }
  
  // Check if local image exists (by menu ID slug)
  const localImagePath = join(IMAGES_DIR, `${menu.id}.jpg`);
  const localImagePng = join(IMAGES_DIR, `${menu.id}.png`);
  const imagePath = existsSync(localImagePath) ? localImagePath : existsSync(localImagePng) ? localImagePng : null;
  
  if (!imagePath) {
    // No image — send text only
    const caption = `${menu.name} — ${formatPrice(menu.price)}`;
    console.log(JSON.stringify({ ok: true, sent: 'text', menu: menu.name, hasImage: false }));
    process.exit(0);
  }
  
  // Send image with caption
  const caption = `☕ ${menu.name}\n💰 ${formatPrice(menu.price)}`;
  
  try {
    const { stdout } = await execFileAsync(WACLI_BIN, [
      'send', 'file',
      '--to', jid,
      '--file', imagePath,
      '--caption', caption
    ], { timeout: 30_000 });
    
    console.log(JSON.stringify({ ok: true, sent: 'image', menu: menu.name, price: menu.price, stdout: stdout?.trim() }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}

run().catch(console.error);
