import { calculateOrderAmount } from '../catalog/menuPricing.js';
import { randomUUID } from 'node:crypto';
import { normalizePhone } from '../builders/orderPayload.js';
import logger from '../lib/logger.js';
import { getOrderByClientOrderId, getOrderById, updateOrderPaymentSummary } from '../repositories/orders.js';
import {
  getPaymentByClientOrderId,
  getPaymentById,
  getPaymentByProviderOrderId,
  updatePaymentStatusByProviderOrderId,
  upsertPaymentSession,
  listPendingPayments
} from '../repositories/payments.js';
import { sendQrisImageWhatsApp, sendQrisSuccessWhatsApp } from '../notifications/whatsapp.js';
import { createQrisTransaction, getPakasirConfig, getTransactionDetail } from './pakasir.js';

function buildProviderOrderId(clientOrderId) {
  return `pakasir_${clientOrderId}`;
}

function buildProviderOrderIdWithEntropy(clientOrderId) {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  return `pakasir_${clientOrderId}_${Date.now().toString(36)}${suffix}`;
}

function buildPaymentNotification(order) {
  return {
    customer_phone: order.customer_phone_snapshot,
    message: 'Siap kak, pembayaran QRIS-nya sudah terverifikasi ya. Pesanan kakak segera kami proses.'
  };
}

export async function sendQrisImageBestEffort(order, payment, { force = false } = {}) {
  if (!order?.customer_phone_snapshot) {
    return { ok: false, skipped: true, reason: 'missing-customer-phone' };
  }

  // Check if already sent (from prior concurrent call) — read from metadata
  if (!force && payment?.metadata?.whatsapp_sent_at) {
    return { ok: false, skipped: true, reason: 'already_sent_in_metadata' };
  }

  const result = await sendQrisImageWhatsApp({
    to: order.customer_phone_snapshot,
    customerName: order.customer_name_snapshot,
    amount: payment?.total_payment ?? payment?.amount ?? null,
    qrString: payment?.qr_string ?? null,
    force
  });

  if (!result.ok && !result.skipped) {
    logger.warn({
      to: order.customer_phone_snapshot,
      error: result.error
    }, '[payments] failed to send QRIS image WhatsApp notification');
  }

  // Mark whatsapp_sent_at in DB metadata so concurrent calls skip sending
  if (result.ok && payment?.provider_order_id) {
    try {
      const currentPayment = await getPaymentByProviderOrderId(payment.provider_order_id);
      const nextMetadata = {
        ...(currentPayment?.metadata ?? {}),
        whatsapp_sent_at: new Date().toISOString()
      };

      await updatePaymentStatusByProviderOrderId(payment.provider_order_id, {
        metadata: nextMetadata
      });
    } catch (e) {
      logger.warn('[payments] Failed to mark whatsapp_sent_at: %s', e.message);
    }
  }

  return result;
}

async function sendSuccessNotificationBestEffort(order) {
  if (!order?.customer_phone_snapshot) {
    return { ok: false, skipped: true, reason: 'missing-customer-phone' };
  }

  const existingPayment = await getPaymentByClientOrderId(order.client_order_id);
  if (existingPayment?.metadata?.whatsapp_confirmed_sent) {
    return { ok: false, skipped: true, reason: 'already-notified' };
  }

  const result = await sendQrisSuccessWhatsApp({
    to: order.customer_phone_snapshot,
    customerName: order.customer_name_snapshot,
    order
  });

  if (result.ok && existingPayment?.provider_order_id) {
    try {
      const currentPayment = await getPaymentByProviderOrderId(existingPayment.provider_order_id);
      await updatePaymentStatusByProviderOrderId(existingPayment.provider_order_id, {
        metadata: {
          ...(currentPayment?.metadata ?? {}),
          whatsapp_confirmed_sent: true,
          whatsapp_confirmed_sent_at: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.warn('[payments] Failed to mark whatsapp_confirmed_sent: %s', error.message);
    }
  }

  if (!result.ok && !result.skipped) {
    logger.warn({
      to: order.customer_phone_snapshot,
      error: result.error
    }, '[payments] failed to send QRIS success WhatsApp notification');
  }

  return result;
}

export async function replaySuccessNotificationByClientOrderId(clientOrderId) {
  if (!clientOrderId) {
    throw new Error('client_order_id is required');
  }

  const order = await getOrderByClientOrderId(clientOrderId);
  if (!order) {
    throw new Error('order not found');
  }

  if (order.payment_status !== 'confirmed') {
    return { ok: false, skipped: true, reason: 'order-not-confirmed' };
  }

  return sendSuccessNotificationBestEffort(order);
}

function resolveBaseUrl(baseUrl, requestBaseUrl) {
  const candidate = baseUrl || process.env.PUBLIC_BASE_URL || requestBaseUrl || null;
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function withQrUrl(payment, baseUrl) {
  return {
    ...payment,
    qr_image_url: baseUrl ? `${baseUrl}/payments/${payment.id}/qr.png` : null
  };
}

export async function getPaymentSessionById(id, { baseUrl } = {}) {
  const payment = await getPaymentById(id);
  if (!payment) {
    throw new Error('payment session not found');
  }

  return withQrUrl(payment, baseUrl);
}

export async function createPakasirQrisPayment({ clientOrderId, amountOverride = null, baseUrl = null, skipWhatsApp = false }) {
  if (!clientOrderId) {
    throw new Error('client_order_id is required');
  }

  const order = await getOrderByClientOrderId(clientOrderId);
  if (!order) {
    throw new Error('order not found');
  }

  const existingPayment = await getPaymentByClientOrderId(clientOrderId);
  const isExpired = existingPayment?.expired_at && new Date(existingPayment.expired_at) < new Date();
  if (isExpired) {
    logger.info('[payments] Existing QRIS expired, creating new one for %s', clientOrderId);
  }
  if (existingPayment && existingPayment.payment_status === 'pending' && !isExpired) {
    const currentOrder = await getOrderByClientOrderId(clientOrderId);
    // Clear stale whatsapp_sent_at so reused payment can re-send QR
    const cleanedPayment = { ...existingPayment };
    if (cleanedPayment.metadata?.whatsapp_sent_at) {
      cleanedPayment.metadata = { ...cleanedPayment.metadata };
      delete cleanedPayment.metadata.whatsapp_sent_at;
    }
    const whatsappQrisDelivery = skipWhatsApp
      ? { ok: false, skipped: true, reason: 'deduplicated' }
      : await sendQrisImageBestEffort(currentOrder, cleanedPayment);

    return {
      order: currentOrder,
      payment: withQrUrl(existingPayment, baseUrl),
      reused: true,
      whatsapp_qris_delivery: whatsappQrisDelivery
    };
  }

  if (existingPayment && existingPayment.payment_status === 'confirmed' && !isExpired) {
    logger.info('[payments] Existing QRIS already paid, creating new one for %s', clientOrderId);
  } else if (existingPayment && isExpired) {
    logger.info('[payments] Existing QRIS expired, creating new one for %s', clientOrderId);
  }

  const amount = calculateOrderAmount(order.items, amountOverride);
  const providerOrderId = existingPayment
    ? buildProviderOrderIdWithEntropy(clientOrderId)
    : buildProviderOrderId(clientOrderId);
  const transaction = await createQrisTransaction({ orderId: providerOrderId, amount });
  const payment = transaction?.payment;

  if (!payment?.payment_number) {
    throw new Error('Pakasir QRIS response missing payment_number');
  }

  const saved = await upsertPaymentSession({
    order_id: order.id,
    client_order_id: clientOrderId,
    provider: 'pakasir',
    provider_project: getPakasirConfig().projectSlug,
    provider_order_id: providerOrderId,
    amount: payment.amount ?? amount,
    fee: payment.fee ?? null,
    total_payment: payment.total_payment ?? amount,
    currency: 'IDR',
    payment_method: 'qris',
    provider_status: 'pending',
    payment_status: 'pending',
    qr_string: payment.payment_number,
    expired_at: payment.expired_at ?? null,
    customer_phone_snapshot: order.customer_phone_snapshot ?? null,
    customer_name_snapshot: order.customer_name_snapshot ?? null,
    metadata: { ...transaction } // fresh metadata, no stale whatsapp_sent_at
  });

  const updatedOrder = await updateOrderPaymentSummary(clientOrderId, {
    paymentMethod: 'qris',
    paymentStatus: 'pending',
    orderStatus: 'awaiting_payment'
  });

  // Note: Payment status update to bridge state is handled by caller (endpoint or evaluator)
  // to avoid circular dependency issues

  // Send QRIS image via wacli
  const whatsappQrisDelivery = skipWhatsApp
    ? { ok: false, skipped: true, reason: 'deduplicated' }
    : await sendQrisImageBestEffort(updatedOrder, saved);

  return {
    order: updatedOrder,
    payment: withQrUrl(saved, baseUrl),
    reused: false,
    whatsapp_qris_delivery: whatsappQrisDelivery
  };
}

export async function recreatePakasirQrisPaymentForOrder({ orderId, amountOverride = null, baseUrl = null, skipWhatsApp = false }) {
  const order = await getOrderById(orderId);
  if (!order) {
    throw new Error('order not found');
  }

  const newClientOrderId = order.client_order_id;
  const newProviderOrderId = buildProviderOrderIdWithEntropy(newClientOrderId);
  const amount = calculateOrderAmount(order.items, amountOverride);

  const transaction = await createQrisTransaction({ orderId: newProviderOrderId, amount });
  const payment = transaction?.payment;

  if (!payment?.payment_number) {
    throw new Error('Pakasir QRIS response missing payment_number');
  }

  const saved = await upsertPaymentSession({
    order_id: order.id,
    client_order_id: newClientOrderId,
    provider: 'pakasir',
    provider_project: getPakasirConfig().projectSlug,
    provider_order_id: newProviderOrderId,
    amount: payment.amount ?? amount,
    fee: payment.fee ?? null,
    total_payment: payment.total_payment ?? amount,
    currency: 'IDR',
    payment_method: 'qris',
    provider_status: 'pending',
    payment_status: 'pending',
    qr_string: payment.payment_number,
    expired_at: payment.expired_at ?? null,
    customer_phone_snapshot: order.customer_phone_snapshot ?? null,
    customer_name_snapshot: order.customer_name_snapshot ?? null,
    metadata: transaction
  });

  const updatedOrder = await updateOrderPaymentSummary(newClientOrderId, {
    paymentMethod: 'qris',
    paymentStatus: 'pending',
    orderStatus: 'awaiting_payment'
  });

  const whatsappQrisDelivery = skipWhatsApp
    ? { ok: false, skipped: true, reason: 'deduplicated' }
    : await sendQrisImageBestEffort(updatedOrder, saved);

  return {
    order: updatedOrder,
    payment: withQrUrl(saved, baseUrl),
    reused: false,
    whatsapp_qris_delivery: whatsappQrisDelivery
  };
}

export async function verifyPakasirPaymentWebhook(payload = {}) {
  const providerOrderId = payload.order_id ?? null;

  if (!providerOrderId) {
    throw new Error('webhook order_id is required');
  }

  const payment = await getPaymentByProviderOrderId(providerOrderId);
  if (!payment) {
    throw new Error(`payment session not found for provider order ${providerOrderId}`);
  }

  const detail = await getTransactionDetail({
    orderId: providerOrderId,
    amount: payment.amount
  });

  const transaction = detail?.transaction;
  if (!transaction) {
    throw new Error('Pakasir transaction detail missing transaction payload');
  }

  if (Number(transaction.amount) !== Number(payment.amount)) {
    throw new Error('Pakasir transaction amount mismatch');
  }

  if (String(transaction.project) !== String(payment.provider_project)) {
    throw new Error('Pakasir transaction project mismatch');
  }

  const providerStatus = String(transaction.status ?? payload.status ?? 'pending').trim().toLowerCase();
  const paymentStatus = providerStatus === 'completed' ? 'confirmed' : providerStatus === 'failed' ? 'failed' : 'pending';

  const updatedPayment = await updatePaymentStatusByProviderOrderId(providerOrderId, {
    provider_status: providerStatus,
    payment_status: paymentStatus,
    paid_at: paymentStatus === 'confirmed' ? transaction.completed_at ?? payload.completed_at ?? new Date().toISOString() : null,
    metadata: {
      ...(payment.metadata ?? {}),
      webhook: payload,
      transaction_detail: detail
    }
  });

  if (paymentStatus !== 'confirmed') {
    return {
      payment: updatedPayment,
      verified: false,
      events: [],
      customer_notification: null,
      whatsapp_notification: null
    };
  }

  const updatedOrder = await updateOrderPaymentSummary(payment.client_order_id, {
    paymentMethod: 'qris',
    paymentStatus: 'confirmed',
    orderStatus: 'ready_to_submit'
  });

  let events = [];
  if (payment.customer_phone_snapshot) {
    const { upsertOrderContext } = await import('../bridge/stateService.js');
    const stateResult = await upsertOrderContext(payment.customer_phone_snapshot, {
      clientOrderId: payment.client_order_id,
      customerPhone: normalizePhone(payment.customer_phone_snapshot),
      paymentMethod: 'qris',
      paymentStatus: 'confirmed'
    });
    events = stateResult.events;
  }

  const customerNotification = buildPaymentNotification(updatedOrder);
  const whatsappNotification = await sendSuccessNotificationBestEffort(updatedOrder);

  return {
    payment: updatedPayment,
    order: updatedOrder,
    verified: true,
    events,
    customer_notification: customerNotification,
    whatsapp_notification: whatsappNotification
  };
}

export function buildPaymentBaseUrl(req) {
  const requestBaseUrl = req ? `${req.protocol}://${req.get('host')}` : null;
  return resolveBaseUrl(process.env.PUBLIC_BASE_URL || null, requestBaseUrl);
}

export async function pollPendingPaymentsAndVerify() {
  const pending = await listPendingPayments({ limit: 50 });
  const results = [];

  for (const payment of pending) {
    try {
      const providerOrderId = payment.provider_order_id;
      const detail = await getTransactionDetail({ orderId: providerOrderId, amount: payment.amount });
      const transaction = detail?.transaction;

      if (!transaction) {
        results.push({ providerOrderId, status: 'skipped', reason: 'no_transaction_detail' });
        continue;
      }

      const providerStatus = String(transaction.status ?? 'pending').trim().toLowerCase();
      const paymentStatus = providerStatus === 'completed' ? 'confirmed' : providerStatus === 'failed' ? 'failed' : 'pending';

      if (paymentStatus === payment.payment_status) {
        results.push({ providerOrderId, status: 'unchanged', paymentStatus });
        continue;
      }

      await updatePaymentStatusByProviderOrderId(providerOrderId, {
        provider_status: providerStatus,
        payment_status: paymentStatus,
        paid_at: paymentStatus === 'confirmed' ? transaction.completed_at ?? new Date().toISOString() : null,
        metadata: {
          ...(payment.metadata ?? {}),
          poll_result: detail
        }
      });

      if (paymentStatus === 'confirmed') {
        const updatedOrder = await updateOrderPaymentSummary(payment.client_order_id, {
          paymentMethod: 'qris',
          paymentStatus: 'confirmed',
          orderStatus: 'ready_to_submit'
        });

        if (payment.customer_phone_snapshot) {
          const { upsertOrderContext } = await import('../bridge/stateService.js');
          await upsertOrderContext(payment.customer_phone_snapshot, {
            clientOrderId: payment.client_order_id,
            customerPhone: normalizePhone(payment.customer_phone_snapshot),
            paymentMethod: 'qris',
            paymentStatus: 'confirmed'
          });
        }

        const whatsappNotification = await sendSuccessNotificationBestEffort(updatedOrder);
        if (!whatsappNotification.ok && !whatsappNotification.skipped) {
          logger.warn('[poll] Failed to send success WhatsApp for %s: %s', providerOrderId, whatsappNotification.error);
        }
      }

      logger.info('[poll] Verified payment %s -> %s', providerOrderId, paymentStatus);
      results.push({ providerOrderId, status: 'verified', paymentStatus });
    } catch (error) {
      logger.warn('[poll] Failed to verify payment %s: %s', payment.provider_order_id, error.message);
      results.push({ providerOrderId: payment.provider_order_id, status: 'error', error: error.message });
    }
  }

  return results;
}
