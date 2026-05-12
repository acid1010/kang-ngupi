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

  // Check for existing active session for this table + phone combo
  let existing = null;
  if (customerPhone) {
    const { data, error: findError } = await supabase
      .from('table_sessions')
      .select('*')
      .eq('table_number', tableNumber)
      .eq('customer_phone', customerPhone)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (findError && findError.code !== 'PGRST116') {
      logger.error('[table-session] Find error: %s', findError.message);
      throw findError;
    }
    existing = data || null;
  } else {
    // No phone — fallback to table-only lookup
    const { data, error: findError } = await supabase
      .from('table_sessions')
      .select('*')
      .eq('table_number', tableNumber)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (findError && findError.code !== 'PGRST116') {
      logger.error('[table-session] Find error: %s', findError.message);
      throw findError;
    }
    existing = data || null;
  }

  if (existing) {
    // Same table, same phone → continue session
    if (!customerPhone || !existing.customer_phone || existing.customer_phone === customerPhone) {
      logger.info('[table-session] Found active session %s for %s (phone: %s)', existing.id, tableLabel, customerPhone);
      // Update customer info if not set yet
      if (!existing.customer_phone && customerPhone) {
        await supabase
          .from('table_sessions')
          .update({ customer_phone: customerPhone, customer_name: customerName, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      }
      return existing;
    }
    // Different phone on same table → separate bill, create new session (don't close old)
    logger.info('[table-session] Different customer %s at %s (existing: %s) — creating separate session', customerPhone, tableLabel, existing.customer_phone);
    // Fall through to create new session
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
 * @param {'customer' | 'cashier' | 'timeout' | 'new_customer'} closedBy
 * @param {string} [customerPhone] - if provided, only close session for this phone
 */
export async function closeTableSession(tableNumber, closedBy = 'cashier', customerPhone = null) {
  const supabase = getSupabase();

  let query = supabase
    .from('table_sessions')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: closedBy,
      updated_at: new Date().toISOString()
    })
    .eq('table_number', tableNumber)
    .in('status', ['active', 'bill_requested']);

  if (customerPhone) {
    query = query.eq('customer_phone', customerPhone);
  }

  const { data, error } = await query.select().single();

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
