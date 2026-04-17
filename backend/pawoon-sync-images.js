#!/usr/bin/env node

/**
 * Sync menu images from Pawoon to local storage
 * Downloads product images and maps them to menu-schema.json items
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

const PAWOON_BASE_URL = process.env.PAWOON_BASE_URL || 'https://open-api.pawoon.com';
const IMAGES_DIR = join(__dirname, 'public', 'menu-images');
const MENU_SCHEMA_PATH = join(__dirname, '..', 'menu-schema.json');

async function getToken() {
  const res = await fetch(`${PAWOON_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.PAWOON_CLIENT_ID,
      client_secret: process.env.PAWOON_CLIENT_SECRET
    })
  });
  const data = await res.json();
  return data.access_token;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
}

async function downloadImage(url, filepath) {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    await pipeline(res.body, createWriteStream(filepath));
    return true;
  } catch {
    return false;
  }
}

async function run() {
  mkdirSync(IMAGES_DIR, { recursive: true });

  console.log('Getting Pawoon token...');
  const token = await getToken();

  console.log('Fetching products...');
  const allProducts = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${PAWOON_BASE_URL}/products?outlet_id=${process.env.PAWOON_OUTLET_ID}&is_sellable=true&per_page=100&page=${page}`,
      { headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` } }
    );
    const data = await res.json();
    allProducts.push(...(data.data || []).filter(p => typeof p === 'object'));
    if (page >= Math.ceil((data.meta?.total || 0) / 100)) break;
    page++;
  }

  // Download images
  let downloaded = 0;
  let skipped = 0;
  let noImage = 0;
  const imageMap = {};

  for (const p of allProducts) {
    if (!p.image) { noImage++; continue; }

    const slug = slugify(p.name);
    const ext = p.image.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || 'jpg';
    const filename = `${slug}.${ext}`;
    const filepath = join(IMAGES_DIR, filename);

    if (existsSync(filepath)) {
      skipped++;
      imageMap[slug] = filename;
      continue;
    }

    const ok = await downloadImage(p.image, filepath);
    if (ok) {
      downloaded++;
      imageMap[slug] = filename;
      console.log(`  ✅ ${p.name} → ${filename}`);
    } else {
      console.log(`  ❌ ${p.name} — download failed`);
    }
  }

  // Update menu-schema.json with image paths
  const schema = JSON.parse(readFileSync(MENU_SCHEMA_PATH, 'utf8'));
  let updated = 0;
  for (const menu of schema.menus) {
    const slug = menu.id || slugify(menu.name);
    if (imageMap[slug]) {
      menu.image = `/menu-images/${imageMap[slug]}`;
      updated++;
    }
  }
  writeFileSync(MENU_SCHEMA_PATH, JSON.stringify(schema, null, 2) + '\n');

  console.log(`\nDone: ${downloaded} downloaded, ${skipped} cached, ${noImage} no image`);
  console.log(`Menu schema: ${updated} items with images`);
}

run().catch(console.error);
