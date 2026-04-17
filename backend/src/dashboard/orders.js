/**
 * Dashboard Orders API — CRUD + realtime SSE for order management
 */

import { Router } from 'express';
import { getSupabase } from '../supabase.js';
import logger from '../lib/logger.js';

const router = Router();

// SSE clients for realtime updates
const sseClients = new Set();

export function broadcastOrderUpdate(order) {
  const data = JSON.stringify({ type: 'order_update', order });
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

export function broadcastNewOrder(order) {
  const data = JSON.stringify({ type: 'new_order', order });
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

// SSE endpoint for realtime updates
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  sseClients.add(res);

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(heartbeat);
  });
});

// GET /orders — list orders with filters
router.get('/', async (req, res) => {
  try {
    const supabase = getSupabase();
    const {
      status,
      payment_status,
      fulfillment,
      page = 1,
      per_page = 25,
      sort = 'created_at',
      order = 'desc'
    } = req.query;

    let query = supabase
      .from('orders')
      .select('*', { count: 'exact' });

    if (status) {
      if (status.includes(',')) {
        query = query.in('order_status', status.split(',').map(s => s.trim()));
      } else {
        query = query.eq('order_status', status);
      }
    }
    if (payment_status) query = query.eq('payment_status', payment_status);
    if (fulfillment) query = query.eq('fulfillment_method', fulfillment);

    // By default, hide unpaid orders (draft/pending payment) unless explicitly filtered
    const showAll = req.query.show_all === 'true';
    if (!showAll && !payment_status) {
      query = query.in('payment_status', ['confirmed', 'paid', 'settled']);
    }

    query = query
      .order(sort, { ascending: order === 'asc' })
      .range((page - 1) * per_page, page * per_page - 1);

    const { data: orders, error, count } = await query;
    if (error) throw error;

    // Fetch items for each order
    if (orders?.length) {
      const orderIds = orders.map(o => o.id);
      const { data: items } = await supabase
        .from('order_items')
        .select('*')
        .in('order_id', orderIds);

      const itemsByOrder = {};
      for (const item of (items || [])) {
        if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
        itemsByOrder[item.order_id].push(item);
      }

      // Fetch payment info
      const clientOrderIds = orders.map(o => o.client_order_id).filter(Boolean);
      const { data: payments } = await supabase
        .from('order_payments')
        .select('id, payment_status, amount, total_payment, qr_image_url, expired_at, paid_at')
        .in('provider_order_id', clientOrderIds.map(id => `pakasir_${id}`));

      const paymentByOrderId = {};
      for (const p of (payments || [])) {
        const clientId = p.provider_order_id?.replace('pakasir_', '');
        if (clientId) paymentByOrderId[clientId] = p;
      }

      for (const o of orders) {
        o.items = itemsByOrder[o.id] || [];
        o.payment = paymentByOrderId[o.client_order_id] || null;
      }
    }

    res.json({
      ok: true,
      data: orders || [],
      meta: {
        total: count || 0,
        page: Number(page),
        per_page: Number(per_page),
        pages: Math.ceil((count || 0) / per_page)
      }
    });
  } catch (error) {
    logger.error({ err: error }, '[dashboard] Failed to list orders');
    res.status(500).json({ ok: false, error: 'Failed to fetch orders' });
  }
});

// GET /orders/stats/summary — dashboard stats (MUST be before /:id)
router.get('/stats/summary', async (req, res) => {
  try {
    const supabase = getSupabase();
    const today = new Date().toISOString().split('T')[0];

    const [
      { count: totalToday },
      { count: pendingDelivery },
      { count: onTheWay },
      { count: completed }
    ] = await Promise.all([
      supabase.from('orders').select('*', { count: 'exact', head: true }).gte('created_at', today).in('payment_status', ['confirmed', 'paid', 'settled']),
      supabase.from('orders').select('*', { count: 'exact', head: true }).in('order_status', ['ready_to_submit', 'preparing', 'ready_for_pickup']).in('payment_status', ['confirmed', 'paid', 'settled']),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('order_status', 'on_the_way'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('order_status', 'completed').gte('created_at', today)
    ]);

    res.json({
      ok: true,
      data: {
        totalToday: totalToday || 0,
        pendingDelivery: pendingDelivery || 0,
        onTheWay: onTheWay || 0,
        completedToday: completed || 0
      }
    });
  } catch (error) {
    logger.error({ err: error }, '[dashboard] Failed to get stats');
    res.status(500).json({ ok: false, error: 'Failed to fetch stats' });
  }
});

// GET /orders/:id — single order detail
router.get('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Fetch items
    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', order.id);
    order.items = items || [];

    // Fetch payment
    if (order.client_order_id) {
      const { data: payments } = await supabase
        .from('order_payments')
        .select('*')
        .eq('provider_order_id', `pakasir_${order.client_order_id}`)
        .limit(1);
      order.payment = payments?.[0] || null;
    }

    res.json({ ok: true, data: order });
  } catch (error) {
    logger.error({ err: error }, '[dashboard] Failed to get order');
    res.status(500).json({ ok: false, error: 'Failed to fetch order' });
  }
});

// PATCH /orders/:id/status — update delivery status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const validStatuses = [
      'awaiting_payment', 'ready_to_submit', 'preparing',
      'ready_for_pickup', 'picked_up', 'on_the_way',
      'delivered', 'completed', 'cancelled'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: `Invalid status. Valid: ${validStatuses.join(', ')}` });
    }

    const supabase = getSupabase();
    const updates = {
      order_status: status,
      updated_at: new Date().toISOString()
    };
    if (notes) updates.notes = notes;

    // Note: picked_up_at, on_the_way_at, delivered_at columns not yet in DB
    // Status changes are tracked via updated_at for now

    const { data, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    logger.info({ orderId: req.params.id, status, updatedBy: req.user?.username }, '[dashboard] Order status updated');

    // Broadcast to SSE clients
    broadcastOrderUpdate(data);

    // Send WA notification to customer
    try {
      const { notifyCustomerStatus } = await import('../notifications/status.js');
      const notifResult = await notifyCustomerStatus(data, status);
      if (notifResult.ok) {
        logger.info('[dashboard] Customer notified: %s -> %s', req.params.id, status);
      }
    } catch (notifErr) {
      logger.warn('[dashboard] Customer notification error: %s', notifErr.message);
    }

    // Send feedback request when order is delivered
    if (status === 'delivered') {
      try {
        const { sendFeedbackRequest } = await import('../notifications/feedback.js');
        const fbResult = await sendFeedbackRequest(data);
        if (fbResult.ok) {
          logger.info('[dashboard] Feedback request sent for order %s', req.params.id);
        }
      } catch (fbErr) {
        logger.warn('[dashboard] Feedback request error: %s', fbErr.message);
      }
    }

    res.json({ ok: true, data });
  } catch (error) {
    logger.error({ err: error }, '[dashboard] Failed to update order status');
    res.status(500).json({ ok: false, error: 'Failed to update status' });
  }
});

// GET /orders/stats/summary — dashboard stats
export default router;
