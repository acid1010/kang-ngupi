import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import logger from './lib/logger.js';
import dashboardRouter from './dashboard/index.js';
import { getSupabase } from './supabase.js';
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
import { generateQris, queryQris, verifyWebhookSignature as verifyDokuWebhook, getDokuConfig } from './payments/doku.js';
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
app.set('trust proxy', 1); // Behind nginx reverse proxy

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for dashboard static files
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' } // Allow QR images
}));

// Serve static files (menu images, etc.)
app.use('/menu-images', express.static(join(__dirname, '..', 'public', 'menu-images'), {
  maxAge: '7d',
  immutable: true
}));

// Rate limiting
const apiLimiter = rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 60_000, max: 5, message: { ok: false, error: 'Too many login attempts, try again in 1 minute' } });
const webhookLimiter = rateLimit({ windowMs: 60_000, max: 30 });
app.use('/dashboard/api', apiLimiter);
app.use('/dashboard/api/auth/login', loginLimiter);
app.use('/webhooks', webhookLimiter);
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

app.get('/health', async (_req, res) => {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('orders').select('count').limit(1);
    res.json({ ok: !error, service: 'ngupi-backend', uptime: Math.round(process.uptime()), memoryMB: Math.round(process.memoryUsage().rss / 1048576), db: error ? 'error' : 'ok' });
  } catch (e) {
    res.status(503).json({ ok: false, service: 'ngupi-backend', error: 'unhealthy' });
  }
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

    // Ensure order exists in DB (direct create, skip slow queue)
    try {
      const { getSupabase } = await import('./supabase.js');
      const sb = getSupabase();
      const { data: existingOrder } = await sb.from('orders').select('id').eq('client_order_id', clientOrderId).limit(1);
      if (!existingOrder || existingOrder.length === 0) {
        const { createOrderFromContext } = await import('./repositories/orders.js');
        const ctx = stateResult.state.orderContext;
        await createOrderFromContext(ctx);
        logger.info('[qris/direct] Order created in DB for %s', clientOrderId);
      }
    } catch (dbErr) {
      logger.warn('[qris/direct] DB order creation failed: %s', dbErr.message);
    }

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

    // Re-check payment metadata for evaluator race condition
    // Evaluator may have sent WhatsApp between payment creation and this point
    let freshPaymentMeta = paymentResult?.payment?.metadata;
    if (paymentResult?.payment?.id && !paymentResult?.whatsapp_qris_delivery?.ok) {
      try {
        const freshPayment = await getPaymentSessionById(paymentResult.payment.id);
        if (freshPayment?.metadata) freshPaymentMeta = freshPayment.metadata;
      } catch (_) { /* ignore, use original */ }
    }

    const waDelivery = paymentResult?.whatsapp_qris_delivery;
    const evaluatorAlreadySent = freshPaymentMeta?.whatsapp_sent_at != null;
    const whatsappSent = waDelivery?.ok === true || evaluatorAlreadySent;
    const whatsappSkipped = !whatsappSent && (waDelivery?.skipped === true);

    logger.info({
      qr_image_url: paymentResult?.payment?.qr_image_url,
      whatsapp_sent: whatsappSent,
      sent_by: evaluatorAlreadySent ? 'evaluator' : (waDelivery?.ok ? 'qris_direct' : 'none')
    }, '[qris/direct] QRIS payment created');

    res.json({
      ok: true,
      data: {
        client_order_id: clientOrderId,
        qr_image_url: paymentResult?.payment?.qr_image_url ?? null,
        qr_string: paymentResult?.payment?.qr_string ?? null,
        total_payment: paymentResult?.payment?.total_payment ?? null,
        amount: paymentResult?.payment?.amount ?? null,
        expired_at: paymentResult?.payment?.expired_at ?? null,
        whatsapp_sent: whatsappSent,
        whatsapp_skipped: whatsappSkipped,
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

// ── Doku QRIS endpoints ──
app.post('/payments/doku/qris', requireApiKey, async (req, res) => {
  try {
    const { orderId, amount, validityMinutes } = req.body;
    if (!orderId || !amount) {
      return res.status(400).json({ ok: false, error: 'orderId and amount required' });
    }
    const result = await generateQris({ orderId, amount: parseInt(amount), validityMinutes });
    res.json(result);
  } catch (error) {
    logger.error({ error: error.message }, '[doku] Generate QRIS error');
    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.post('/payments/doku/query', requireApiKey, async (req, res) => {
  try {
    const { originalReferenceNo, partnerReferenceNo } = req.body;
    if (!originalReferenceNo && !partnerReferenceNo) {
      return res.status(400).json({ ok: false, error: 'originalReferenceNo or partnerReferenceNo required' });
    }
    const result = await queryQris({ originalReferenceNo, partnerReferenceNo });
    res.json(result);
  } catch (error) {
    logger.error({ error: error.message }, '[doku] Query QRIS error');
    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.get('/payments/doku/config', requireApiKey, (_req, res) => {
  res.json({ ok: true, data: getDokuConfig() });
});

app.post('/webhooks/doku', async (req, res) => {
  try {
    const signature = req.headers['x-signature'];
    const timestamp = req.headers['x-timestamp'];
    const clientId = req.headers['x-client-key'] || req.headers['x-partner-id'];
    const rawBody = JSON.stringify(req.body);

    logger.info({ clientId, hasSignature: !!signature }, '[doku] Webhook received');

    // Verify signature
    const valid = verifyDokuWebhook({ signature, timestamp, body: rawBody, clientId });
    if (!valid) {
      logger.warn('[doku] Webhook signature verification failed');
      return res.status(401).json({ responseCode: '4014700', responseMessage: 'Unauthorized' });
    }

    // Process notification
    const body = req.body;
    const partnerReferenceNo = body.partnerReferenceNo || body.originalPartnerReferenceNo;
    const transactionStatus = body.latestTransactionStatus || body.transactionStatus;
    const paid = transactionStatus === '00';
    const paidTime = body.paidTime || new Date().toISOString();

    logger.info({ partnerReferenceNo, transactionStatus, paid, paidTime }, '[doku] Webhook payment notification');

    if (paid && partnerReferenceNo) {
      // Find and process pending payment file
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const pendingDir = path.join(process.cwd(), '..', 'state', 'doku-pending');
      const pendingFile = path.join(pendingDir, `${partnerReferenceNo}.json`);

      try {
        const raw = await fs.readFile(pendingFile, 'utf-8');
        const payment = JSON.parse(raw);

        logger.info({ orderId: partnerReferenceNo, phone: payment.phone }, '[doku] Webhook: processing confirmed payment');

        // Update order state file
        const stateDir = path.join(process.cwd(), '..', 'state', 'orders-active');
        const stateFile = path.join(stateDir, `${payment.phone.replace(/[^a-zA-Z0-9+._-]/g, '_')}.json`);
        try {
          const stateRaw = await fs.readFile(stateFile, 'utf-8');
          const state = JSON.parse(stateRaw);
          const ctx = state.orderContext || state;
          ctx.paymentStatus = 'confirmed';
          ctx.paidAt = paidTime;
          await fs.writeFile(stateFile, JSON.stringify(state.orderContext ? state : ctx, null, 2));
        } catch (_) {}

        // Update DB
        try {
          const sb = getSupabase();
          await sb.from('orders')
            .update({ payment_status: 'confirmed', paid_at: paidTime })
            .eq('client_order_id', partnerReferenceNo);
        } catch (_) {}

        // Send WhatsApp success notification
        try {
          const { sendQrisSuccessWhatsApp } = await import('./notifications/whatsapp.js');
          await sendQrisSuccessWhatsApp({
            to: payment.phone,
            customerName: payment.customerName,
            order: { fulfillment_method: payment.fulfillmentMethod }
          });
          logger.info({ phone: payment.phone }, '[doku] Webhook: success notification sent');
        } catch (e) {
          logger.warn({ error: e.message }, '[doku] Webhook: WhatsApp notification failed');
        }

        // Push to Pawoon POS
        try {
          const { pushOrderToPawoon } = await import('./integrations/pawoon.js');
          const sb2 = getSupabase();
          const { data: dbOrder } = await sb2.from('orders').select('*').eq('client_order_id', partnerReferenceNo).single();
          if (dbOrder) {
            const { data: orderItems } = await sb2.from('order_items').select('menu_name, menu_id, qty, temperature, notes').eq('order_id', dbOrder.id);
            const pawoonOrder = {
              ...dbOrder,
              table_number: dbOrder.table_number || payment.tableNumber || null
            };
            const pawoonPayment = { amount: dbOrder.total_amount || payment.amount, method: 'cash' };
            const pawoonResult = await pushOrderToPawoon(pawoonOrder, orderItems || [], pawoonPayment);
            if (pawoonResult.ok) {
              logger.info({ orderId: partnerReferenceNo, pawoonId: pawoonResult.pawoonOrderId }, '[doku] Webhook: pushed to Pawoon');
            }
          }
        } catch (pawErr) {
          logger.warn({ orderId: partnerReferenceNo, error: pawErr.message }, '[doku] Webhook: Pawoon push failed');
        }

        // Remove from pending (so poller doesn't double-process)
        await fs.unlink(pendingFile).catch(() => {});

        logger.info({ orderId: partnerReferenceNo }, '[doku] Webhook: payment fully processed');
      } catch (e) {
        // Pending file not found — maybe already processed by poller
        if (e.code === 'ENOENT') {
          logger.info({ orderId: partnerReferenceNo }, '[doku] Webhook: pending file not found (already processed by poller)');
        } else {
          logger.warn({ orderId: partnerReferenceNo, error: e.message }, '[doku] Webhook: error processing pending payment');
        }
      }
    }

    res.json({ responseCode: '2004700', responseMessage: 'Success' });
  } catch (error) {
    logger.error({ error: error.message }, '[doku] Webhook processing error');
    res.status(500).json({ responseCode: '5004700', responseMessage: 'Internal Server Error' });
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
    try { const { alertWebhookError } = await import('./notifications/alerting.js'); await alertWebhookError(error.message); } catch (_) {}
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

app.get('/orders', requireApiKey, async (_req, res) => {
  try {
    const orders = await listOrders();
    res.json({ ok: true, data: orders });
  } catch (error) {
    res.status(500).json({ ok: false, error: sanitizeError(error) });
  }
});

app.get('/orders/:id', requireApiKey, async (req, res) => {
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

// Pawoon Webhook — receive stock/product updates from POS
app.post('/webhooks/pawoon', async (req, res) => {
  try {
    const payload = req.body;

    // Basic payload validation — reject empty/non-object
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      logger.warn('[pawoon-webhook] Rejected: invalid payload type');
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }

    // Limit payload size (prevent abuse)
    const payloadStr = JSON.stringify(payload);
    if (payloadStr.length > 50_000) {
      logger.warn('[pawoon-webhook] Rejected: payload too large (%d bytes)', payloadStr.length);
      return res.status(413).json({ ok: false, error: 'Payload too large' });
    }

    logger.info({ type: payload?.type, event: payload?.event, data: payload?.data?.id || payload?.id }, '[pawoon-webhook] Received');
    logger.info({ payload: payloadStr.slice(0, 500) }, '[pawoon-webhook] Payload');

    // Handle product/stock updates
    const eventType = payload?.type || payload?.event || 'unknown';

    if (eventType.includes('product') || eventType.includes('stock') || eventType.includes('inventory')) {
      // Trigger menu re-sync
      logger.info('[pawoon-webhook] Product/stock change detected, triggering menu sync');
      try {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync('node', ['/home/ubuntu/workspace-sobatngupi/backend/pawoon-sync-menu.js'], { timeout: 30_000 });
        logger.info('[pawoon-webhook] Menu sync completed: %s', stdout.trim().split('\n').pop());
      } catch (syncErr) {
        logger.warn('[pawoon-webhook] Menu sync failed: %s', syncErr.message);
      }
    }

    res.json({ ok: true, received: true });
  } catch (error) {
    logger.error({ err: error }, '[pawoon-webhook] Error processing webhook');
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

// Dashboard API (CORS enabled for Next.js frontend)
const DASHBOARD_ORIGINS = [
  'https://ngupingupi.me',
  'http://localhost:3000',
  'http://localhost:3002',
  ...(process.env.DASHBOARD_EXTRA_ORIGINS || '').split(',').filter(Boolean),
];
const dashboardCors = cors({
  origin: (origin, cb) => {
    // Allow no-origin (mobile apps, curl) + whitelisted + any *.vercel.app
    if (!origin || DASHBOARD_ORIGINS.includes(origin) || /\.vercel\.app$/.test(origin)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
  credentials: true
});
app.use('/dashboard', dashboardCors, dashboardRouter);

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Route not found' });
});

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
await ensureQueueDirs();
await ensureStateDirs();
// Start internal scheduler (QRIS cancel, expire, drafts)
import { startScheduler } from './scheduler/index.js';

const server = app.listen(port, () => {
  logger.info(`Ngupi backend listening on port ${port}`);
  startScheduler();
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
