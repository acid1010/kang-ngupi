import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import QRCode from 'qrcode';
import { normalizePhone } from '../builders/orderPayload.js';

// wacli expects phone without '+' prefix
function toWacliPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return normalized.startsWith('+') ? normalized.slice(1) : normalized;
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

export async function sendQrisImageWhatsApp({ to, customerName = null, amount = null, qrString = null } = {}) {
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

  const caption = buildQrisCaption({ customerName, amount });
  const tempFile = join(tmpdir(), `ngupi-qris-${randomUUID()}.png`);

  try {
    await QRCode.toFile(tempFile, qrString, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 720,
      type: 'png'
    });

    const result = await runWacli(['send', 'file', '--to', recipient, '--file', tempFile, '--caption', caption]);

    return {
      ok: true,
      skipped: false,
      to: recipient,
      caption,
      ...result
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      to: recipient,
      caption,
      error: error.message
    };
  } finally {
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
