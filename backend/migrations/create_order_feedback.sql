-- Create order_feedback table for rating system
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.order_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES public.orders(id),
  client_order_id TEXT,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  message TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_feedback_phone_status ON public.order_feedback(customer_phone, status);
CREATE INDEX IF NOT EXISTS idx_feedback_order_id ON public.order_feedback(order_id);

-- Enable RLS
ALTER TABLE public.order_feedback ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access" ON public.order_feedback
  FOR ALL USING (true) WITH CHECK (true);
