/**
 * Customer Status Notifications — send WA updates when order status changes
 */

import logger from '../lib/logger.js';
import { runWacliSafe } from './whatsapp.js';

function toJid(phone) {
  let p = String(phone).trim().replace(/[\s\-()]/g, '');
  if (p.startsWith('08')) p = '+62' + p.slice(1);
  if (p.startsWith('62') && !p.startsWith('+')) p = '+' + p;
  return p.startsWith('+') ? p.slice(1) + '@s.whatsapp.net' : null;
}

const STATUS_MESSAGES = {
  preparing: (order) => 
    `☕ Pesanan kak ${order.customer_name_snapshot || 'Customer'} sedang dibuat ya! Ditunggu sebentar~`,
  
  on_the_way: (order) => 
    `🛵 Pesanan kak ${order.customer_name_snapshot || 'Customer'} sedang diantar kurir Go Ngupi! Ditunggu ya kak~`,
  
  ready_for_pickup: (order) =>
    `✅ Pesanan kak ${order.customer_name_snapshot || 'Customer'} sudah siap! Silakan diambil di kedai ya kak 🙂\n📍 di Jalan Singawinata No.9 ya kak, Purwakarta\nhttps://maps.app.goo.gl/sbaH9qXGujUuPwT78`,
  
  completed: (order) => {
    if (order.fulfillment_method === 'pickup') {
      return `🎉 Pesanan kak ${order.customer_name_snapshot || 'Customer'} sudah selesai. Terima kasih sudah order di Kedai Ngupi! ☕`;
    }
    return `🎉 Pesanan kak ${order.customer_name_snapshot || 'Customer'} sudah sampai. Terima kasih sudah order di Kedai Ngupi! ☕`;
  },
};

/**
 * Send status update notification to customer via WhatsApp
 */
export async function notifyCustomerStatus(order, newStatus) {
  const phone = order.customer_phone_snapshot;
  if (!phone) return { ok: false, skipped: true, reason: 'no_phone' };

  const messageFn = STATUS_MESSAGES[newStatus];
  if (!messageFn) return { ok: false, skipped: true, reason: 'no_message_for_status' };

  const jid = toJid(phone);
  if (!jid) return { ok: false, skipped: true, reason: 'invalid_phone' };

  const message = messageFn(order);

  try {
    const result = await runWacliSafe(['send', 'text', '--to', jid, '--message', message]);

    logger.info('[status-notif] Sent %s notification to %s', newStatus, phone);
    return { ok: true, status: newStatus, phone, stdout: result.stdout };
  } catch (err) {
    logger.warn('[status-notif] Failed to send %s notification to %s: %s', newStatus, phone, err.message);
    return { ok: false, error: err.message };
  }
}
