/**
 * Feedback System — send rating request to customer after delivery
 * Customer replies with 1-5 rating via WhatsApp
 */

import { normalizePhone } from '../builders/orderPayload.js';
import { getSupabase } from '../supabase.js';
import logger from '../lib/logger.js';
import { runWacliSafe } from './whatsapp.js';

function toJid(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const num = normalized.startsWith('+') ? normalized.slice(1) : normalized;
  return `${num}@s.whatsapp.net`;
}

function buildFeedbackMessage(order) {
  const name = order.customer_name_snapshot || 'Kak';
  return `Hai ${name}! ☕\n\nTerima kasih sudah order di Kedai Ngupi 🙏\n\nBoleh minta rating untuk pesanan kali ini?\nBalas dengan angka 1-5:\n\n⭐ 1 — Kurang banget\n⭐⭐ 2 — Kurang\n⭐⭐⭐ 3 — Cukup\n⭐⭐⭐⭐ 4 — Bagus\n⭐⭐⭐⭐⭐ 5 — Mantap!\n\nFeedback kakak sangat berarti buat kami 😊`;
}

async function sendWaCli(jid, message) {
  try {
    const result = await runWacliSafe(['send', 'text', '--to', jid, '--message', message]);
    return { ok: true, stdout: result.stdout };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function sendFeedbackRequest(order) {
  if (!order?.customer_phone_snapshot) {
    return { ok: false, skipped: true, reason: 'no_phone' };
  }

  // Check if feedback already requested for this order
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from('order_feedback')
    .select('id')
    .eq('order_id', order.id)
    .limit(1);

  if (existing?.length) {
    return { ok: false, skipped: true, reason: 'already_requested' };
  }

  const jid = toJid(order.customer_phone_snapshot);
  if (!jid) return { ok: false, skipped: true, reason: 'invalid_phone' };

  const message = buildFeedbackMessage(order);
  const result = await sendWaCli(jid, message);

  if (result.ok) {
    // Record feedback request
    try {
      await supabase.from('order_feedback').insert({
        order_id: order.id,
        client_order_id: order.client_order_id,
        customer_phone: order.customer_phone_snapshot,
        customer_name: order.customer_name_snapshot,
        requested_at: new Date().toISOString(),
        status: 'pending'
      });
    } catch (err) {
      logger.warn('[feedback] Failed to record request: %s', err.message);
    }

    logger.info('[feedback] Rating request sent to %s for order %s', order.customer_phone_snapshot, order.client_order_id);
  }

  return result;
}

export async function saveFeedbackRating(phone, rating, message = null) {
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, error: 'invalid_phone' };

  const supabase = getSupabase();

  // Find most recent pending feedback for this phone
  const { data: pending } = await supabase
    .from('order_feedback')
    .select('*')
    .eq('customer_phone', normalized)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(1);

  if (!pending?.length) {
    return { ok: false, error: 'no_pending_feedback' };
  }

  const feedback = pending[0];
  const { error } = await supabase
    .from('order_feedback')
    .update({
      rating: Number(rating),
      message: message || null,
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', feedback.id);

  if (error) return { ok: false, error: error.message };

  logger.info('[feedback] Rating %d saved for order %s from %s', rating, feedback.client_order_id, normalized);
  return { ok: true, orderId: feedback.client_order_id, rating: Number(rating) };
}
