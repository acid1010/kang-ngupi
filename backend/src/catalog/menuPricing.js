import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');

let _cache = null;

function loadMenuSchema() {
  if (_cache) return _cache;
  const raw = readFileSync(path.join(ROOT_DIR, 'menu-schema.json'), 'utf8');
  _cache = JSON.parse(raw);
  return _cache;
}

function buildPricingFromSchema() {
  const schema = loadMenuSchema();
  const map = {};

  for (const menu of schema.menus ?? []) {
    const aliases = [
      menu.id,
      String(menu.name).toLowerCase(),
      ...(menu.aliases ?? []),
      ...(menu.ambiguousAliases ?? [])
    ];

    map[menu.id] = {
      name: menu.name,
      price: menu.price,
      aliases
    };
  }

  return map;
}

const MENU_PRICING = buildPricingFromSchema();

function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findCatalogEntry(item = {}) {
  const candidates = [item.menu_id, item.menuId, item.menu_name, item.menuName, item.name]
    .filter(Boolean)
    .map(normalizeKey);

  // Exact match first
  for (const [menuId, entry] of Object.entries(MENU_PRICING)) {
    const keys = [menuId, entry.name, ...(entry.aliases ?? [])].map(normalizeKey);
    if (candidates.some((candidate) => keys.includes(candidate))) {
      return { menuId, ...entry };
    }
  }

  // Fuzzy match: check if any candidate is a substring of (or contains) a known alias
  for (const [menuId, entry] of Object.entries(MENU_PRICING)) {
    const keys = [menuId, entry.name, ...(entry.aliases ?? [])].map(normalizeKey);
    for (const candidate of candidates) {
      if (!candidate || candidate.length < 3) continue;
      for (const key of keys) {
        if (key.includes(candidate) || candidate.includes(key)) {
          return { menuId, ...entry };
        }
      }
    }
  }

  return null;
}

export function resolveCatalogEntryForItem(item = {}) {
  return findCatalogEntry(item);
}

export function getUnitPriceForItem(item = {}) {
  const entry = findCatalogEntry(item);
  return entry?.price ?? null;
}

export function calculateOrderAmount(items = [], amountOverride = null) {
  if (amountOverride !== null && amountOverride !== undefined && amountOverride !== '') {
    const explicit = Number(amountOverride);
    if (!Number.isFinite(explicit) || explicit <= 0) {
      throw new Error('amount override must be a positive number');
    }
    return Math.round(explicit);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('cannot calculate payment amount without order items');
  }

  let total = 0;

  for (const item of items) {
    const qty = Number(item.qty ?? item.quantity ?? item.count ?? 0);
    const unitPrice = getUnitPriceForItem(item);

    if (!Number.isFinite(qty) || qty <= 0) {
      continue;
    }

    if (!unitPrice) {
      const label = item.menu_name ?? item.menuName ?? item.name ?? item.menu_id ?? 'unknown-item';
      throw new Error(`missing price mapping for item: ${label}`);
    }

    total += unitPrice * qty;
  }

  if (total <= 0) {
    throw new Error('calculated payment amount is invalid');
  }

  return total;
}
