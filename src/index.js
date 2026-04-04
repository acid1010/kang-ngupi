import 'dotenv/config';
import express from 'express';
import QRCode from 'qrcode';
import { upsertOrderContext, getOrderContextState } from './bridge/stateService.js';
import {
  buildPaymentBaseUrl,
  createPakasirQrisPayment,
  getPaymentSessionById,
  verifyPakasirPaymentWebhook
} from './payments/service.js';
import { createOrUpdateOrder, getOrderById, listOrders } from './repositories/orders.js';
import { buildQueueFileName, ensureQueueDirs, writeQueueFile } from './queue/fs.js';
import { processAllQueues, retryFailedQueues } from './queue/processor.js';
import { ensureStateDirs } from './state/store.js';

const app = express();
app.use(express.json());

const autoProcessQueue = ['1', 'true', 'yes'].includes(String(process.env.AUTO_PROCESS_QUEUE || '').toLowerCase());

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
    res.status(500).json({ ok: false, error: error.message });
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
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/bridge/order-context', async (req, res) => {
  try {
    const { customer_phone: customerPhone, updates } = req.body ?? {};

    if (!customerPhone) {
      return res.status(400).json({ ok: false, error: 'customer_phone is required' });
    }

    const result = await upsertOrderContext(customerPhone, updates ?? {});
    const responseBody = { ok: true, data: result };

    if (autoProcessQueue && result.events.length > 0) {
      responseBody.processed = await processAllQueues();
    }

    res.json(responseBody);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/bridge/order-context/:phone', async (req, res) => {
  try {
    const state = await getOrderContextState(req.params.phone);
    res.json({ ok: true, data: state });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/payments/pakasir/qris', async (req, res) => {
  try {
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
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/payments/qris/direct', async (req, res) => {
  try {
    const { customer_phone, customer_name, items, fulfillment_method, shareloc, delivery_provider } = req.body;

    if (!customer_phone || !items || !fulfillment_method) {
      return res.status(400).json({ ok: false, error: 'customer_phone, items, and fulfillment_method are required' });
    }

    // Create or update order via bridge
    const stateResult = await upsertOrderContext(customer_phone, {
      customerName: customer_name,
      items,
      fulfillmentMethod: fulfillment_method,
      shareloc,
      deliveryProvider: delivery_provider,
      paymentMethod: 'qris',
      paymentStatus: 'pending'
    });

    const clientOrderId = stateResult.state.orderContext?.clientOrderId;

    if (!clientOrderId) {
      return res.status(500).json({ ok: false, error: 'Failed to create order - clientOrderId not generated' });
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
      console.warn('[qris/direct] Queue processing warning:', e.message);
    }

    // Create QRIS payment
    const baseUrl = buildPaymentBaseUrl(req);
    const paymentResult = await createPakasirQrisPayment({
      clientOrderId,
      baseUrl
    });

    res.json({
      ok: true,
      data: {
        client_order_id: clientOrderId,
        ...paymentResult
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/payments/:id', async (req, res) => {
  try {
    const baseUrl = buildPaymentBaseUrl(req);
    const payment = await getPaymentSessionById(req.params.id, { baseUrl });
    res.json({ ok: true, data: payment });
  } catch (error) {
    res.status(404).json({ ok: false, error: error.message });
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
    res.status(404).json({ ok: false, error: error.message });
  }
});

app.post('/webhooks/pakasir', async (req, res) => {
  try {
    const result = await verifyPakasirPaymentWebhook(req.body ?? {});
    const responseBody = { ok: true, data: result };

    if (autoProcessQueue && result.events.length > 0) {
      responseBody.processed = await processAllQueues();
    }

    res.json(responseBody);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/queue/process', async (_req, res) => {
  try {
    const result = await processAllQueues();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/queue/retry-failed', async (_req, res) => {
  try {
    const result = await retryFailedQueues();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/orders', async (_req, res) => {
  try {
    const orders = await listOrders();
    res.json({ ok: true, data: orders });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/orders/:id', async (req, res) => {
  try {
    const order = await getOrderById(req.params.id);
    res.json({ ok: true, data: order });
  } catch (error) {
    res.status(404).json({ ok: false, error: error.message });
  }
});

const port = Number(process.env.PORT || 3001);
await ensureQueueDirs();
await ensureStateDirs();
app.listen(port, () => {
  console.log(`Ngupi backend listening on port ${port}`);
});
