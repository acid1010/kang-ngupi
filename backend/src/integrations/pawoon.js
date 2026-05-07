/**
 * Pawoon Order Push — create transaction in Pawoon POS when order is paid
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import logger from '../lib/logger.js';

const PAWOON_TIMEOUT_MS = 15_000;

function withTimeout(ms = PAWOON_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const PAWOON_BASE_URL = process.env.PAWOON_BASE_URL || 'https://open-api.pawoon.com';
const PAWOON_CLIENT_ID = process.env.PAWOON_CLIENT_ID;
const PAWOON_CLIENT_SECRET = process.env.PAWOON_CLIENT_SECRET;
const PAWOON_OUTLET_ID = process.env.PAWOON_OUTLET_ID || 'c531acc0-3205-11ea-a231-e565033da4bd';
// Sales type IDs from Pawoon
const PAWOON_SALES_TYPE_DELIVERY = process.env.PAWOON_SALES_TYPE_DELIVERY || null;
const PAWOON_SALES_TYPE_PICKUP = process.env.PAWOON_SALES_TYPE_PICKUP || null;
const PAWOON_SALES_TYPE_DINE_IN = process.env.PAWOON_SALES_TYPE_DINE_IN || null;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const { signal, clear } = withTimeout();
  const res = await fetch(`${PAWOON_BASE_URL}/oauth/token`, {
    signal,
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: PAWOON_CLIENT_ID,
      client_secret: PAWOON_CLIENT_SECRET
    })
  });

  clear();
  const data = await res.json();
  if (!data.access_token) throw new Error('Pawoon auth failed');

  cachedToken = data.access_token;
  // Token expires in 1 year but refresh every 23 hours
  tokenExpiresAt = Date.now() + (23 * 60 * 60 * 1000);
  return cachedToken;
}

// Map our menu IDs to Pawoon product IDs
let productMap = null;

async function loadProductMap() {
  if (productMap) return productMap;

  const token = await getToken();
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

  // Build map: lowercase name -> pawoon product
  productMap = new Map();
  for (const p of allProducts) {
    productMap.set(p.name.toLowerCase(), p);
    // Also map by our slug format
    const slug = p.name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
    productMap.set(slug, p);
  }

  logger.info('[pawoon] Loaded %d products for mapping', allProducts.length);
  return productMap;
}

function formatOrderTime() {
  // Format as WIB (UTC+7) with correct local time
  const now = new Date();
  const wib = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  return wib.toISOString().replace('Z', '+07:00');
}

export async function pushOrderToPawoon(order, items, payment) {
  if (!PAWOON_CLIENT_ID || !PAWOON_CLIENT_SECRET) {
    return { ok: false, skipped: true, reason: 'pawoon_not_configured' };
  }

  try {
    const token = await getToken();
    const pMap = await loadProductMap();

    // Map items to Pawoon products
    const pawoonItems = [];
    for (const item of (items || [])) {
      const menuName = (item.menu_name || '').toLowerCase();
      const menuId = (item.menu_id || '').toLowerCase();

      // Try to find Pawoon product by name or slug
      const pawoonProduct = pMap.get(menuName) || pMap.get(menuId);

      if (!pawoonProduct) {
        logger.warn('[pawoon] Product not found in Pawoon: %s', item.menu_name);
        continue;
      }

      pawoonItems.push({
        product_id: pawoonProduct.id,
        qty: Number(item.qty) || 1,
        notes: item.temperature ? `${item.temperature}${item.notes ? ' - ' + item.notes : ''}` : (item.notes || ''),
        price: Number(pawoonProduct.price) || 0
      });
    }

    if (pawoonItems.length === 0) {
      return { ok: false, skipped: true, reason: 'no_matching_products' };
    }

    // Build order payload
    const totalAmount = Number(payment?.total_payment || payment?.amount || 
      pawoonItems.reduce((sum, i) => sum + (i.price * i.qty), 0)) || 0;

    const orderPayload = {
      data: {
        receipt_code: order.client_order_id || `WA-${Date.now()}`,
        outlet_id: PAWOON_OUTLET_ID,
        order_time: formatOrderTime(),
        customer_name: order.customer_name_snapshot || 'WhatsApp Customer',
        customer_phone: order.customer_phone_snapshot || '',
        notes: `WhatsApp Order - ${order.fulfillment_method || 'delivery'}`,
        items: pawoonItems,
        payment: {
          amount: (order.payment_method === 'cash_at_counter' && order.payment_status !== 'confirmed') ? 0 : totalAmount,
          method: 'cash'
        },
        feature_flags: {
          order_accepted_type: 'auto'
        }
      }
    };

    // Add sales type based on fulfillment method
    const salesTypeId = order.fulfillment_method === 'delivery' 
      ? PAWOON_SALES_TYPE_DELIVERY 
      : order.fulfillment_method === 'dine_in'
      ? PAWOON_SALES_TYPE_DINE_IN
      : PAWOON_SALES_TYPE_PICKUP;

    // Add table info for dine-in orders
    const tableNum = order.table_number || order.tableNumber || null;
    if (order.fulfillment_method === 'dine_in' && tableNum) {
      orderPayload.data.notes = `Table No: Meja ${tableNum}.`;
    } else if (order.fulfillment_method === 'dine_in') {
      orderPayload.data.notes = `WhatsApp Dine-In Order`;
    }
    logger.info('[pawoon] Dine-in push: fulfillment=%s, table=%s', order.fulfillment_method, tableNum);
    if (salesTypeId) {
      orderPayload.data.company_sales_type_id = salesTypeId;
    }

    // Submit to Pawoon
    const { signal: orderSignal, clear: clearOrder } = withTimeout();
    const res = await fetch(`${PAWOON_BASE_URL}/orders`, {
      signal: orderSignal,
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(orderPayload)
    });
    clearOrder();

    const result = await res.json();

    if (res.ok && result.data?.id) {
      logger.info('[pawoon] Order pushed: %s -> Pawoon ID: %s', order.client_order_id, result.data.id);
      return { ok: true, pawoonOrderId: result.data.id };
    } else {
      logger.warn('[pawoon] Order push failed: %s', JSON.stringify(result));
      return { ok: false, error: result.message || result.error || 'Unknown error', details: result };
    }
  } catch (error) {
    logger.error('[pawoon] Order push error: %s', error.message);
    return { ok: false, error: error.message };
  }
}
