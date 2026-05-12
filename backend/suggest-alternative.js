#!/usr/bin/env node

/**
 * Suggest Alternative Items
 * 
 * When a menu item is unavailable, suggests 1-2 alternatives from the same
 * category that are available, with similar price range.
 * 
 * Usage: node backend/suggest-alternative.js <menuName>
 * 
 * Output: JSON
 * {
 *   "ok": true,
 *   "requested": { "name": "...", "category": "...", "price": 25000 },
 *   "alternatives": [
 *     { "name": "...", "price": 23000, "description": "..." },
 *     { "name": "...", "price": 25000, "description": "..." }
 *   ]
 * }
 * 
 * If item is available: { "ok": true, "available": true, "message": "Item is available" }
 * If item not found: { "ok": false, "error": "Item not found" }
 * If no alternatives: { "ok": true, "alternatives": [], "message": "No alternatives available" }
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MENU_PATH = join(__dirname, '..', 'menu-schema.json');

function normalize(str) {
  return str.toLowerCase().trim().replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
}

function findItem(menus, query) {
  const q = normalize(query);
  
  // Exact name match
  let found = menus.find(m => normalize(m.name) === q);
  if (found) return found;
  
  // Alias match
  found = menus.find(m => (m.aliases || []).some(a => normalize(a) === q));
  if (found) return found;
  
  // Partial match (contains)
  found = menus.find(m => normalize(m.name).includes(q) || q.includes(normalize(m.name)));
  if (found) return found;
  
  // Fuzzy: alias partial
  found = menus.find(m => (m.aliases || []).some(a => normalize(a).includes(q) || q.includes(normalize(a))));
  return found || null;
}

function suggestAlternatives(menus, item, maxResults = 2) {
  // Get items from same category that are available
  const sameCategory = menus.filter(m => 
    m.category === item.category && 
    m.available === true && 
    m.id !== item.id
  );
  
  if (sameCategory.length === 0) {
    // Fallback: try adjacent price range across all categories
    const priceRange = item.price * 0.5;
    const crossCategory = menus.filter(m =>
      m.available === true &&
      m.id !== item.id &&
      Math.abs(m.price - item.price) <= priceRange
    );
    // Sort by price similarity
    crossCategory.sort((a, b) => Math.abs(a.price - item.price) - Math.abs(b.price - item.price));
    return crossCategory.slice(0, maxResults);
  }
  
  // Sort by price similarity to requested item
  sameCategory.sort((a, b) => Math.abs(a.price - item.price) - Math.abs(b.price - item.price));
  
  return sameCategory.slice(0, maxResults);
}

function main() {
  const query = process.argv.slice(2).join(' ').trim();
  
  if (!query) {
    console.log(JSON.stringify({ ok: false, error: 'Usage: node suggest-alternative.js <menuName>' }));
    process.exit(1);
  }
  
  let schema;
  try {
    schema = JSON.parse(readFileSync(MENU_PATH, 'utf8'));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: `Cannot read menu-schema: ${err.message}` }));
    process.exit(1);
  }
  
  const menus = schema.menus || [];
  const item = findItem(menus, query);
  
  if (!item) {
    console.log(JSON.stringify({ ok: false, error: 'Item not found', query }));
    process.exit(0);
  }
  
  if (item.available) {
    console.log(JSON.stringify({ 
      ok: true, 
      available: true, 
      message: 'Item is available',
      item: { name: item.name, price: item.price, category: item.category }
    }));
    process.exit(0);
  }
  
  const alternatives = suggestAlternatives(menus, item);
  
  const result = {
    ok: true,
    requested: {
      name: item.name,
      category: item.category,
      price: item.price
    },
    alternatives: alternatives.map(a => ({
      name: a.name,
      price: a.price,
      description: a.description ? a.description.slice(0, 80) : null
    }))
  };
  
  if (alternatives.length === 0) {
    result.message = 'No alternatives available in this category';
  }
  
  console.log(JSON.stringify(result));
}

main();
