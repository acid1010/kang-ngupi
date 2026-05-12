#!/usr/bin/env node

/**
 * Format Digital Receipt
 * 
 * Generates a WhatsApp-friendly text receipt for completed orders.
 * 
 * Usage (as module):
 *   import { formatReceipt } from './format-receipt.js';
 *   const text = formatReceipt({ order, items, payment });
 * 
 * Usage (CLI for testing):
 *   node backend/format-receipt.js <client_order_id>
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MENU_PATH = join(__dirname, '..', 'menu-schema.json');

let menuCache = null;

function getMenuPrices() {
  if (menuCache) return menuCache;
  try {
    const schema = JSON.parse(readFileSync(MENU_PATH, 'utf8'));
    menuCache = new Map();
    for (const item of schema.menus || []) {
      menuCache.set(item.name.toLowerCase(), item.price);
      menuCache.set(item.id, item.price);
      for (const alias of item.aliases || []) {
        menuCache.set(alias.toLowerCase(), item.price);
      }
    }
  } catch (_) {
    menuCache = new Map();
  }
  return menuCache;
}

function formatRupiah(amount) {
  return 'Rp' + Number(amount).toLocaleString('id-ID');
}

function formatDate(isoString) {
  const d = new Date(isoString || Date.now());
  const wib = new Date(d.getTime() + 7 * 3600000);
  const day = wib.getDate().toString().padStart(2, '0');
  const month = (wib.getMonth() + 1).toString().padStart(2, '0');
  const year = wib.getFullYear();
  const hours = wib.getHours().toString().padStart(2, '0');
  const mins = wib.getMinutes().toString().padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${mins} WIB`;
}

/**
 * Format a digital receipt
 * 
 * @param {Object} opts
 * @param {string} opts.orderId - Client order ID
 * @param {string} opts.customerName - Customer name
 * @param {Array} opts.items - [{menuName, qty, price?}]
 * @param {string} opts.fulfillmentMethod - delivery/pickup/dine_in
 * @param {number} opts.tableNumber - Table number (dine-in)
 * @param {number} opts.deliveryFee - Delivery fee
 * @param {string} opts.paymentMethod - qris/cash_at_counter
 * @param {string} opts.paidAt - ISO timestamp
 * @returns {string} Formatted receipt text
 */
export function formatReceipt(opts) {
  const {
    orderId = '-',
    customerName = 'Customer',
    items = [],
    fulfillmentMethod = 'dine_in',
    tableNumber = null,
    deliveryFee = 0,
    paymentMethod = 'cash_at_counter',
    paidAt = null
  } = opts;

  const prices = getMenuPrices();

  // Calculate items with prices
  const itemLines = [];
  let subtotal = 0;

  for (const item of items) {
    const name = item.menuName || item.menu_name || 'Item';
    const qty = Number(item.qty || item.quantity || 1);
    // Price from item, or lookup from menu
    let price = Number(item.price || 0);
    if (!price) {
      price = prices.get(name.toLowerCase()) || prices.get(item.menu_id || '') || 0;
    }
    const lineTotal = price * qty;
    subtotal += lineTotal;
    itemLines.push(`• ${name} x${qty} — ${formatRupiah(lineTotal)}`);
  }

  const total = subtotal + Number(deliveryFee || 0);

  // Fulfillment label
  let fulfillmentLabel = 'Dine-in';
  if (fulfillmentMethod === 'delivery') fulfillmentLabel = 'Delivery';
  else if (fulfillmentMethod === 'self_pickup' || fulfillmentMethod === 'pickup') fulfillmentLabel = 'Pickup';
  if (tableNumber && fulfillmentMethod === 'dine_in') fulfillmentLabel += ` — Meja ${tableNumber}`;

  // Payment label
  const paymentLabel = paymentMethod === 'qris' ? 'QRIS' : 'Bayar di Kasir';

  // Build receipt
  let receipt = `🧾 *STRUK DIGITAL*\n`;
  receipt += `━━━━━━━━━━━━━━━━━━\n`;
  receipt += `📋 Order: ${orderId}\n`;
  receipt += `👤 ${customerName}\n`;
  receipt += `📍 ${fulfillmentLabel}\n`;
  receipt += `🕐 ${formatDate(paidAt)}\n`;
  receipt += `━━━━━━━━━━━━━━━━━━\n\n`;
  receipt += itemLines.join('\n');
  receipt += '\n\n';

  if (deliveryFee > 0) {
    receipt += `🛵 Ongkir Go Ngupi: ${formatRupiah(deliveryFee)}\n`;
  }

  receipt += `━━━━━━━━━━━━━━━━━━\n`;
  receipt += `💰 *Total: ${formatRupiah(total)}*\n`;
  receipt += `💳 ${paymentLabel} ✅\n`;
  receipt += `━━━━━━━━━━━━━━━━━━\n\n`;
  receipt += `Makasih kak ${customerName}! ☕\n`;
  receipt += `Ditunggu lagi di Ngupi-Ngupi ya!`;

  return receipt;
}

// CLI mode for testing
if (process.argv[2]) {
  const clientOrderId = process.argv[2];
  
  // Try to read from state files
  const { readdirSync } = await import('node:fs');
  const ACTIVE_DIR = join(__dirname, '..', 'state', 'orders-active');
  const EXPIRED_DIR = join(__dirname, '..', 'state', 'orders-expired');
  
  let stateData = null;
  
  // Check active
  for (const dir of [ACTIVE_DIR, EXPIRED_DIR]) {
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
          if (data.orderId === clientOrderId) {
            stateData = data;
            break;
          }
        } catch (_) {}
      }
    } catch (_) {}
    if (stateData) break;
  }

  if (stateData) {
    const receipt = formatReceipt({
      orderId: stateData.orderId,
      customerName: stateData.customerName,
      items: stateData.items,
      fulfillmentMethod: stateData.fulfillmentMethod,
      tableNumber: stateData.tableNumber,
      deliveryFee: stateData.deliveryFee || 0,
      paymentMethod: stateData.paymentMethod,
      paidAt: new Date().toISOString()
    });
    console.log(receipt);
  } else {
    console.log('Order not found:', clientOrderId);
  }
}
