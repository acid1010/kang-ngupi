# Table Session — Multi-Order Bill Tracking

## Overview

Enables dine-in customers to place multiple orders for the same table, each pushed as a separate Pawoon transaction but tracked under one "table session" in Supabase. The cashier sees all orders tagged with the same table number.

## Architecture

```
Customer scans QR (Meja 1) → WhatsApp bot
    ↓
Bot confirms order → Backend bridge
    ↓
Backend: getOrCreateTableSession(tableNumber, customerPhone)
    ↓
pushOrderToPawoon() with "Table No: Meja 1" + session context
    ↓
Update session: add order to session.orders[], increment total
    ↓
Customer orders again → same session (until closed)
```

## Session Lifecycle

- **Created**: First dine-in order for a table with no active session
- **Active**: Accepts new orders, tracks running total
- **Bill Requested**: Customer says "bayar" / "bill" — cashier notified
- **Closed**: Cashier closes from dashboard, customer confirms payment, or 3hr timeout

---

## 1. Supabase Migration

Run this SQL in your Supabase SQL editor:

```sql
-- Table Sessions: tracks one group of customers at a table
CREATE TABLE IF NOT EXISTS table_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number INT NOT NULL,
  table_label TEXT NOT NULL, -- e.g. "Meja 1"
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'bill_requested', 'closed')),
  customer_phone TEXT,
  customer_name TEXT,
  orders JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of {order_id, pawoon_order_id, amount, pushed_at}
  total_amount INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  closed_by TEXT CHECK (closed_by IN ('customer', 'cashier', 'timeout'))
);

-- Index for fast lookup: find active session by table number
CREATE INDEX idx_table_sessions_active ON table_sessions (table_number) WHERE status = 'active';

-- Index for cleanup: find stale sessions
CREATE INDEX idx_table_sessions_updated ON table_sessions (updated_at) WHERE status = 'active';

-- RLS (optional, if you use RLS)
ALTER TABLE table_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: service role can do everything
CREATE POLICY "service_role_all" ON table_sessions
  FOR ALL USING (true) WITH CHECK (true);
```

---

## 2. New File: `backend/src/table-session.js`

```javascript
/**
 * Table Session Manager
 * Tracks dine-in table sessions for multi-order bill grouping.
 * Each session = one group of customers at a table.
 * Multiple orders can be pushed to Pawoon under the same session.
 */

import { getSupabase } from './supabase.js';
import logger from './lib/logger.js';

const SESSION_TIMEOUT_HOURS = 3;

/**
 * Get or create an active table session.
 * If an active session exists for the table, return it.
 * Otherwise, create a new one.
 */
export async function getOrCreateTableSession(tableNumber, { customerPhone, customerName } = {}) {
  const supabase = getSupabase();
  const tableLabel = `Meja ${tableNumber}`;

  // Check for existing active session
  const { data: existing, error: findError } = await supabase
    .from('table_sessions')
    .select('*')
    .eq('table_number', tableNumber)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (findError && findError.code !== 'PGRST116') {
    // PGRST116 = no rows found (expected when no active session)
    logger.error('[table-session] Find error: %s', findError.message);
    throw findError;
  }

  if (existing) {
    logger.info('[table-session] Found active session %s for %s', existing.id, tableLabel);
    // Update customer info if not set yet
    if (!existing.customer_phone && customerPhone) {
      await supabase
        .from('table_sessions')
        .update({ customer_phone: customerPhone, customer_name: customerName, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    return existing;
  }

  // Create new session
  const { data: newSession, error: createError } = await supabase
    .from('table_sessions')
    .insert({
      table_number: tableNumber,
      table_label: tableLabel,
      status: 'active',
      customer_phone: customerPhone || null,
      customer_name: customerName || null,
      orders: [],
      total_amount: 0
    })
    .select()
    .single();

  if (createError) {
    logger.error('[table-session] Create error: %s', createError.message);
    throw createError;
  }

  logger.info('[table-session] Created new session %s for %s', newSession.id, tableLabel);
  return newSession;
}

/**
 * Add an order to an existing table session.
 * Called after pushOrderToPawoon succeeds.
 */
export async function addOrderToSession(sessionId, { orderId, pawoonOrderId, amount }) {
  const supabase = getSupabase();

  // Fetch current session
  const { data: session, error: fetchError } = await supabase
    .from('table_sessions')
    .select('orders, total_amount')
    .eq('id', sessionId)
    .single();

  if (fetchError) {
    logger.error('[table-session] Fetch for update error: %s', fetchError.message);
    throw fetchError;
  }

  const updatedOrders = [
    ...(session.orders || []),
    {
      order_id: orderId,
      pawoon_order_id: pawoonOrderId,
      amount: amount,
      pushed_at: new Date().toISOString()
    }
  ];

  const { error: updateError } = await supabase
    .from('table_sessions')
    .update({
      orders: updatedOrders,
      total_amount: (session.total_amount || 0) + (amount || 0),
      updated_at: new Date().toISOString()
    })
    .eq('id', sessionId);

  if (updateError) {
    logger.error('[table-session] Update error: %s', updateError.message);
    throw updateError;
  }

  logger.info('[table-session] Added order %s to session %s (total: %d)', orderId, sessionId, (session.total_amount || 0) + (amount || 0));
}

/**
 * Request the bill — customer says "bayar"
 */
export async function requestBill(tableNumber) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('table_sessions')
    .update({
      status: 'bill_requested',
      updated_at: new Date().toISOString()
    })
    .eq('table_number', tableNumber)
    .eq('status', 'active')
    .select()
    .single();

  if (error) {
    logger.error('[table-session] Request bill error: %s', error.message);
    return null;
  }

  logger.info('[table-session] Bill requested for Meja %d, session %s', tableNumber, data.id);
  return data;
}

/**
 * Close a table session.
 * @param {number} tableNumber
 * @param {'customer' | 'cashier' | 'timeout'} closedBy
 */
export async function closeTableSession(tableNumber, closedBy = 'cashier') {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('table_sessions')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: closedBy,
      updated_at: new Date().toISOString()
    })
    .eq('table_number', tableNumber)
    .in('status', ['active', 'bill_requested'])
    .select()
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('[table-session] Close error: %s', error.message);
    return null;
  }

  if (data) {
    logger.info('[table-session] Closed session %s for Meja %d by %s', data.id, tableNumber, closedBy);
  }
  return data;
}

/**
 * Close a session by session ID (for dashboard use).
 */
export async function closeTableSessionById(sessionId, closedBy = 'cashier') {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('table_sessions')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: closedBy,
      updated_at: new Date().toISOString()
    })
    .eq('id', sessionId)
    .in('status', ['active', 'bill_requested'])
    .select()
    .single();

  if (error) {
    logger.error('[table-session] Close by ID error: %s', error.message);
    return null;
  }

  return data;
}

/**
 * Get active session for a table (read-only).
 */
export async function getActiveSession(tableNumber) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('table_sessions')
    .select('*')
    .eq('table_number', tableNumber)
    .in('status', ['active', 'bill_requested'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('[table-session] Get active error: %s', error.message);
    return null;
  }

  return data || null;
}

/**
 * Get all active sessions (for dashboard).
 */
export async function getAllActiveSessions() {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('table_sessions')
    .select('*')
    .in('status', ['active', 'bill_requested'])
    .order('table_number', { ascending: true });

  if (error) {
    logger.error('[table-session] Get all active error: %s', error.message);
    return [];
  }

  return data || [];
}

/**
 * Auto-close stale sessions (run from scheduler).
 * Closes sessions with no activity for SESSION_TIMEOUT_HOURS.
 */
export async function closeStaleTableSessions() {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - SESSION_TIMEOUT_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('table_sessions')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: 'timeout',
      updated_at: new Date().toISOString()
    })
    .eq('status', 'active')
    .lt('updated_at', cutoff)
    .select();

  if (error) {
    logger.error('[table-session] Stale cleanup error: %s', error.message);
    return [];
  }

  if (data?.length > 0) {
    logger.info('[table-session] Auto-closed %d stale sessions', data.length);
  }

  return data || [];
}
```

---

## 3. Modified `backend/src/integrations/pawoon.js`

Add this import at the top of the existing file:

```javascript
import { getOrCreateTableSession, addOrderToSession } from '../table-session.js';
```

Then replace the `pushOrderToPawoon` export with this updated version that wraps the session logic:

```javascript
/**
 * Push order to Pawoon with table session tracking for dine-in.
 * This is the main entry point — call this instead of the raw push.
 */
export async function pushOrderToPawoonWithSession(order, items, payment) {
  // For non-dine-in orders, just push directly
  if (order.fulfillment_method !== 'dine_in') {
    return pushOrderToPawoon(order, items, payment);
  }

  const tableNum = order.table_number || order.tableNumber || null;
  if (!tableNum) {
    // No table number, push without session
    return pushOrderToPawoon(order, items, payment);
  }

  try {
    // Get or create table session
    const session = await getOrCreateTableSession(tableNum, {
      customerPhone: order.customer_phone_snapshot,
      customerName: order.customer_name_snapshot
    });

    // Push to Pawoon (existing logic)
    const result = await pushOrderToPawoon(order, items, payment);

    if (result.ok) {
      // Track this order in the session
      const orderAmount = items.reduce((sum, i) => sum + ((Number(i.price) || 0) * (Number(i.qty) || 1)), 0);
      await addOrderToSession(session.id, {
        orderId: order.client_order_id,
        pawoonOrderId: result.pawoonOrderId,
        amount: orderAmount
      });

      // Attach session info to result
      result.tableSession = {
        sessionId: session.id,
        tableLabel: session.table_label,
        orderCount: (session.orders?.length || 0) + 1,
        runningTotal: (session.total_amount || 0) + orderAmount
      };
    }

    return result;
  } catch (err) {
    // If session tracking fails, still push the order
    logger.warn('[pawoon] Table session error (non-fatal): %s', err.message);
    return pushOrderToPawoon(order, items, payment);
  }
}
```

Keep the original `pushOrderToPawoon` function as-is (it still does the actual Pawoon API call). The new `pushOrderToPawoonWithSession` wraps it with session logic.

---

## 4. Dashboard API Endpoints

Add to your dashboard routes (e.g., `backend/src/dashboard/routes.js` or wherever you define Express routes):

```javascript
import {
  getAllActiveSessions,
  closeTableSessionById,
  closeTableSession,
  getActiveSession
} from '../table-session.js';

// GET /api/dashboard/table-sessions — list all active table sessions
router.get('/table-sessions', async (req, res) => {
  try {
    const sessions = await getAllActiveSessions();
    res.json({ ok: true, data: sessions });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/dashboard/table-sessions/:tableNumber — get session for specific table
router.get('/table-sessions/:tableNumber', async (req, res) => {
  try {
    const session = await getActiveSession(Number(req.params.tableNumber));
    res.json({ ok: true, data: session });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/dashboard/table-sessions/:id/close — cashier closes a session
router.post('/table-sessions/:id/close', async (req, res) => {
  try {
    const session = await closeTableSessionById(req.params.id, 'cashier');
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found or already closed' });
    }
    res.json({ ok: true, data: session });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

---

## 5. Scheduler: Auto-Close Stale Sessions

Add to your existing scheduler (e.g., `backend/src/scheduler/` cron jobs):

```javascript
import { closeStaleTableSessions } from '../table-session.js';

// Run every 30 minutes
// Add to your existing cron setup (PM2 cron or node-cron)
export async function runTableSessionCleanup() {
  const closed = await closeStaleTableSessions();
  if (closed.length > 0) {
    logger.info('[scheduler] Closed %d stale table sessions', closed.length);
  }
}
```

If using `node-cron`:
```javascript
import cron from 'node-cron';
cron.schedule('*/30 * * * *', runTableSessionCleanup);
```

---

## 6. WhatsApp Bot Integration

When the bot detects a "bayar" / "bill" / "minta bill" intent from a dine-in customer:

```javascript
import { requestBill, getActiveSession } from '../table-session.js';

// In your bot message handler / agent tool:
async function handleBillRequest(tableNumber, customerPhone) {
  const session = await requestBill(tableNumber);

  if (!session) {
    return 'Tidak ada pesanan aktif untuk meja ini.';
  }

  // Notify cashier (via your existing notification system)
  // e.g., send WhatsApp to admin/cashier number
  const orderCount = session.orders?.length || 0;
  const total = session.total_amount || 0;

  // Return message for customer
  return `Bill untuk ${session.table_label} sudah diminta ke kasir.\n\n` +
    `Total pesanan: ${orderCount} order\n` +
    `Total: Rp${total.toLocaleString('id-ID')}\n\n` +
    `Silakan menuju kasir untuk pembayaran.`;
}
```

---

## 7. Agent Instructions Update

Add this to your `AGENTS.md` or order handling rules:

```markdown
## Table Session Rules (Dine-In)

- When fulfillment is `dine_in` and table number is known, the backend automatically tracks a table session
- Multiple orders for the same table are pushed as SEPARATE Pawoon transactions (cashier sees each one)
- All orders are grouped under one `table_session` in Supabase for tracking
- When customer says "bayar" / "bill" / "minta bill":
  1. Call requestBill(tableNumber)
  2. Inform customer their bill has been sent to cashier
  3. Do NOT close the session — cashier does that after payment
- A table session auto-closes after 3 hours of inactivity
- Do NOT create a new session if one is already active for the table
```

---

## 8. Integration Points Summary

| Caller | Function | When |
|--------|----------|------|
| Bridge (order confirmed + paid) | `pushOrderToPawoonWithSession()` | Replace existing `pushOrderToPawoon()` call for dine-in |
| Bot (customer says "bayar") | `requestBill(tableNumber)` | Notify cashier, inform customer |
| Dashboard (cashier clicks close) | `closeTableSessionById(id)` | After payment collected |
| Scheduler (every 30min) | `closeStaleTableSessions()` | Cleanup abandoned sessions |

---

## File Placement

```
backend/src/
├── table-session.js          ← NEW (core module)
├── integrations/
│   └── pawoon.js             ← MODIFIED (add pushOrderToPawoonWithSession)
├── dashboard/
│   └── routes.js             ← MODIFIED (add table-session endpoints)
├── scheduler/
│   └── ...                   ← MODIFIED (add stale session cleanup)
└── supabase.js               ← NO CHANGES
```

## Migration Checklist

1. [ ] Run the SQL migration in Supabase
2. [ ] Create `backend/src/table-session.js`
3. [ ] Add `pushOrderToPawoonWithSession` to `pawoon.js`
4. [ ] Update bridge code to call `pushOrderToPawoonWithSession` instead of `pushOrderToPawoon` for dine-in
5. [ ] Add dashboard routes for table sessions
6. [ ] Add scheduler cleanup job
7. [ ] Update bot/agent to handle "bayar" intent with `requestBill()`
8. [ ] Test: place 2 orders for same table, verify both appear in Pawoon + grouped in Supabase
