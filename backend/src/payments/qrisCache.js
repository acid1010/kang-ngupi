/**
 * QRIS Pre-generation Cache
 * 
 * Pre-generates QRIS when order is confirmed (has items + total).
 * When customer picks QRIS payment, cached QR is sent instantly.
 * 
 * Cache key: clientOrderId
 * TTL: 30 minutes (Pakasir QRIS expiry is typically 30-60min)
 */

import logger from '../lib/logger.js';

const cache = new Map();
const CACHE_TTL_MS = 25 * 60 * 1000; // 25 min (buffer before 30min expiry)

export function getCachedQris(clientOrderId) {
  const entry = cache.get(clientOrderId);
  if (!entry) return null;
  
  // Check TTL
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(clientOrderId);
    logger.info('[qris-cache] Expired: %s', clientOrderId);
    return null;
  }
  
  return entry;
}

export function setCachedQris(clientOrderId, data) {
  cache.set(clientOrderId, {
    ...data,
    createdAt: Date.now()
  });
  logger.info('[qris-cache] Cached QRIS for %s (amount: %s)', clientOrderId, data.amount);
  
  // Auto-cleanup after TTL
  setTimeout(() => {
    cache.delete(clientOrderId);
  }, CACHE_TTL_MS);
}

export function hasCachedQris(clientOrderId) {
  const entry = cache.get(clientOrderId);
  if (!entry) return false;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(clientOrderId);
    return false;
  }
  return true;
}

/**
 * Pre-generate QRIS in background when order is confirmed.
 * Called from evaluator when items + total are ready.
 */
export async function preGenerateQris({ clientOrderId, amount, customerPhone, customerName }) {
  if (!clientOrderId || !amount || amount <= 0) return;
  
  // Don't re-generate if already cached
  if (hasCachedQris(clientOrderId)) {
    logger.info('[qris-cache] Already cached: %s', clientOrderId);
    return;
  }

  try {
    // Create QRIS via Pakasir (without sending to WhatsApp yet)
    const pakasirUrl = process.env.PAKASIR_BASE_URL || 'https://app.pakasir.com';
    const res = await fetch(`${pakasirUrl}/api/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PAKASIR_API_KEY}`
      },
      body: JSON.stringify({
        project: process.env.PAKASIR_PROJECT || 'ngupibot',
        order_id: clientOrderId,
        amount: Number(amount),
        payment_method: 'qris'
      })
    });

    if (!res.ok) {
      logger.warn('[qris-cache] Pakasir error %d for %s', res.status, clientOrderId);
      return;
    }

    const data = await res.json();
    const qrString = data.data?.qr_string || data.qr_string;
    const providerOrderId = data.data?.id || data.id;
    const expiredAt = data.data?.expired_at || data.expired_at;

    if (!qrString) {
      logger.warn('[qris-cache] No QR string from Pakasir for %s', clientOrderId);
      return;
    }

    setCachedQris(clientOrderId, {
      qrString,
      providerOrderId,
      expiredAt,
      amount: Number(amount),
      customerPhone,
      customerName,
      clientOrderId
    });

    logger.info('[qris-cache] Pre-generated QRIS for %s (%s)', clientOrderId, amount);
  } catch (err) {
    logger.warn('[qris-cache] Pre-generation failed for %s: %s', clientOrderId, err.message);
  }
}

export function getCacheStats() {
  return {
    size: cache.size,
    keys: [...cache.keys()]
  };
}
