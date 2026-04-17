/**
 * Courier Notification — send WhatsApp notification to courier when order is paid
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizePhone } from '../builders/orderPayload.js';
import logger from '../lib/logger.js';

const execFileAsync = promisify(execFile);

// Courier phone numbers (can be multiple)
const COURIER_PHONES = (process.env.COURIER_PHONES || '').split(',').map(p => p.trim()).filter(Boolean);
const WACLI_BIN = process.env.WACLI_BIN || 'wacli';

function toJid(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const num = normalized.startsWith('+') ? normalized.slice(1) : normalized;
  return `${num}@s.whatsapp.net`;
}

function formatIdr(amount) {
  const value = Number(amount ?? 0);
  return `Rp${new Intl.NumberFormat('id-ID').format(Number.isFinite(value) ? value : 0)}`;
}

function buildCourierMessage(order, items, payment) {
  const name = order.customer_name_snapshot || 'Customer';
  const phone = order.customer_phone_snapshot || '-';
  const orderId = order.client_order_id || '-';
  const fulfillment = order.fulfillment_method || 'delivery';
  const paymentMethod = order.payment_method || '-';

  // Items list
  const itemLines = (items || []).map(i => {
    const temp = i.temperature ? ` (${i.temperature})` : '';
    return `- ${i.menu_name}${temp} x${i.qty}`;
  }).join('\n');

  // Total
  const total = payment?.total_payment || payment?.amount || 0;

  // Location
  let locationLine = '';
  if (order.location_lat && order.location_lng) {
    locationLine = `\n📍 Lokasi: https://maps.google.com/?q=${order.location_lat},${order.location_lng}`;
  }

  // Phone link
  const waLink = phone.startsWith('+') ? phone : `+${phone}`;

  return `🛵 *ORDER BARU — GO NGUPI*

📋 Order: ${orderId}
👤 Nama: ${name}
📱 HP: ${waLink}
💳 Bayar: ${paymentMethod.toUpperCase()} — ${formatIdr(total)} ✅

📦 Pesanan:
${itemLines}
${locationLine}
${fulfillment === 'pickup' ? '\n🏪 PICKUP — customer ambil sendiri' : '\n🛵 DELIVERY — antar ke lokasi customer'}

Segera proses ya! 🙏`;
}

async function sendWaCli(jid, message) {
  try {
    const { stdout } = await execFileAsync(WACLI_BIN, ['send', 'text', '--to', jid, '--message', message], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    return { ok: true, stdout: stdout?.trim() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function notifyCouriers(order, items, payment) {
  if (!COURIER_PHONES.length) {
    logger.warn('[courier] No courier phones configured (COURIER_PHONES env)');
    return { ok: false, skipped: true, reason: 'no_courier_phones' };
  }

  // Only notify for delivery orders that are paid
  if (order.fulfillment_method !== 'delivery') {
    return { ok: false, skipped: true, reason: 'not_delivery' };
  }

  const message = buildCourierMessage(order, items, payment);
  const results = [];

  for (const phone of COURIER_PHONES) {
    const jid = toJid(phone);
    if (!jid) {
      results.push({ phone, ok: false, error: 'invalid_phone' });
      continue;
    }

    const result = await sendWaCli(jid, message);
    results.push({ phone, ...result });

    if (result.ok) {
      logger.info('[courier] Notified %s for order %s', phone, order.client_order_id);
    } else {
      logger.warn('[courier] Failed to notify %s: %s', phone, result.error);
    }
  }

  return { ok: results.some(r => r.ok), results };
}
