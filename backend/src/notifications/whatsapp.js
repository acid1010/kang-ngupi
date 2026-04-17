import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import QRCode from 'qrcode';
import { normalizePhone } from '../builders/orderPayload.js';

// In-memory dedup: prevent sending WhatsApp to same recipient within 30 seconds
const recentSends = new Map();
const inFlightSends = new Set();
const SEND_DEDUP_TTL_MS = 60_000; // 60s dedup window — prevent double sends from evaluator + qris/direct race

function markRecentlySent(phone) {
  recentSends.set(phone, Date.now());
}

function wasRecentlySent(phone) {
  const sentAt = recentSends.get(phone);
  if (!sentAt) return false;
  if (Date.now() - sentAt > SEND_DEDUP_TTL_MS) {
    recentSends.delete(phone);
    return false;
  }
  return true;
}

function isSendInFlight(phone) {
  return inFlightSends.has(phone);
}

function markSendInFlight(phone) {
  inFlightSends.add(phone);
}

function clearSendInFlight(phone) {
  inFlightSends.delete(phone);
}

// wacli expects phone as JID format
function toWacliPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const num = normalized.startsWith('+') ? normalized.slice(1) : normalized;
  return `${num}@s.whatsapp.net`;
}

const execFileAsync = promisify(execFile);

function isSuccessEnabled() {
  const raw = String(process.env.WHATSAPP_NOTIFY_QRIS_SUCCESS || 'true').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function isQrisSendEnabled() {
  const raw = String(process.env.WHATSAPP_SEND_QRIS_ON_CREATE || 'true').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function getWacliBin() {
  return process.env.WACLI_BIN || 'wacli';
}

function formatIdr(amount) {
  const value = Number(amount ?? 0);
  return `Rp${new Intl.NumberFormat('id-ID').format(Number.isFinite(value) ? value : 0)}`;
}

function buildQrisCaption({ customerName = null, amount = null } = {}) {
  const salutation = customerName ? `Siap kak ${customerName},` : 'Siap kak,';
  const totalText = amount != null ? ` Total pembayarannya ${formatIdr(amount)}.` : '';
  return `${salutation} ini QRIS-nya ya.${totalText} Nanti setelah masuk, sistem kami verifikasi otomatis 🙂`;
}

async function runWacli(args) {
  const { stdout, stderr } = await execFileAsync(getWacliBin(), args, {
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });

  return {
    stdout: stdout?.trim() || null,
    stderr: stderr?.trim() || null
  };
}

export async function sendQrisImageWhatsApp({ to, customerName = null, amount = null, qrString = null, force = false } = {}) {
  if (!isQrisSendEnabled()) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  const recipient = toWacliPhone(to);
  if (!recipient) {
    return { ok: false, skipped: true, reason: 'missing-recipient' };
  }

  if (!qrString) {
    return { ok: false, skipped: true, reason: 'missing-qr-string' };
  }

  // Dedup: skip if we already sent to this recipient recently
  if (!force && wasRecentlySent(recipient)) {
    return { ok: false, skipped: true, reason: 'recently_sent' };
  }

  if (isSendInFlight(recipient)) {
    return { ok: false, skipped: true, reason: 'send_in_flight' };
  }

  const caption = buildQrisCaption({ customerName, amount });
  const tempFile = join(tmpdir(), `ngupi-qris-${randomUUID()}.png`);

  try {
    await QRCode.toFile(tempFile, qrString, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 400,
      type: 'png'
    });

    markSendInFlight(recipient);

    const result = await runWacli(['send', 'file', '--to', recipient, '--file', tempFile, '--caption', caption]);
    markRecentlySent(recipient);

    return {
      ok: true,
      skipped: false,
      to: recipient,
      caption,
      ...result
    };
  } catch (error) {
    // Fallback: send text-only with QR string if image send fails
    console.error('[whatsapp] Image send failed, trying text fallback:', error.message);
    try {
      const fallbackMsg = `${caption}\n\n⚠️ QR image gagal terkirim. Silakan scan QR di link berikut atau minta dikirim ulang.`;
      await runWacli(['send', 'text', '--to', recipient, '--message', fallbackMsg]);
      markRecentlySent(recipient);
      return { ok: true, skipped: false, to: recipient, caption, fallback: true };
    } catch (fallbackErr) {
      return { ok: false, skipped: false, to: recipient, caption, error: error.message, fallbackError: fallbackErr.message };
    }
  } finally {
    clearSendInFlight(recipient);
    await rm(tempFile, { force: true }).catch(() => null);
  }
}

export async function sendQrisSuccessWhatsApp({ to, customerName = null, order = null } = {}) {
  if (!isSuccessEnabled()) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  const recipient = toWacliPhone(to);
  if (!recipient) {
    return { ok: false, skipped: true, reason: 'missing-recipient' };
  }

  const salutation = customerName ? `Siap kak ${customerName},` : 'Siap kak,';
  const message = `${salutation} pembayaran QRIS-nya sudah terverifikasi ya ✅\n\nPesanan kakak segera kami proses. Ditunggu ya! ☕`;

  try {
    const result = await runWacli(['send', 'text', '--to', recipient, '--message', message]);

    // Send digital receipt after success message
    if (order) {
      try {
        await sendDigitalReceipt({ to, customerName, order });
      } catch (receiptErr) {
        console.warn('[whatsapp] Failed to send receipt: %s', receiptErr.message);
      }
    }

    return {
      ok: true,
      skipped: false,
      to: recipient,
      message,
      ...result
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      to: recipient,
      message,
      error: error.message
    };
  }
}

export async function sendDigitalReceipt({ to, customerName = null, order = null } = {}) {
  const recipient = toWacliPhone(to);
  if (!recipient || !order) return { ok: false, reason: 'missing-data' };

  // Fetch order items from DB
  let items = [];
  let ongkir = 0;
  try {
    const { getSupabase } = await import('../supabase.js');
    const sb = getSupabase();
    const { data } = await sb.from('order_items').select('menu_name, qty, price, temperature, notes').eq('order_id', order.id);
    items = data || [];

    // Check for ongkir in order notes or delivery fee
    if (order.delivery_fee) ongkir = Number(order.delivery_fee);
  } catch (_) {}

  const name = customerName || order.customer_name_snapshot || 'kak';
  const orderId = order.client_order_id || '-';
  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

  const fmtRp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');

  // Build item lines
  const itemLines = items.map(i => {
    const qty = i.qty || 1;
    const price = Number(i.price || 0) * qty;
    const temp = i.temperature === 'iced' ? 'Es ' : i.temperature === 'hot' ? 'Hot ' : '';
    return `- ${temp}${i.menu_name} x${qty}   ${fmtRp(price)}`;
  });

  const subtotal = items.reduce((sum, i) => sum + (Number(i.price || 0) * (i.qty || 1)), 0);
  const total = subtotal + ongkir;

  const paymentMethod = (order.payment_method || 'qris').toUpperCase();
  const fulfillment = order.fulfillment_method === 'delivery' ? 'Delivery (Go Ngupi)' : 'Pickup';

  let receipt = `🧾 *STRUK PESANAN*\n`;
  receipt += `──────────────────────\n`;
  receipt += `Kedai Ngupi Ngupi Purwakarta\n`;
  receipt += `Jl. K.K. Singawinata No.9\n\n`;
  receipt += `Order: ${orderId}\n`;
  receipt += `Tanggal: ${dateStr}, ${timeStr} WIB\n`;
  receipt += `Atas nama: ${name}\n`;
  receipt += `${fulfillment}\n\n`;
  receipt += itemLines.join('\n') + '\n';
  if (ongkir > 0) {
    receipt += `- Ongkir Go Ngupi   ${fmtRp(ongkir)}\n`;
  }
  receipt += `──────────────────────\n`;
  receipt += `*Total: ${fmtRp(total)}*\n`;
  receipt += `Bayar: ${paymentMethod} ✅\n\n`;
  receipt += `Terima kasih kak ${name}! ☕\n`;
  receipt += `@kedaingupingupi`;

  try {
    await runWacli(['send', 'text', '--to', recipient, '--message', receipt]);
    console.log('[whatsapp] Digital receipt sent to %s', to);
    return { ok: true };
  } catch (err) {
    console.warn('[whatsapp] Receipt send failed: %s', err.message);
    return { ok: false, error: err.message };
  }
}
