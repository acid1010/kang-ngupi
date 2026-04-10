import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizePhone } from '../builders/orderPayload.js';
import { activeOrderStateRoot } from './config.js';

function makeFileName(phone) {
  return `${String(phone).replace(/[^a-zA-Z0-9+._-]/g, '_')}.json`;
}

export function createEmptyOrderContext(customerPhone) {
  return {
    clientOrderId: null,
    channel: 'whatsapp',
    customerName: null,
    customerPhone,
    rawMessage: null,
    items: [],
    fulfillmentMethod: null,
    locationStatus: null,
    shareloc: null,
    paymentMethod: null,
    paymentStatus: null,
    deliveryProvider: null,
    status: 'draft',
    notes: []
  };
}

export function createEmptyOrderState(customerPhone) {
  return {
    customerPhone,
    draftSentAt: null,
    finalSentAt: null,
    lastUpdatedAt: new Date().toISOString(),
    orderContext: createEmptyOrderContext(customerPhone)
  };
}

export async function ensureStateDirs() {
  await fs.mkdir(activeOrderStateRoot, { recursive: true });
}

export function getStateFilePath(customerPhone) {
  const normalized = normalizePhone(customerPhone);
  return path.join(activeOrderStateRoot, makeFileName(normalized));
}

export async function loadActiveOrderState(customerPhone) {
  const normalized = normalizePhone(customerPhone);
  const filePath = getStateFilePath(normalized);

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    parsed.customerPhone = normalized;
    parsed.orderContext = {
      ...createEmptyOrderContext(normalized),
      ...(parsed.orderContext ?? {}),
      customerPhone: parsed.orderContext?.customerPhone ?? normalized
    };
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return createEmptyOrderState(normalized);
    }
    throw error;
  }
}

export async function saveActiveOrderState(customerPhone, state) {
  const normalized = normalizePhone(customerPhone);
  const filePath = getStateFilePath(normalized);
  const payload = {
    ...state,
    customerPhone: normalized,
    lastUpdatedAt: new Date().toISOString(),
    orderContext: {
      ...createEmptyOrderContext(normalized),
      ...(state.orderContext ?? {}),
      customerPhone: normalized
    }
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}
