import 'dotenv/config';
import express from 'express';
import QRCode from 'qrcode';
import logger from './lib/logger.js';
import { upsertOrderContext, getOrderContextState } from './bridge/stateService.js';
import {
  buildPaymentBaseUrl,
  createPakasirQrisPayment,
  recreatePakasirQrisPaymentForOrder,
  getPaymentSessionById,
  verifyPakasirPaymentWebhook,
  pollPendingPaymentsAndVerify,
  sendQrisImageBestEffort,
  replaySuccessNotificationByClientOrderId
} from './payments/service.js';
import { createOrUpdateOrder, getOrderById, getOrderByClientOrderId, listOrders } from './repositories/orders.js';
import { buildQueueFileName, ensureQueueDirs, writeQueueFile } from './queue/fs.js';
import { processAllQueues, retryFailedQueues } from './queue/processor.js';
import { ensureStateDirs } from './state/store.js';

// Uncaught exception handlers
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection — shutting down');
  process.exit(1);
});

const app = express();
app.disable('x-powered-by');
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '256kb';
app.use(express.json({ limit: jsonBodyLimit }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use((error, _req, res, next) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'Request payload too large' });
  }
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON payload' });
  }
  return next(error);
});

const autoProcessQueue = ['1', 'true', 'yes'].includes(String(process.env.AUTO_PROCESS_QUEUE || '').toLowerCase());

// SECURITY: API key authentication middleware
const API_KEY = process.env.BACKEND_API_KEY;
const PAKASIR_WEBHOOK_SECRET = process.env.PAKASIR_WEBHOOK_SECRET;
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const allowLoopbackWithoutApiKey = ['1', 'true', 'yes'].includes(
  String(process.env.ALLOW_LOOPBACK_WITHOUT_API_KEY ?? 'true').toLowerCase()
);

if (isProduction && !API_KEY) {
  throw new Error('BACKEND_API_KEY is required when NODE_ENV=production');
}

if (isProduction && !PAKASIR_WEBHOOK_SECRET) {
  throw new Error('PAKASIR_WEBHOOK_SECRET is required when NODE_ENV=production');
}

let missingApiKeyWarned = false;
let missingPakasirWebhookSecretWarned = false;

function isLoopbackAddress(address = '') {
  const normalized = String(address).trim().replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

function requireApiKey(req, res, next) {
  if (!API_KEY) {
    if (!missingApiKeyWarned) {
      logger.warn('BACKEND_API_KEY not configured - protected endpoints are open');
      missingApiKeyWarned = true;
    }
    return next();
  }

  if (allowLoopbackWithoutApiKey && isLoopbackAddress(req.socket?.remoteAddress)) {
    return next();
  }

  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key !== API_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

function requirePakasirWebhookSecret(req, res, next) {
  if (!PAKASIR_WEBHOOK_SECRET) {
    if (!missingPakasirWebhookSecretWarned) {
      logger.warn('PAKASIR_WEBHOOK_SECRET not configured - /webhooks/pakasir is open');
      missingPakasirWebhookSecretWarned = true;
    }
    return next();
  }

  const incoming = req.headers['x-pakasir-secret'] || req.query.webhook_secret;
  if (incoming !== PAKASIR_WEBHOOK_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  return next();
}

// SECURITY: Sanitize error responses - never leak internal details
function sanitizeError(error) {
  // Log the full error for debugging
  logger.error({ err: error }, 'Request error');
  // Return generic message to client
  return 'Internal server error';
}

function validateOrderPayload(eventType, order) {
  if (!eventType || !['draft_order', 'final_order'].includes(eventType)) {
    return 'Invalid event_type';
  }

  if (!order?.client_order_id) {
    return 'order.client_order_id is required';
  }

  if (!order?.customer?.phone) {
    return 'order.customer.phone is required';
  }

  return null;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ngupi-backend' });
});

// SECURITY: Apply API key to all routes except /health
app.use('/bridge', requireApiKey);
app.use('/webhooks/orders', requireApiKey);
app.use('/payments', requireApiKey);
app.use('/orders', requireApiKey);
app.use('/queue', requireApiKey);

app.post('/webhooks/orders', async (req, res) => {
  try {
    const { event_type: eventType, order } = req.body ?? {};
    const validationError = validateOrderPayload(eventType, order);

    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    const saved = await createOrUpdateOrder(eventType, order);

    res.json({
      ok: true,
      received: true,
      event_type: eventType,
      backend_order_id: saved.id,
      client_order_id: saved.client_order_id
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.post('/queue/orders', async (req, res) => {
  try {
    const { event_type: eventType, order } = req.body ?? {};
    const validationError = validateOrderPayload(eventType, order);

    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    await ensureQueueDirs();

    const queueKind = eventType === 'final_order' ? 'final' : 'draft';
    const fileName = buildQueueFileName(queueKind, order.client_order_id);
    const filePath = await writeQueueFile(queueKind, fileName, req.body);
    const responseBody = {
      ok: true,
      queued: true,
      event_type: eventType,
      queue_kind: queueKind,
      file: filePath,
      client_order_id: order.client_order_id
    };

    if (autoProcessQueue) {
      responseBody.processed = await processAllQueues();
    }

    res.json(responseBody);
  } catch (error) {
    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.post('/bridge/order-context', async (req, res) => {
  try {
    const { customer_phone: customerPhone, updates } = req.body ?? {};

    if (!customerPhone) {
      return res.status(400).json({ ok: false, error: 'customer_phone is required' });
    }

    if (updates !== undefined && (typeof updates !== 'object' || updates === null || Array.isArray(updates))) {
      return res.status(400).json({ ok: false, error: 'updates must be a JSON object' });
    }

    const result = await upsertOrderContext(customerPhone, updates ?? {});
    const responseBody = { ok: true, data: result };

    if (autoProcessQueue && result.events.length > 0) {
      responseBody.processed = await processAllQueues();
    }

    res.json(responseBody);
  } catch (error) {
    if (String(error?.message ?? '').includes('invalid customer phone')) {
      return res.status(400).json({ ok: false, error: 'invalid customer_phone' });
    }

    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.get('/bridge/order-context/:phone', async (req, res) => {
  try {
    const state = await getOrderContextState(req.params.phone);
    res.json({ ok: true, data: state });
  } catch (error) {
    if (String(error?.message ?? '').includes('invalid customer phone')) {
      return res.status(400).json({ ok: false, error: 'invalid customer_phone' });
    }

    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.post('/payments/pakasir/qris', async (req, res) => {
  try {
    if (!req.body?.client_order_id) {
      return res.status(400).json({ ok: false, error: 'client_order_id is required' });
    }

    const baseUrl = buildPaymentBaseUrl(req);
    const result = await createPakasirQrisPayment({
      clientOrderId: req.body?.client_order_id,
      amountOverride: req.body?.amount,
      baseUrl
    });

    res.json({
      ok: true,
      data: result
    });
  } catch (error) {
    const message = String(error?.message ?? '').toLowerCase();
    if (message.includes('client_order_id is required')) {
      return res.status(400).json({ ok: false, error: 'client_order_id is required' });
    }
    if (message.includes('order not found')) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }
    if (message.includes('amount override must be a positive number')) {
      return res.status(400).json({ ok: false, error: 'amount must be a positive number' });
    }

    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.post('/payments/resend', async (req, res) => {
  try {
    const { payment_id } = req.body ?? {};
    if (!payment_id) {
      return res.status(400).json({ ok: false, error: 'payment_id is required' });
    }

    const baseUrl = buildPaymentBaseUrl(req);
    const payment = await getPaymentSessionById(payment_id, { baseUrl });
    if (!payment) {
      return res.status(404).json({ ok: false, error: 'payment not found' });
    }

    const order = await getOrderByClientOrderId(payment.client_order_id);
    const whatsappResult = await sendQrisImageBestEffort(order, payment, { force: true });

    res.json({
      ok: true,
      data: {
        qr_image_url: payment.qr_image_url,
        qr_string: payment.qr_string,
        whatsapp_sent: whatsappResult.ok,
        whatsapp_error: whatsappResult.error ?? null
      }
    });
  } catch (error) {
    if (String(error?.message ?? '').toLowerCase().includes('not found')) {
      return res.status(404).json({ ok: false, error: 'Resource not found' });
    }

    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.post('/payments/qris/direct', async (req, res) => {
  logger.info({ customer_phone: req.body?.customer_phone }, '[qris/direct] incoming request');
  try {
    const { customer_phone, customer_name, items, fulfillment_method, shareloc, delivery_provider, amount } = req.body;

    if (!customer_phone || !fulfillment_method) {
      return res.status(400).json({ ok: false, error: 'customer_phone and fulfillment_method are required' });
    }

    if (!items && !amount) {
      return res.status(400).json({ ok: false, error: 'either items or amount is required' });
    }

    if (items !== undefined && !Array.isArray(items)) {
      return res.status(400).json({ ok: false, error: 'items must be an array' });
    }

    // Create or update order via bridge
    const stateResult = await upsertOrderContext(customer_phone, {
      customerName: customer_name,
      items,
      fulfillmentMethod: fulfillment_method,
      shareloc,
      deliveryProvider: delivery_provider,
      paymentMethod: 'qris',
      paymentStatus: 'pending',
      rawMessage: req.body.raw_message || 'Direct API Order'
    });

    const clientOrderId = stateResult.state.orderContext?.clientOrderId;

    if (!clientOrderId) {
      return res.status(500).json({ ok: false, error: 'Failed to create order - clientOrderId not generated' });
    }

    logger.info('[qris/direct] order context updated, clientOrderId: %s', clientOrderId);

    if (stateResult.skipQris) {
      logger.info('[qris/direct] duplicate QRIS request ignored (cooldown active) for %s', clientOrderId);
      return res.json({
        ok: true,
        data: {
          client_order_id: clientOrderId,
          skipped: true,
          reason: 'qris_deduplicated'
        }
      });
    }

    // Wait a moment for draft to be queued, then process
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Process queue to persist draft to DB
    try {
      await Promise.race([
        processAllQueues(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Queue timeout')), 10000))
      ]);
    } catch (e) {
      logger.warn('[qris/direct] Queue processing warning: %s', e.message);
    }

    logger.info('[qris/direct] queue processing completed');

    // Create QRIS payment
    logger.info('[qris/direct] creating QRIS payment for %s', clientOrderId);
    const baseUrl = buildPaymentBaseUrl(req);
    let paymentResult = await createPakasirQrisPayment({
      clientOrderId,
      amountOverride: amount,
      baseUrl
    });

    // If reused (existing) payment is already confirmed, create a fresh QRIS with new order ID
    if (paymentResult.reused && paymentResult.payment?.payment_status === 'confirmed') {
      const orderId = paymentResult.order?.id;
      if (orderId) {
        logger.info('[qris/direct] existing payment already paid, creating new QRIS for order %s', orderId);
        paymentResult = await recreatePakasirQrisPaymentForOrder({
          orderId,
          amountOverride: amount,
          baseUrl
        });
      }
    }

    logger.info({
      qr_image_url: paymentResult?.payment?.qr_image_url,
      whatsapp_sent: paymentResult?.whatsapp_qris_delivery?.ok
    }, '[qris/direct] QRIS payment created');

    // Return clean response with WhatsApp delivery status
    const waDelivery = paymentResult?.whatsapp_qris_delivery;
    res.json({
      ok: true,
      data: {
        client_order_id: clientOrderId,
        qr_image_url: paymentResult?.payment?.qr_image_url ?? null,
        qr_string: paymentResult?.payment?.qr_string ?? null,
        total_payment: paymentResult?.payment?.total_payment ?? null,
        amount: paymentResult?.payment?.amount ?? null,
        expired_at: paymentResult?.payment?.expired_at ?? null,
        whatsapp_sent: waDelivery?.ok === true,
        whatsapp_skipped: waDelivery?.skipped === true,
        whatsapp_error: waDelivery?.error ?? null
      }
    });
  } catch (error) {
    const message = String(error?.message ?? '');
    if (message.includes('invalid customer phone')) {
      return res.status(400).json({ ok: false, error: 'invalid customer_phone' });
    }
    if (message.includes('amount override must be a positive number')) {
      return res.status(400).json({ ok: false, error: 'amount must be a positive number' });
    }

    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.get('/payments/:id', async (req, res) => {
  try {
    const baseUrl = buildPaymentBaseUrl(req);
    const payment = await getPaymentSessionById(req.params.id, { baseUrl });
    res.json({ ok: true, data: payment });
  } catch (error) {
    if (String(error?.message ?? '').toLowerCase().includes('not found')) {
      return res.status(404).json({ ok: false, error: 'Resource not found' });
    }

    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.get('/payments/:id/qr.png', async (req, res) => {
  try {
    const payment = await getPaymentSessionById(req.params.id);

    if (!payment.qr_string) {
      return res.status(404).json({ ok: false, error: 'QR string not found for this payment' });
    }

    const png = await QRCode.toBuffer(payment.qr_string, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
      type: 'png'
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (error) {
    if (String(error?.message ?? '').toLowerCase().includes('not found')) {
      return res.status(404).json({ ok: false, error: 'Resource not found' });
    }

    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.get('/payments/:id/qr.json', async (req, res) => {
  try {
    const payment = await getPaymentSessionById(req.params.id);

    if (!payment.qr_string) {
      return res.status(404).json({ ok: false, error: 'QR string not found for this payment' });
    }

    const png = await QRCode.toBuffer(payment.qr_string, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
      type: 'png'
    });

    const base64 = png.toString('base64');
    res.json({
      ok: true,
      data: {
        qr_data_url: `data:image/png;base64,${base64}`,
        qr_string: payment.qr_string,
        qr_image_url: payment.qr_image_url
      }
    });
  } catch (error) {
    if (String(error?.message ?? '').toLowerCase().includes('not found')) {
      return res.status(404).json({ ok: false, error: 'Resource not found' });
    }

    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.post('/webhooks/pakasir', requirePakasirWebhookSecret, async (req, res) => {
  try {
    const result = await verifyPakasirPaymentWebhook(req.body ?? {});
    const responseBody = { ok: true, data: result };

    if (autoProcessQueue && result.events.length > 0) {
      responseBody.processed = await processAllQueues();
    }

    res.json(responseBody);
  } catch (error) {
    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.post('/queue/process', async (_req, res) => {
  try {
    const result = await processAllQueues();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.post('/queue/retry-failed', async (_req, res) => {
  try {
    const result = await retryFailedQueues();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.post('/payments/poll-pending', async (_req, res) => {
  try {
    const results = await pollPendingPaymentsAndVerify();
    res.json({ ok: true, data: results });
  } catch (error) {
    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.post('/payments/replay-success-notification', async (req, res) => {
  try {
    const { client_order_id } = req.body ?? {};
    if (!client_order_id) {
      return res.status(400).json({ ok: false, error: 'client_order_id is required' });
    }

    const result = await replaySuccessNotificationByClientOrderId(client_order_id);
    return res.json({ ok: true, data: result });
  } catch (error) {
    const message = String(error?.message ?? '').toLowerCase();
    if (message.includes('order not found')) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    return res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.get('/orders', async (_req, res) => {
  try {
    const orders = await listOrders();
    res.json({ ok: true, data: orders });
  } catch (error) {
    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.get('/orders/:id', async (req, res) => {
  try {
    const order = await getOrderById(req.params.id);
    res.json({ ok: true, data: order });
  } catch (error) {
    if (String(error?.message ?? '').toLowerCase().includes('not found')) {
      return res.status(404).json({ ok: false, error: 'Resource not found' });
    }

    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Route not found' });
});

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
await ensureQueueDirs();
await ensureStateDirs();
const server = app.listen(port, () => {
  logger.info(`Ngupi backend listening on port ${port}`);
});

// Graceful shutdown
const shutdown = (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
