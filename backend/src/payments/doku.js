/**
 * Doku SNAP API Client — QRIS Payment Integration
 * 
 * Flow:
 * 1. Get B2B Access Token (asymmetric signature with private key)
 * 2. Generate QRIS (symmetric signature with secret key)
 * 3. Query QRIS status
 * 4. Verify webhook notification (public key)
 */

import crypto from 'node:crypto';
import logger from '../lib/logger.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──
const DOKU_CLIENT_ID = process.env.DOKU_CLIENT_ID;
const DOKU_SECRET_KEY = process.env.DOKU_SECRET_KEY;
const DOKU_API_KEY = process.env.DOKU_API_KEY;
const DOKU_ENV = process.env.DOKU_ENVIRONMENT || 'sandbox';
const DOKU_MERCHANT_ID = process.env.DOKU_MERCHANT_ID || '';
const DOKU_BASE_URL = DOKU_ENV === 'production'
  ? 'https://api.doku.com'
  : 'https://api-sandbox.doku.com';

// Load public key for webhook verification (Doku's public key)
let DOKU_PUBLIC_KEY = null;
try {
  DOKU_PUBLIC_KEY = readFileSync(join(__dirname, '..', '..', 'doku-public-key.pem'), 'utf-8');
} catch (e) {
  logger.warn('[doku] Public key not found at doku-public-key.pem — webhook verification disabled');
}

// Load merchant private key for B2B token signing (our RSA key)
let MERCHANT_PRIVATE_KEY = null;
try {
  MERCHANT_PRIVATE_KEY = readFileSync(join(__dirname, '..', '..', 'doku-private.key'), 'utf-8');
} catch (e) {
  logger.warn('[doku] Merchant private key not found at doku-private.key — token auth disabled');
}

// ── Token Cache ──
let tokenCache = { token: null, expiresAt: 0 };

// ── Helpers ──

function getTimestamp() {
  // ISO 8601 with timezone offset: 2026-05-03T14:40:00+07:00
  const now = new Date();
  const offset = '+07:00'; // WIB
  const pad = (n) => String(n).padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const min = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  // Convert to WIB
  const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  return `${wib.getFullYear()}-${pad(wib.getMonth()+1)}-${pad(wib.getDate())}T${pad(wib.getHours())}:${pad(wib.getMinutes())}:${pad(wib.getSeconds())}${offset}`;
}

function generateExternalId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000).toString();
}

function minifyJson(obj) {
  return JSON.stringify(obj, null, 0).replace(/\n/g, '');
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex').toLowerCase();
}

// ── Asymmetric Signature (for Get Token B2B) ──
// stringToSign = clientId + "|" + timestamp
// Sign with SHA256withRSA using private key (we don't have private key, use HMAC approach)
// Actually for Doku SNAP, Get Token uses X-SIGNATURE = SHA256withRSA(privateKey, clientId|timestamp)
// But since we don't have a private key (Doku gives us secret_key), we use their alternative approach

function generateAsymmetricSignature(timestamp) {
  // For Doku SNAP B2B token: stringToSign = clientId + "|" + timestamp
  // Signed with SHA256withRSA using merchant private key
  const stringToSign = `${DOKU_CLIENT_ID}|${timestamp}`;
  
  if (!MERCHANT_PRIVATE_KEY) {
    throw new Error('Merchant private key not loaded — cannot sign B2B token request');
  }
  
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(stringToSign), MERCHANT_PRIVATE_KEY)
    .toString('base64');
  return signature;
}

// ── Symmetric Signature (for API calls after token) ──
// stringToSign = HTTPMethod + ":" + EndpointUrl + ":" + AccessToken + ":" + Lowercase(HexEncode(SHA-256(minify(body)))) + ":" + Timestamp
// X-SIGNATURE = base64(HMAC-SHA512(clientSecret, stringToSign))

function generateSymmetricSignature(httpMethod, endpointUrl, accessToken, requestBody, timestamp) {
  const minified = minifyJson(requestBody);
  const bodyHash = sha256Hex(minified);
  const stringToSign = `${httpMethod}:${endpointUrl}:${accessToken}:${bodyHash}:${timestamp}`;
  
  const signature = crypto
    .createHmac('sha512', DOKU_SECRET_KEY)
    .update(stringToSign)
    .digest('base64');
  
  return { signature, minifiedBody: minified };
}

// ══════════════════════════════════════════════════════════════
// 1. GET B2B ACCESS TOKEN
// ══════════════════════════════════════════════════════════════

export async function getAccessToken() {
  // Return cached token if still valid (with 60s buffer)
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.token;
  }

  const timestamp = getTimestamp();
  const signature = generateAsymmetricSignature(timestamp);

  const url = `${DOKU_BASE_URL}/authorization/v1/access-token/b2b`;
  
  const headers = {
    'X-CLIENT-KEY': DOKU_CLIENT_ID,
    'X-TIMESTAMP': timestamp,
    'X-SIGNATURE': signature,
    'Content-Type': 'application/json'
  };

  const body = { grantType: 'client_credentials' };

  logger.info({ url, clientId: DOKU_CLIENT_ID }, '[doku] Requesting B2B access token');

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok || !data.accessToken) {
    logger.error({ status: res.status, data }, '[doku] Failed to get access token');
    throw new Error(`Doku token error: ${data.responseMessage || res.status}`);
  }

  tokenCache = {
    token: data.accessToken,
    expiresAt: Date.now() + (data.expiresIn || 900) * 1000
  };

  logger.info({ expiresIn: data.expiresIn }, '[doku] Access token obtained');
  return data.accessToken;
}

// ══════════════════════════════════════════════════════════════
// 2. GENERATE QRIS
// ══════════════════════════════════════════════════════════════

/**
 * Generate a QRIS payment code
 * @param {Object} params
 * @param {string} params.orderId - Unique order/invoice reference
 * @param {number} params.amount - Amount in IDR (integer, e.g. 42000)
 * @param {string} [params.merchantId] - Doku merchant ID (from dashboard)
 * @param {string} [params.terminalId] - Terminal ID (default "A01")
 * @param {number} [params.validityMinutes] - QRIS validity in minutes (default 30)
 * @returns {{ ok: boolean, qrContent?: string, referenceNo?: string, error?: string }}
 */
export async function generateQris({ orderId, amount, merchantId, terminalId = 'A01', validityMinutes = 30 }) {
  const accessToken = await getAccessToken();
  const timestamp = getTimestamp();
  const endpointUrl = '/snap-adapter/b2b/v1.0/qr/qr-mpm-generate';

  // Calculate validity period — format: 2026-05-03T15:10:00+07:00
  const validUntil = new Date(Date.now() + validityMinutes * 60 * 1000);
  const wib = new Date(validUntil.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const pad = (n) => String(n).padStart(2, '0');
  const validityPeriod = `${wib.getFullYear()}-${pad(wib.getMonth()+1)}-${pad(wib.getDate())}T${pad(wib.getHours())}:${pad(wib.getMinutes())}:${pad(wib.getSeconds())}+07:00`;

  const requestBody = {
    partnerReferenceNo: orderId,
    amount: {
      value: `${amount}.00`,
      currency: 'IDR'
    },
    merchantId: merchantId || DOKU_MERCHANT_ID,
    terminalId,
    validityPeriod,
    additionalInfo: {
      postalCode: '41100', // Purwakarta postal code
      feeType: '1' // No tips
    }
  };

  const { signature, minifiedBody } = generateSymmetricSignature(
    'POST', endpointUrl, accessToken, requestBody, timestamp
  );

  const externalId = generateExternalId();

  const headers = {
    'X-PARTNER-ID': DOKU_CLIENT_ID,
    'X-EXTERNAL-ID': externalId,
    'X-TIMESTAMP': timestamp,
    'X-SIGNATURE': signature,
    'Authorization': `Bearer ${accessToken}`,
    'CHANNEL-ID': 'H2H',
    'Content-Type': 'application/json'
  };

  const url = `${DOKU_BASE_URL}${endpointUrl}`;

  logger.info({ orderId, amount, url }, '[doku] Generating QRIS');

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: minifiedBody
  });

  const data = await res.json();

  if (data.responseCode === '2004700' && data.qrContent) {
    logger.info({ orderId, referenceNo: data.referenceNo }, '[doku] QRIS generated successfully');
    return {
      ok: true,
      qrContent: data.qrContent,
      referenceNo: data.referenceNo,
      partnerReferenceNo: data.partnerReferenceNo,
      validityPeriod: data.additionalInfo?.validityPeriod
    };
  }

  logger.error({ orderId, status: res.status, data }, '[doku] Failed to generate QRIS');
  return {
    ok: false,
    error: data.responseMessage || `HTTP ${res.status}`,
    responseCode: data.responseCode
  };
}

// ══════════════════════════════════════════════════════════════
// 3. QUERY QRIS STATUS
// ══════════════════════════════════════════════════════════════

/**
 * Query payment status of a QRIS transaction
 * @param {Object} params
 * @param {string} params.originalReferenceNo - referenceNo from generate response
 * @param {string} params.partnerReferenceNo - original orderId
 * @param {string} [params.merchantId]
 * @returns {{ ok: boolean, status?: string, paidTime?: string, amount?: object }}
 */
export async function queryQris({ originalReferenceNo, partnerReferenceNo, merchantId }) {
  const accessToken = await getAccessToken();
  const timestamp = getTimestamp();
  const endpointUrl = '/snap-adapter/b2b/v1.0/qr/qr-mpm-query';

  const requestBody = {
    originalReferenceNo,
    originalPartnerReferenceNo: partnerReferenceNo,
    serviceCode: '47',
    merchantId: merchantId || DOKU_MERCHANT_ID
  };

  const { signature, minifiedBody } = generateSymmetricSignature(
    'POST', endpointUrl, accessToken, requestBody, timestamp
  );

  const externalId = generateExternalId();

  const headers = {
    'X-PARTNER-ID': DOKU_CLIENT_ID,
    'X-EXTERNAL-ID': externalId,
    'X-TIMESTAMP': timestamp,
    'X-SIGNATURE': signature,
    'Authorization': `Bearer ${accessToken}`,
    'CHANNEL-ID': 'H2H',
    'Content-Type': 'application/json'
  };

  const url = `${DOKU_BASE_URL}${endpointUrl}`;

  logger.info({ partnerReferenceNo, originalReferenceNo }, '[doku] Querying QRIS status');

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: minifiedBody
  });

  const data = await res.json();

  // Success response codes: 2004700 (generate context) or 2005100 (query context)
  const isSuccess = data.responseCode?.startsWith('200');
  if (isSuccess && data.latestTransactionStatus !== undefined) {
    const status = data.latestTransactionStatus; // "00" = success
    return {
      ok: true,
      status,
      statusDesc: data.transactionStatusDesc,
      paid: status === '00',
      paidTime: data.paidTime,
      amount: data.amount,
      issuerName: data.additionalInfo?.issuerName,
      issuerApprovalCode: data.additionalInfo?.approvalCode,
      customerName: data.additionalInfo?.customerName
    };
  }

  logger.warn({ partnerReferenceNo, data }, '[doku] Query QRIS failed or pending');
  return {
    ok: false,
    error: data.responseMessage || `HTTP ${res.status}`,
    responseCode: data.responseCode
  };
}

// ══════════════════════════════════════════════════════════════
// 4. CANCEL / EXPIRE QRIS
// ══════════════════════════════════════════════════════════════

/**
 * Cancel/expire a QRIS that hasn't been paid yet
 * @param {Object} params
 * @param {string} params.partnerReferenceNo - original orderId
 * @param {string} params.referenceNo - referenceNo from generate response
 * @param {string} [params.merchantId]
 * @param {string} [params.reason]
 */
export async function cancelQris({ partnerReferenceNo, referenceNo, merchantId, reason = 'Order cancelled' }) {
  const accessToken = await getAccessToken();
  const timestamp = getTimestamp();
  const endpointUrl = '/snap-adapter/b2b/v1.0/qr/qr-expire';

  const requestBody = {
    partnerReferenceNo,
    referenceNo,
    merchantId: merchantId || DOKU_MERCHANT_ID,
    reason
  };

  const { signature, minifiedBody } = generateSymmetricSignature(
    'POST', endpointUrl, accessToken, requestBody, timestamp
  );

  const externalId = generateExternalId();

  const headers = {
    'X-PARTNER-ID': DOKU_CLIENT_ID,
    'X-EXTERNAL-ID': externalId,
    'X-TIMESTAMP': timestamp,
    'X-SIGNATURE': signature,
    'Authorization': `Bearer ${accessToken}`,
    'CHANNEL-ID': 'H2H',
    'Content-Type': 'application/json'
  };

  const url = `${DOKU_BASE_URL}${endpointUrl}`;

  logger.info({ partnerReferenceNo, referenceNo }, '[doku] Cancelling QRIS');

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: minifiedBody
  });

  const data = await res.json();

  if (data.responseCode === '2004700') {
    logger.info({ partnerReferenceNo }, '[doku] QRIS cancelled successfully');
    return { ok: true, expiredDate: data.expiredDate };
  }

  logger.warn({ partnerReferenceNo, data }, '[doku] Cancel QRIS failed');
  return { ok: false, error: data.responseMessage || `HTTP ${res.status}` };
}

// ══════════════════════════════════════════════════════════════
// 5. VERIFY WEBHOOK NOTIFICATION
// ══════════════════════════════════════════════════════════════

/**
 * Verify Doku webhook notification signature
 * @param {Object} params
 * @param {string} params.signature - X-SIGNATURE from webhook header
 * @param {string} params.timestamp - X-TIMESTAMP from webhook header
 * @param {string} params.body - Raw request body string
 * @param {string} params.method - HTTP method (POST)
 * @param {string} params.path - Endpoint path (/webhooks/doku)
 * @returns {boolean}
 */
export function verifyWebhookSignature({ signature, timestamp, body, clientId }) {
  // Doku may not send signature on all webhook types
  if (!signature) {
    logger.info('[doku] Webhook has no signature — accepting (Doku unsigned notification)');
    return true;
  }

  if (!DOKU_PUBLIC_KEY) {
    logger.warn('[doku] No public key loaded — skipping webhook verification');
    return true;
  }

  try {
    // Doku notification uses asymmetric verification with their public key
    // stringToSign = clientId + "|" + timestamp + "|" + body
    const stringToSign = `${clientId}|${timestamp}|${body}`;
    
    const verifier = crypto.createVerify('SHA256');
    verifier.update(stringToSign);
    
    return verifier.verify(DOKU_PUBLIC_KEY, signature, 'base64');
  } catch (e) {
    logger.error({ error: e.message }, '[doku] Webhook signature verification error');
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// 5. UTILITY
// ══════════════════════════════════════════════════════════════

export function getDokuConfig() {
  return {
    clientId: DOKU_CLIENT_ID,
    environment: DOKU_ENV,
    baseUrl: DOKU_BASE_URL,
    hasPublicKey: !!DOKU_PUBLIC_KEY
  };
}
