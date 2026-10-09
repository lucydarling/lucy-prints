-- 008: print_orders — one row per paid Shopify order that is a print order,
-- recording whether it is ready to print, held (a paid slot is empty), or refused.
-- NOT YET APPLIED to the production project (written 2026-10-09 for review).
-- Nothing is delivered to a print partner from this table in step 2.

CREATE TABLE IF NOT EXISTS print_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_order_id  text NOT NULL UNIQUE,
  shopify_order_name text,
  session_id        uuid REFERENCES sessions(id),
  status            text NOT NULL CHECK (status IN ('ready', 'held', 'refused')),
  reasons           jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings          jsonb NOT NULL DEFAULT '[]'::jsonb,
  external_id       text,
  print_count       integer,
  test_mode         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS print_orders_session_idx ON print_orders (session_id);

-- Same lockdown as the other tables: only the service_role key (API routes) touches it.
ALTER TABLE print_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_all_anon" ON print_orders;
DROP POLICY IF EXISTS "deny_all_authenticated" ON print_orders;
CREATE POLICY "deny_all_anon" ON print_orders FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "deny_all_authenticated" ON print_orders FOR ALL TO authenticated USING (false) WITH CHECK (false);
