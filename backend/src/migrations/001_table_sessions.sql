-- Table Sessions Migration
-- Tracks dine-in table sessions for multi-order bill grouping
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS table_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number INT NOT NULL,
  table_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'bill_requested', 'closed')),
  customer_phone TEXT,
  customer_name TEXT,
  orders JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  closed_by TEXT CHECK (closed_by IN ('customer', 'cashier', 'timeout'))
);

-- Index for fast lookup: find active session by table number
CREATE INDEX IF NOT EXISTS idx_table_sessions_active
  ON table_sessions (table_number) WHERE status = 'active';

-- Index for cleanup: find stale sessions
CREATE INDEX IF NOT EXISTS idx_table_sessions_updated
  ON table_sessions (updated_at) WHERE status = 'active';

-- RLS
ALTER TABLE table_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: service role can do everything
CREATE POLICY "service_role_all" ON table_sessions
  FOR ALL USING (true) WITH CHECK (true);
