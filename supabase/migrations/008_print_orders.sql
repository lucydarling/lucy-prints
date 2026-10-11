-- 008: print_orders — one row per paid Shopify order that is a print order.
-- Records ready / held / refused, and the exact photos frozen at payment.
-- NOT YET APPLIED to the production project (written 2026-10-09 for review).
-- Creates one new table and touches nothing else. Nothing is delivered to a
-- print partner from this table in this step.

CREATE TABLE IF NOT EXISTS print_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_order_id   text NOT NULL UNIQUE,
  shopify_order_name text,
  session_id         uuid REFERENCES sessions(id),
  status             text NOT NULL CHECK (status IN ('ready', 'held', 'refused')),
  reasons            jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The rows (slot, storage path, size) frozen when the order was paid. Every build/retry reads this.
  snapshot           jsonb,
  external_id        text,
  print_count        integer,
  test_mode          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS print_orders_session_idx ON print_orders (session_id);

-- RLS on, no policies: default-deny for anon and authenticated. Only the
-- service_role key (our API routes) bypasses RLS and can read or write it.
ALTER TABLE print_orders ENABLE ROW LEVEL SECURITY;
