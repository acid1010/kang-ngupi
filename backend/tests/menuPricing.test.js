import { describe, it, expect } from 'vitest';
import {
  resolveCatalogEntryForItem,
  getUnitPriceForItem,
  calculateOrderAmount
} from '../src/catalog/menuPricing.js';

// ─── resolveCatalogEntryForItem ──────────────────────────────────────────────

describe('resolveCatalogEntryForItem', () => {
  it('resolves by exact menuId', () => {
    const entry = resolveCatalogEntryForItem({ menuId: 'americano' });
    expect(entry).not.toBeNull();
    expect(entry.menuId).toBe('americano');
  });

  it('resolves by menuName (case insensitive)', () => {
    const entry = resolveCatalogEntryForItem({ menuName: 'Americano' });
    expect(entry).not.toBeNull();
    expect(entry.price).toBeGreaterThan(0);
  });

  it('resolves by alias (kopsu)', () => {
    const entry = resolveCatalogEntryForItem({ menuName: 'kopsu' });
    expect(entry).not.toBeNull();
    expect(entry.menuId).toContain('kopi-susu');
  });

  it('resolves by fuzzy match (partial name)', () => {
    const entry = resolveCatalogEntryForItem({ menuName: 'kopi susu original' });
    expect(entry).not.toBeNull();
  });

  it('returns null for unknown item', () => {
    const entry = resolveCatalogEntryForItem({ menuName: 'xyzzy-tidak-ada-di-menu' });
    expect(entry).toBeNull();
  });

  it('returns null for empty item', () => {
    const entry = resolveCatalogEntryForItem({});
    expect(entry).toBeNull();
  });
});

// ─── getUnitPriceForItem ─────────────────────────────────────────────────────

describe('getUnitPriceForItem', () => {
  it('returns price for known item', () => {
    const price = getUnitPriceForItem({ menuId: 'americano' });
    expect(typeof price).toBe('number');
    expect(price).toBeGreaterThan(0);
  });

  it('returns null for unknown item', () => {
    const price = getUnitPriceForItem({ menuName: 'item tidak ada' });
    expect(price).toBeNull();
  });
});

// ─── calculateOrderAmount ────────────────────────────────────────────────────

describe('calculateOrderAmount', () => {
  it('calculates total from known items', () => {
    const total = calculateOrderAmount([
      { menuId: 'americano', qty: 2 },
    ]);
    expect(total).toBeGreaterThan(0);
    expect(total % 1).toBe(0); // integer
  });

  it('uses amountOverride when provided', () => {
    const total = calculateOrderAmount([], 50000);
    expect(total).toBe(50000);
  });

  it('rounds amountOverride to integer', () => {
    const total = calculateOrderAmount([], 50000.7);
    expect(total).toBe(50001);
  });

  it('throws for invalid amountOverride', () => {
    expect(() => calculateOrderAmount([], -1)).toThrow();
    expect(() => calculateOrderAmount([], 0)).toThrow();
    expect(() => calculateOrderAmount([], 'abc')).toThrow();
  });

  it('throws for empty items with no override', () => {
    expect(() => calculateOrderAmount([])).toThrow('cannot calculate payment amount without order items');
  });

  it('throws for item with no price mapping and no fallback', () => {
    expect(() => calculateOrderAmount([
      { menuName: 'item tidak ada', qty: 1 }
    ])).toThrow('missing price mapping');
  });

  it('uses item.price as fallback when catalog has no match', () => {
    const total = calculateOrderAmount([
      { menuName: 'item tidak ada', qty: 2, price: 15000 }
    ]);
    expect(total).toBe(30000);
  });

  it('skips items with qty <= 0', () => {
    expect(() => calculateOrderAmount([
      { menuId: 'americano', qty: 0 }
    ])).toThrow(); // all items skipped → total = 0 → throws
  });

  it('calculates multi-item order correctly', () => {
    const total = calculateOrderAmount([
      { menuId: 'americano', qty: 1 },
      { menuId: 'americano', qty: 1 }
    ]);
    const single = calculateOrderAmount([{ menuId: 'americano', qty: 1 }]);
    expect(total).toBe(single * 2);
  });
});
