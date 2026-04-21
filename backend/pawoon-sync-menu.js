#!/usr/bin/env node

/**
 * Pawoon Menu Sync v2 — Pull ALL products from Pawoon POS with categories, variants, modifiers
 * 
 * Usage: node pawoon-sync-menu.js
 * 
 * Syncs EXACTLY what's in Pawoon:
 * - All 17 categories
 * - All sellable products
 * - Variants (e.g. Hot/Iced, size options)
 * - Modifier groups (e.g. toppings, extras)
 * - Prices from Pawoon as source of truth
 * - Preserves local aliases
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

async function getToken() {
  const res = await fetch(`${PAWOON_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: PAWOON_CLIENT_ID, client_secret: PAWOON_CLIENT_SECRET })
  });
  const data = await res.json();
  return data.access_token;
}

async function fetchPaginated(token, endpoint) {
  const all = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${PAWOON_BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`, {
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const items = data.data || [];
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < 100) break;
    page++;
  }
  return all;
}

async function fetchVariants(token, productId) {
  try {
    const res = await fetch(`${PAWOON_BASE_URL}/products/${productId}/variants?outlet_id=${PAWOON_OUTLET_ID}`, {
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    return (data.data || []).map(v => ({
      name: v.name,
      price: Number(v.price || 0),
      sku: v.sku || null
    }));
  } catch (_) {
    return [];
  }
}

async function fetchModifiers(token, productId) {
  try {
    const res = await fetch(`${PAWOON_BASE_URL}/products/${productId}/modifier-groups?outlet_id=${PAWOON_OUTLET_ID}`, {
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    return (data.data || []).map(mg => ({
      name: mg.name,
      required: mg.is_required || false,
      maxSelect: mg.max_select || null,
      options: (mg.modifiers || []).map(m => ({
        name: m.name,
        price: Number(m.price || 0)
      }))
    }));
  } catch (_) {
    return [];
  }
}

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

async function syncMenu() {
  console.log('Authenticating with Pawoon...');
  const token = await getToken();

  // Fetch categories
  console.log('Fetching categories...');
  const categories = await fetchPaginated(token, `/product-categories?outlet_id=${PAWOON_OUTLET_ID}`);
  const catMap = {};
  for (const c of categories) {
    catMap[c.id] = c.name;
  }
  console.log(`Found ${categories.length} categories`);

  // Fetch ALL products (including non-sellable for stock tracking)
  console.log('Fetching products...');
  const products = await fetchPaginated(token, `/products?outlet_id=${PAWOON_OUTLET_ID}`);
  console.log(`Found ${products.length} sellable products`);

  // Load existing menu for alias preservation
  let existingMenu = { menus: [] };
  try {
    existingMenu = JSON.parse(readFileSync(MENU_SCHEMA_PATH, 'utf8'));
  } catch (_) {}

  const existingAliases = {};
  for (const item of (existingMenu.menus || [])) {
    if (item.aliases?.length) {
      existingAliases[item.name] = item.aliases;
    }
  }

  // Fetch variants and modifiers for products that have them
  const withVariants = products.filter(p => p.has_variant);
  const withModifiers = products.filter(p => p.has_modifier);
  console.log(`Fetching variants for ${withVariants.length} products...`);
  console.log(`Fetching modifiers for ${withModifiers.length} products...`);

  const variantMap = {};
  for (const p of withVariants) {
    variantMap[p.id] = await fetchVariants(token, p.id);
  }

  const modifierMap = {};
  for (const p of withModifiers) {
    modifierMap[p.id] = await fetchModifiers(token, p.id);
  }

  // Build new menu
  let added = 0, updated = 0, unchanged = 0;
  const newMenus = [];

  // Exclude "Es Kopi Susu Flavour" (owner request)
  const excludeNames = ['Es Kopi Susu Flavour'];

  for (const p of products) {
    if (excludeNames.includes(p.name)) continue;

    const catName = catMap[p.product_category_id] || 'Lain-lain';
    const menuId = slugify(p.name);
    const price = Number(p.price || 0);

    const item = {
      id: menuId,
      pawoonId: p.id,
      name: p.name,
      category: catName,
      price,
      sku: p.sku || null,
      image: p.image || null,
      description: p.description || null,
      available: p.sellable === true,
      sellable: p.sellable === true,
    };

    // Add variants
    if (variantMap[p.id]?.length) {
      item.variants = variantMap[p.id];
    }

    // Add modifiers
    if (modifierMap[p.id]?.length) {
      item.modifiers = modifierMap[p.id];
    }

    // Preserve existing aliases
    if (existingAliases[p.name]) {
      item.aliases = existingAliases[p.name];
    }

    // Check if changed
    const existing = (existingMenu.menus || []).find(m => m.name === p.name);
    if (!existing) {
      added++;
    } else if (existing.price !== price || existing.category !== catName || existing.available !== (p.sellable === true)) {
      updated++;
    } else {
      unchanged++;
    }

    newMenus.push(item);
  }

  // Build category list
  const categoryList = categories.map(c => ({
    id: c.id,
    name: c.name,
    itemCount: newMenus.filter(m => m.category === c.name).length
  })).filter(c => c.itemCount > 0);

  // Write menu-schema.json
  const schema = {
    ...existingMenu,
    categories: categoryList,
    menus: newMenus,
    lastSyncedAt: new Date().toISOString(),
    syncSource: 'pawoon-v2',
    totalItems: newMenus.length,
    totalCategories: categoryList.length
  };

  writeFileSync(MENU_SCHEMA_PATH, JSON.stringify(schema));

  console.log(`\nSync complete: ${added} added, ${updated} price/category updated, ${unchanged} unchanged`);
  console.log(`Total menu items: ${newMenus.length} (${categoryList.length} categories)`);
  console.log(`Variants: ${Object.keys(variantMap).length} products`);
  console.log(`Modifiers: ${Object.keys(modifierMap).length} products`);
}

syncMenu().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
