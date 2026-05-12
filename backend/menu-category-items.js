#!/usr/bin/env node
/**
 * Return items in a category by number or name.
 * Usage: node backend/menu-category-items.js <number|name>
 * Output: formatted item list for WA reply
 */
import { readFileSync } from 'fs';
const schema = JSON.parse(readFileSync('/home/ubuntu/workspace-sobatngupi/menu-schema.json', 'utf8'));
const arg = process.argv[2];
if (!arg) { console.error('Usage: node menu-category-items.js <number|name>'); process.exit(1); }

const categories = schema.categories;
let catName;
if (/^\d+$/.test(arg)) {
  const idx = parseInt(arg) - 1;
  if (idx < 0 || idx >= categories.length) { console.error('Invalid category number'); process.exit(1); }
  catName = categories[idx].name;
} else {
  catName = categories.find(c => c.name.toLowerCase().includes(arg.toLowerCase()))?.name;
  if (!catName) { console.error('Category not found: ' + arg); process.exit(1); }
}

const items = schema.menus.filter(m => m.category === catName);
const lines = items.map((item, i) => {
  const status = item.available ? '' : ' ❌ (habis)';
  const variant = item.variantOptions ? (() => {
    const opts = item.variantOptions.split(',').map(v => v.trim());
    // Extract unique base components (split by ' - ')
    const parts = new Set();
    opts.forEach(v => v.split(/\s*-\s*/).forEach(p => parts.add(p.trim())));
    const unique = [...parts].filter(p => !['Hot','Ice','Cold','Panas','Dingin'].includes(p));
    if (unique.length > 5) return ` (${opts.length} varian)`;
    return ` (${unique.join('/')})`;
  })() : '';
  const prefix = i === 0 ? '⭐' : '•';
  return `${prefix} ${item.name} — Rp${item.price.toLocaleString('id-ID')}${variant}${status}`;
});

console.log(`*${catName}*\n${lines.join('\n')}`);
