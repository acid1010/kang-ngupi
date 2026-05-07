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
  return `${salutation} ini QRIS-nya ya.${totalText} Nanti setelah masuk, otomatis terverifikasi 🙂`;
}

function getEstimatedTimeText(fulfillmentMethod) {
  switch (fulfillmentMethod) {
    case 'dine_in':
      return '~10-15 menit';
    case 'self_pickup':
      return '~15-20 menit';
    case 'delivery':
      return '~25-40 menit';
    default:
      return '~15-20 menit';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isWacliStoreLockError(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return text.includes('store is locked') || text.includes('resource temporarily unavailable');
}

async function runWacli(args, { retries = 4, retryDelayMs = 1500 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { stdout, stderr } = await execFileAsync(getWacliBin(), args, {
        timeout: 30_000,
        maxBuffer: 1024 * 1024
      });

      return {
        stdout: stdout?.trim() || null,
        stderr: stderr?.trim() || null,
        attempts: attempt + 1
      };
    } catch (error) {
      lastError = error;

      if (!isWacliStoreLockError(error) || attempt === retries) {
        throw error;
      }

      const waitMs = retryDelayMs * (attempt + 1);
      console.warn(`[whatsapp] wacli locked, retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries + 1})`);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

/**
 * Shared lock-aware wacli runner — importable by other notification modules.
 * Usage: import { runWacliSafe } from './whatsapp.js';
 */
export { runWacli as runWacliSafe };

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
  const estimatedTime = getEstimatedTimeText(order?.fulfillment_method);
  const message = `${salutation} pembayaran QRIS-nya sudah terverifikasi ya ✅\n\nPesanan kamu lagi diproses. Estimasinya ${estimatedTime} ya kak. Ditunggu bentar ☕`;

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

  // Fetch order items from DB, fallback to state file
  let items = [];
  let ongkir = 0;
  try {
    const { getSupabase } = await import('../supabase.js');
    const sb = getSupabase();
    if (order.id) {
      const { data } = await sb.from('order_items').select('menu_name, qty, price, temperature, notes').eq('order_id', order.id);
      items = data || [];
    }
    // Check for ongkir in order notes or delivery fee
    if (order.delivery_fee) ongkir = Number(order.delivery_fee);
  } catch (_) {}

  // Fallback: read from state file if DB has no items
  if (items.length === 0 && to) {
    try {
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const phone = to.replace(/[^a-zA-Z0-9+._-]/g, '_');
      const stateFile = join(process.cwd(), '..', 'state', 'orders-active', `${phone}.json`);
      const raw = await readFile(stateFile, 'utf-8');
      const state = JSON.parse(raw);
      const ctx = state.orderContext || state;
      if (ctx.items && ctx.items.length > 0) {
        items = ctx.items.map(i => ({
          menu_name: i.menuName || i.menu_name || 'Item',
          qty: i.quantity || i.qty || 1,
          price: i.price || 0,
          temperature: i.temperature || null,
          notes: i.notes || null
        }));
        ongkir = Number(ctx.deliveryFee || ctx.ongkir || 0);
      }
    } catch (_) {}
  }

  const name = customerName || order.customer_name_snapshot || 'kak';
  let orderId = order.client_order_id || '-';
  // Fallback orderId from state if DB didn't have it
  if (orderId === '-' && to) {
    try {
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const phone = to.replace(/[^a-zA-Z0-9+._-]/g, '_');
      const stateFile = join(process.cwd(), '..', 'state', 'orders-active', `${phone}.json`);
      const raw = await readFile(stateFile, 'utf-8');
      const state = JSON.parse(raw);
      const ctx = state.orderContext || state;
      orderId = ctx.clientOrderId || ctx.orderId || '-';
    } catch (_) {}
  }
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
  const fulfillment = order.fulfillment_method === 'delivery' ? 'Delivery (Go Ngupi)' 
    : order.fulfillment_method === 'dine_in' ? `Dine-in${order.table_number ? ' — Meja ' + order.table_number : ''}`
    : 'Pickup';

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
