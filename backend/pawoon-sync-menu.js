#!/usr/bin/env node

/**
 * Pawoon Menu Sync — Pull products from Pawoon POS and update menu-schema.json
 * 
 * Usage: node pawoon-sync-menu.js
 * 
 * What it does:
 * 1. Authenticates with Pawoon API
 * 2. Pulls all sellable products for the outlet
 * 3. Filters drink categories
 * 4. Updates menu-schema.json with Pawoon prices as source of truth
 * 5. Adds new products, updates existing, preserves aliases
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

const PAWOON_BASE_URL = 'https://open-api.pawoon.com';
const PAWOON_CLIENT_ID = process.env.PAWOON_CLIENT_ID;
const PAWOON_CLIENT_SECRET = process.env.PAWOON_CLIENT_SECRET;
const PAWOON_OUTLET_ID = process.env.PAWOON_OUTLET_ID || 'c531acc0-3205-11ea-a231-e565033da4bd';
const MENU_SCHEMA_PATH = join(__dirname, '..', 'menu-schema.json');

// Drink category IDs from Pawoon
const DRINK_CATEGORIES = new Set([
  'bf2a8c80-227b-11f0-9d88-c9e89868a3fb', // Espresso & Manual Brew
  '55ef51f0-22b5-11f0-970d-854a22dc6d7c', // Es Kopi Susu Gula Aren
  '71b39e90-22b5-11f0-aa01-4d32c08285dc', // Kopi Susu Botol
  'f1b03460-231c-11f0-8d2d-95f7debceadd', // Milk Based Coffee
  '0360daa0-2371-11f0-bd97-9f2dc7b6ab5f', // Signature Coffee
  '55d80260-2373-11f0-8c6a-579acc173d3e', // Es Kopi Blend
  'bef1e990-2396-11f0-a756-05ffe487927b', // Fresh & Healthy
  '0183bce0-239d-11f0-afe3-290c9db56300', // Milkshake
  '01421bd0-239e-11f0-9163-31b4ab9c6547', // Chocolate
  '9fabb400-23c3-11f0-9486-a3e3bceaa5ff', // Tea
]);

// Category name mapping for menu-schema
const CATEGORY_NAMES = {
  'bf2a8c80-227b-11f0-9d88-c9e89868a3fb': 'espresso',
  '55ef51f0-22b5-11f0-970d-854a22dc6d7c': 'kopi-susu',
  '71b39e90-22b5-11f0-aa01-4d32c08285dc': 'kopi-botol',
  'f1b03460-231c-11f0-8d2d-95f7debceadd': 'milk-coffee',
  '0360daa0-2371-11f0-bd97-9f2dc7b6ab5f': 'signature',
  '55d80260-2373-11f0-8c6a-579acc173d3e': 'blend',
  'bef1e990-2396-11f0-a756-05ffe487927b': 'fresh',
  '0183bce0-239d-11f0-afe3-290c9db56300': 'milkshake',
  '01421bd0-239e-11f0-9163-31b4ab9c6547': 'chocolate',
  '9fabb400-23c3-11f0-9486-a3e3bceaa5ff': 'tea',
};

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function generateAliases(name) {
  const lower = name.toLowerCase();
  const aliases = [lower];
  
  // Common alias patterns
  if (lower.startsWith('es ')) aliases.push(lower.slice(3));
  if (lower.includes('kopi susu')) aliases.push('kopsu', 'kopi susu');
  if (lower.includes('americano')) aliases.push('amer', 'americano');
  if (lower.includes('cappuccino')) aliases.push('cappuccino', 'capuccino');
  if (lower.includes('caffe latte')) aliases.push('latte', 'cafe latte');
  if (lower.includes('matcha')) aliases.push('matcha');
  if (lower.includes('chocolate') && !lower.includes('choco')) aliases.push('coklat', 'cokelat');
  if (lower.includes('reguler tea')) aliases.push('teh', 'teh manis', 'es teh');
  
  return [...new Set(aliases)];
}

async function getToken() {
  const res = await fetch(`${PAWOON_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: PAWOON_CLIENT_ID,
      client_secret: PAWOON_CLIENT_SECRET
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get Pawoon token');
  return data.access_token;
}

async function fetchProducts(token) {
  const allProducts = [];
  let page = 1;
  
  while (true) {
    const res = await fetch(
      `${PAWOON_BASE_URL}/products?outlet_id=${PAWOON_OUTLET_ID}&is_sellable=true&per_page=100&page=${page}`,
      { headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` } }
    );
    const data = await res.json();
    const products = data.data || [];
    allProducts.push(...products.filter(p => typeof p === 'object'));
    
    const meta = data.meta || {};
    if (page >= Math.ceil((meta.total || 0) / (meta.per_page || 100))) break;
    page++;
  }
  
  return allProducts;
}

async function run() {
  if (!PAWOON_CLIENT_ID || !PAWOON_CLIENT_SECRET) {
    console.error('Missing PAWOON_CLIENT_ID or PAWOON_CLIENT_SECRET in .env');
    process.exit(1);
  }

  console.log('Authenticating with Pawoon...');
  const token = await getToken();
  
  console.log('Fetching products...');
  const allProducts = await fetchProducts(token);
  console.log(`Fetched ${allProducts.length} total products`);
  
  // Filter drinks
  const drinks = allProducts.filter(p => DRINK_CATEGORIES.has(p.product_category_id) && p.sellable);
  console.log(`Found ${drinks.length} drink products`);
  
  // Load existing menu-schema
  const schema = JSON.parse(readFileSync(MENU_SCHEMA_PATH, 'utf8'));
  const existingMenus = new Map(schema.menus.map(m => [m.id, m]));
  
  // Build updated menus
  const updatedMenus = [];
  let added = 0, updated = 0, unchanged = 0;
  
  for (const drink of drinks) {
    const id = slugify(drink.name);
    const existing = existingMenus.get(id);
    const category = CATEGORY_NAMES[drink.product_category_id] || 'other';
    
    if (existing) {
      // Update price from Pawoon, preserve aliases
      const priceChanged = existing.price !== drink.price;
      updatedMenus.push({
        ...existing,
        price: drink.price,
        pawoonId: drink.id,
        category
      });
      if (priceChanged) {
        console.log(`  Updated: ${drink.name} Rp${existing.price} → Rp${drink.price}`);
        updated++;
      } else {
        unchanged++;
      }
      existingMenus.delete(id);
    } else {
      // New product
      updatedMenus.push({
        id,
        name: drink.name,
        aliases: generateAliases(drink.name),
        price: drink.price,
        pawoonId: drink.id,
        category
      });
      console.log(`  Added: ${drink.name} — Rp${drink.price}`);
      added++;
    }
  }
  
  // Keep existing items not in Pawoon (manual additions)
  for (const [id, menu] of existingMenus) {
    updatedMenus.push({ ...menu, category: menu.category || 'manual' });
    console.log(`  Kept (not in Pawoon): ${menu.name}`);
  }
  
  // Sort by category then name
  updatedMenus.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
  
  // Write updated schema
  schema.menus = updatedMenus;
  schema.lastSyncedAt = new Date().toISOString();
  schema.syncSource = 'pawoon';
  writeFileSync(MENU_SCHEMA_PATH, JSON.stringify(schema, null, 2) + '\n');
  
  console.log(`\nSync complete: ${added} added, ${updated} price updated, ${unchanged} unchanged`);
  console.log(`Total menu items: ${updatedMenus.length}`);
}

run().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
