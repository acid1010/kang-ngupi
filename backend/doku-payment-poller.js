#!/usr/bin/env node
/**
 * Doku QRIS Payment Poller
 * 
 * Polls pending Doku QRIS payments and auto-verifies when paid.
 * Sends WhatsApp success notification to customer.
 * 
 * Usage: node backend/doku-payment-poller.js
 * Run via PM2 for production.
 */

import 'dotenv/config';
import { queryQris } from './src/payments/doku.js';
import { sendQrisSuccessWhatsApp } from './src/notifications/whatsapp.js';
import logger from './src/lib/logger.js';
import { getSupabase } from './src/supabase.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLL_INTERVAL_MS = parseInt(process.env.DOKU_POLL_INTERVAL_MS || '15000');
const PENDING_DIR = path.join(__dirname, '..', 'state', 'doku-pending');
const WORKSPACE_ROOT = path.join(__dirname, '..');

// Ensure pending dir exists
await fs.mkdir(PENDING_DIR, { recursive: true });

/**
 * Track a new Doku QRIS payment for polling
 */
export async function trackDokuPayment({ orderId, referenceNo, phone, customerName, amount, fulfillmentMethod }) {
  const filePath = path.join(PENDING_DIR, `${orderId}.json`);
  await fs.writeFile(filePath, JSON.stringify({
    orderId,
    referenceNo,
    phone,
    customerName,
    amount,
    fulfillmentMethod,
    createdAt: new Date().toISOString(),
    attempts: 0
  }, null, 2));
  logger.info({ orderId, referenceNo }, '[doku-poller] Tracking new payment');
}

/**
 * Poll all pending payments
 */
async function pollPendingPayments() {
  let files;
  try {
    files = await fs.readdir(PENDING_DIR);
  } catch {
    return;
  }

  const jsonFiles = files.filter(f => f.endsWith('.json'));
  if (jsonFiles.length === 0) return;

  logger.info({ count: jsonFiles.length }, '[doku-poller] Polling pending payments');

  for (const file of jsonFiles) {
    const filePath = path.join(PENDING_DIR, file);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const payment = JSON.parse(raw);

      // Skip if too old (>1 hour)
      const age = Date.now() - new Date(payment.createdAt).getTime();
      if (age > 60 * 60 * 1000) {
        logger.info({ orderId: payment.orderId }, '[doku-poller] Payment expired (>1h), removing');
        await fs.unlink(filePath).catch(() => {});
        continue;
      }

      // Query Doku
      const result = await queryQris({
        originalReferenceNo: payment.referenceNo,
        partnerReferenceNo: payment.orderId
      });

      payment.attempts++;

      if (result.ok && result.paid) {
        logger.info({ orderId: payment.orderId, paidTime: result.paidTime }, '[doku-poller] Payment CONFIRMED!');

        // Update order state file
        try {
          const stateFile = path.join(WORKSPACE_ROOT, 'state', 'orders-active', `${payment.phone.replace(/[^a-zA-Z0-9+._-]/g, '_')}.json`);
          const stateRaw = await fs.readFile(stateFile, 'utf-8').catch(() => null);
          if (stateRaw) {
            const state = JSON.parse(stateRaw);
            const ctx = state.orderContext || state;
            ctx.paymentStatus = 'confirmed';
            ctx.paidAt = result.paidTime || new Date().toISOString();
            await fs.writeFile(stateFile, JSON.stringify(state.orderContext ? state : ctx, null, 2));
          }
        } catch (e) {
          logger.warn({ error: e.message }, '[doku-poller] Failed to update state file');
        }

        // Update DB if exists
        try {
          const sb = getSupabase();
          await sb.from('orders')
            .update({ payment_status: 'confirmed', paid_at: result.paidTime || new Date().toISOString() })
            .eq('client_order_id', payment.orderId);
        } catch (e) {
          logger.warn({ error: e.message }, '[doku-poller] Failed to update DB');
        }

        // Push to Pawoon POS
        try {
          const stateFile = path.join(WORKSPACE_ROOT, 'state', 'orders-active', `${payment.phone.replace(/[^a-zA-Z0-9+._-]/g, '_')}.json`);
          const stateRaw = await fs.readFile(stateFile, 'utf-8').catch(() => null);
          if (stateRaw) {
            const state = JSON.parse(stateRaw);
            const ctx = state.orderContext || state;
            // Push to Pawoon POS
            try {
              const { pushOrderToPawoon } = await import('./src/integrations/pawoon.js');
              const pawoonOrder = {
                client_order_id: payment.orderId,
                customer_name_snapshot: payment.customerName || ctx.customerName,
                customer_phone_snapshot: payment.phone,
                fulfillment_method: ctx.fulfillmentMethod || 'dine_in',
                table_number: ctx.tableNumber || null,
                payment_method: 'qris',
                notes: ctx.notes
              };
              const pawoonItems = (ctx.items || []).map(i => ({
                menu_name: i.menuName || i.menu_name,
                qty: i.quantity || i.qty || 1,
                price: i.price || 0
              }));
              const totalAmount = pawoonItems.reduce((sum, i) => sum + (i.price * i.qty), 0) + (Number(ctx.deliveryFee) || 0);
              const pawoonPayment = { amount: totalAmount, method: 'cash' };
              const pawoonResult = await pushOrderToPawoon(pawoonOrder, pawoonItems, pawoonPayment);
              if (pawoonResult.ok) {
                logger.info({ orderId: payment.orderId, pawoonId: pawoonResult.pawoonOrderId }, '[doku-poller] Pushed to Pawoon');
              } else {
                logger.warn({ orderId: payment.orderId, reason: pawoonResult.reason }, '[doku-poller] Pawoon push skipped/failed');
              }
            } catch (pawErr) {
              logger.warn({ orderId: payment.orderId, error: pawErr.message }, '[doku-poller] Pawoon push error');
            }
          }
        } catch (e) {
          logger.warn({ error: e.message }, '[doku-poller] Pawoon push failed');
        }

        // Send WhatsApp success notification (with full order from DB for receipt)
        try {
          let fullOrder = { fulfillment_method: payment.fulfillmentMethod };
          try {
            const { createClient } = await import('@supabase/supabase-js');
            const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
            const { data: dbOrder } = await sb.from('orders').select('*').eq('client_order_id', payment.orderId).single();
            if (dbOrder) fullOrder = dbOrder;
          } catch (_) {}
          await sendQrisSuccessWhatsApp({
            to: payment.phone,
            customerName: payment.customerName,
            order: fullOrder
          });
          logger.info({ phone: payment.phone }, '[doku-poller] Success notification sent');
        } catch (e) {
          logger.warn({ error: e.message }, '[doku-poller] WhatsApp notification failed');
        }

        // Notify courier if delivery
        if (payment.fulfillmentMethod === 'delivery') {
          try {
            const { notifyCouriers } = await import('./src/notifications/courier.js');
            const courierOrder = {
              client_order_id: payment.orderId,
              customer_name_snapshot: payment.customerName,
              customer_phone_snapshot: payment.phone,
              fulfillment_method: 'delivery',
              payment_method: 'qris',
              location_lat: ctx.shareloc?.lat || null,
              location_lng: ctx.shareloc?.lng || null
            };
            const courierItems = (ctx.items || []).map(i => ({
              menu_name: i.menuName || i.menu_name,
              qty: i.quantity || i.qty || 1,
              temperature: i.temperature || null
            }));
            const totalAmount = courierItems.reduce((sum, i) => sum + ((i.price || 0) * i.qty), 0) + (Number(ctx.deliveryFee) || 0);
            const courierPayment = { amount: totalAmount, total_payment: totalAmount };
            const courierResult = await notifyCouriers(courierOrder, courierItems, courierPayment);
            if (courierResult.ok) {
              logger.info({ orderId: payment.orderId }, '[doku-poller] Courier notified');
            }
          } catch (courierErr) {
            logger.warn({ orderId: payment.orderId, error: courierErr.message }, '[doku-poller] Courier notification failed');
          }
        }

        // Remove from pending
        await fs.unlink(filePath).catch(() => {});
      } else {
        // Update attempts count
        await fs.writeFile(filePath, JSON.stringify(payment, null, 2));
      }
    } catch (e) {
      logger.error({ file, error: e.message }, '[doku-poller] Error processing payment');
    }
  }
}

// ── Main loop ──
logger.info({ intervalMs: POLL_INTERVAL_MS }, '[doku-poller] Starting Doku payment poller');

async function loop() {
  while (true) {
    try {
      await pollPendingPayments();
    } catch (e) {
      logger.error({ error: e.message }, '[doku-poller] Poll cycle error');
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

loop();
