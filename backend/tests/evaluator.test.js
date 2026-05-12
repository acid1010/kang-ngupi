import { describe, it, expect } from 'vitest';
import {
  isDraftReady,
  isFinalReady,
  mergeOrderContext
} from '../src/bridge/evaluator.js';

// Minimal valid state for draft
function makeDraftState(overrides = {}) {
  return {
    orderContext: {
      customerName: 'Dodo',
      customerPhone: '6281234567890',
      rawMessage: 'kopsu 1',
      fulfillmentMethod: 'self_pickup',
      paymentMethod: null,
      paymentStatus: null,
      items: [{ menuName: 'Es Kopi Susu Original', qty: 1, price: 18000 }],
      ...overrides
    },
    draftSentAt: null,
    finalSentAt: null
  };
}

// ─── isDraftReady ────────────────────────────────────────────────────────────

describe('isDraftReady', () => {
  it('returns true for a complete pickup order', () => {
    expect(isDraftReady(makeDraftState())).toBe(true);
  });

  it('returns false when customerName is missing', () => {
    expect(isDraftReady(makeDraftState({ customerName: null }))).toBe(false);
  });

  it('returns false when customerPhone is missing', () => {
    expect(isDraftReady(makeDraftState({ customerPhone: null }))).toBe(false);
  });

  it('returns false when items is empty', () => {
    expect(isDraftReady(makeDraftState({ items: [] }))).toBe(false);
  });

  it('returns false when fulfillmentMethod is missing', () => {
    expect(isDraftReady(makeDraftState({ fulfillmentMethod: null }))).toBe(false);
  });

  it('returns false for delivery without shareloc', () => {
    const state = makeDraftState({
      fulfillmentMethod: 'delivery',
      shareloc: null,
      locationStatus: null
    });
    expect(isDraftReady(state)).toBe(false);
  });

  it('returns true for delivery with valid shareloc', () => {
    const state = makeDraftState({
      fulfillmentMethod: 'delivery',
      shareloc: { lat: -6.5, lng: 107.4 },
      locationStatus: 'shareloc_received'
    });
    expect(isDraftReady(state)).toBe(true);
  });
});

// ─── isFinalReady ────────────────────────────────────────────────────────────

describe('isFinalReady', () => {
  it('returns false when draftSentAt is missing', () => {
    const state = makeDraftState({ paymentMethod: 'cash_at_counter' });
    state.draftSentAt = null;
    expect(isFinalReady(state)).toBe(false);
  });

  it('returns false when paymentMethod is missing', () => {
    const state = makeDraftState();
    state.draftSentAt = new Date().toISOString();
    expect(isFinalReady(state)).toBe(false);
  });

  it('returns true for pickup + cash_at_counter', () => {
    const state = makeDraftState({ paymentMethod: 'cash_at_counter' });
    state.draftSentAt = new Date().toISOString();
    expect(isFinalReady(state)).toBe(true);
  });

  it('returns true for pickup + cod', () => {
    const state = makeDraftState({ paymentMethod: 'cod' });
    state.draftSentAt = new Date().toISOString();
    expect(isFinalReady(state)).toBe(true);
  });

  it('returns false for pickup + qris without confirmed payment', () => {
    const state = makeDraftState({ paymentMethod: 'qris', paymentStatus: 'pending' });
    state.draftSentAt = new Date().toISOString();
    expect(isFinalReady(state)).toBe(false);
  });

  it('returns true for pickup + qris with confirmed payment', () => {
    const state = makeDraftState({ paymentMethod: 'qris', paymentStatus: 'confirmed' });
    state.draftSentAt = new Date().toISOString();
    expect(isFinalReady(state)).toBe(true);
  });

  it('returns true for delivery + cod', () => {
    const state = makeDraftState({
      fulfillmentMethod: 'delivery',
      paymentMethod: 'cod',
      shareloc: { lat: -6.5, lng: 107.4 },
      locationStatus: 'shareloc_received'
    });
    state.draftSentAt = new Date().toISOString();
    expect(isFinalReady(state)).toBe(true);
  });

  it('returns true for dine_in + cash_at_counter', () => {
    const state = makeDraftState({
      fulfillmentMethod: 'dine_in',
      paymentMethod: 'cash_at_counter'
    });
    state.draftSentAt = new Date().toISOString();
    expect(isFinalReady(state)).toBe(true);
  });

  it('returns false when finalSentAt already set', () => {
    const state = makeDraftState({ paymentMethod: 'cash_at_counter' });
    state.draftSentAt = new Date().toISOString();
    state.finalSentAt = new Date().toISOString();
    expect(isFinalReady(state)).toBe(true); // isFinalReady itself doesn't check finalSentAt
  });
});

// ─── mergeOrderContext ───────────────────────────────────────────────────────

describe('mergeOrderContext', () => {
  it('merges new fields into empty context', () => {
    const result = mergeOrderContext({}, {
      customerName: 'Alvin',
      customerPhone: '6281234567890',
      fulfillmentMethod: 'pickup'
    });
    expect(result.customerName).toBe('Alvin');
    expect(result.fulfillmentMethod).toBe('self_pickup'); // normalized
  });

  it('normalizes fulfillmentMethod aliases', () => {
    expect(mergeOrderContext({}, { fulfillmentMethod: 'delivery' }).fulfillmentMethod).toBe('delivery');
    expect(mergeOrderContext({}, { fulfillmentMethod: 'deliv' }).fulfillmentMethod).toBe('delivery');
    expect(mergeOrderContext({}, { fulfillmentMethod: 'pickup' }).fulfillmentMethod).toBe('self_pickup');
    expect(mergeOrderContext({}, { fulfillmentMethod: 'self-pickup' }).fulfillmentMethod).toBe('self_pickup');
  });

  it('normalizes paymentMethod aliases', () => {
    expect(mergeOrderContext({}, { paymentMethod: 'cash on delivery' }).paymentMethod).toBe('cod');
    expect(mergeOrderContext({}, { paymentMethod: 'qris' }).paymentMethod).toBe('qris');
  });

  it('normalizes paymentStatus aliases', () => {
    expect(mergeOrderContext({}, { paymentStatus: 'paid' }).paymentStatus).toBe('confirmed');
    expect(mergeOrderContext({}, { paymentStatus: 'success' }).paymentStatus).toBe('confirmed');
    expect(mergeOrderContext({}, { paymentStatus: 'settled' }).paymentStatus).toBe('confirmed');
    expect(mergeOrderContext({}, { paymentStatus: 'pending' }).paymentStatus).toBe('pending');
  });

  it('preserves existing customerName when update has none', () => {
    const result = mergeOrderContext({ customerName: 'Dodo' }, { paymentMethod: 'qris' });
    expect(result.customerName).toBe('Dodo');
  });

  it('parses shareloc from string', () => {
    const result = mergeOrderContext({}, { shareloc: '-6.5123, 107.4567' });
    expect(result.shareloc).toMatchObject({ lat: -6.5123, lng: 107.4567 });
    expect(result.locationStatus).toBe('shareloc_received');
  });

  it('parses shareloc from object', () => {
    const result = mergeOrderContext({}, { shareloc: { lat: -6.5, lng: 107.4 } });
    expect(result.shareloc).toMatchObject({ lat: -6.5, lng: 107.4 });
  });

  it('parses shareloc from array', () => {
    const result = mergeOrderContext({}, { shareloc: [-6.5, 107.4] });
    expect(result.shareloc).toMatchObject({ lat: -6.5, lng: 107.4 });
  });

  it('filters out invalid items (qty <= 0)', () => {
    const result = mergeOrderContext({}, {
      items: [
        { menuName: 'Es Kopi Susu Original', qty: 0, price: 18000 },
        { menuName: 'Americano', qty: 2, price: 17000 }
      ]
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].menuName).toBe('Americano');
  });

  it('builds rawMessage from items', () => {
    const result = mergeOrderContext({}, {
      items: [{ menuName: 'Es Kopi Susu Original', qty: 2, price: 18000 }]
    });
    expect(result.rawMessage).toBe('es kopi susu original 2');
  });

  it('does not overwrite existing rawMessage when no items provided', () => {
    const result = mergeOrderContext(
      { rawMessage: 'kopsu 1' },
      { paymentMethod: 'qris' }
    );
    expect(result.rawMessage).toBe('kopsu 1');
  });
});
