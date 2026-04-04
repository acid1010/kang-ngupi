const MENU_PRICING = {
  'kopi-susu-original': {
    name: 'Es Kopi Susu Original',
    price: 17000,
    aliases: ['kopi-susu-original', 'kopi susu', 'es kopi susu original', 'es kopi susu']
  },
  americano: {
    name: 'Americano',
    price: 15000,
    aliases: ['americano', 'amer']
  },
  'caffe-latte': {
    name: 'Caffe Latte',
    price: 21000,
    aliases: ['caffe-latte', 'caffe latte', 'latte', 'cafe latte']
  },
  cappuccino: {
    name: 'Cappuccino',
    price: 21000,
    aliases: ['cappuccino', 'capuccino', 'cappucino', 'capucino']
  }
};

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

  for (const [menuId, entry] of Object.entries(MENU_PRICING)) {
    const keys = [menuId, entry.name, ...(entry.aliases ?? [])].map(normalizeKey);
    if (candidates.some((candidate) => keys.includes(candidate))) {
      return { menuId, ...entry };
    }
  }

  return null;
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
