/**
 * Error Alerting — send WhatsApp notification to admin on critical errors
 * Throttled: max 1 alert per error type per 10 minutes
 */

import logger from '../lib/logger.js';
import { runWacliSafe } from './whatsapp.js';
const ADMIN_PHONES = (process.env.ADMIN_ALERT_PHONE || process.env.COURIER_PHONES?.split(',')[0] || '').split(',').map(p => p.trim()).filter(Boolean);
const THROTTLE_MS = 10 * 60 * 1000; // 10 minutes

const recentAlerts = new Map();

function shouldAlert(errorType) {
  const lastSent = recentAlerts.get(errorType);
  if (lastSent && Date.now() - lastSent < THROTTLE_MS) return false;
  recentAlerts.set(errorType, Date.now());
  return true;
}

function toJid(phone) {
  if (!phone) return null;
  let p = String(phone).trim().replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('08')) p = '62' + p.slice(1);
  return `${p}@s.whatsapp.net`;
}

export async function alertAdmin(errorType, message, details = '') {
  if (!ADMIN_PHONES.length) return;
  if (!shouldAlert(errorType)) return;

  // Strip HTML/technical noise from details
  let cleanDetails = String(details || '').replace(/<[^>]*>/g, '').replace(/<!-.*?->/g, '').trim().slice(0, 150);
  if (cleanDetails.includes('DOCTYPE') || cleanDetails.includes('<html')) cleanDetails = 'Server error (Pakasir down)';

  const text = `⚠️ *ALERT — Kang Ngupi*\n\nType: ${errorType}\n${message}${cleanDetails ? '\n\nDetail: ' + cleanDetails : ''}\n\nTime: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`;

  for (const phone of ADMIN_PHONES) {
    const jid = toJid(phone);
    if (!jid) continue;
    try {
      await runWacliSafe(['send', 'text', '--to', jid, '--message', text]);
      logger.info('[alert] Admin notified %s: %s', phone, errorType);
    } catch (err) {
      logger.warn('[alert] Failed to notify %s: %s', phone, err.message);
    }
  }
}

// Pre-defined alert types
export async function alertPaymentFailed(orderId, error) {
  await alertAdmin('PAYMENT_FAILED', `Payment verification gagal untuk order ${orderId}`, error);
}

export async function alertWebhookError(error) {
  await alertAdmin('WEBHOOK_ERROR', 'Pakasir webhook error', error);
}

export async function alertWhatsAppDown(error) {
  await alertAdmin('WHATSAPP_DOWN', 'WhatsApp send gagal berulang kali', error);
}

export async function alertPawoonError(orderId, error) {
  await alertAdmin('PAWOON_ERROR', `Gagal push order ${orderId} ke Pawoon`, error);
}
