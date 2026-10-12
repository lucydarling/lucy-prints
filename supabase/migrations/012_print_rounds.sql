-- 012: print in rounds. NOT YET APPLIED (written 2026-10-11 for Kevin's review).
-- Adds three tables and two nullable columns on print_orders. Deletes nothing,
-- touches no existing rows, no cascades. All new tables: RLS on, no policies
-- (service_role only), like print_orders.
--
--   print_rounds       the exact list of what one checkout click will print,
--                      recorded BEFORE the customer pays. The cart carries its id.
--   print_order_items  one row per slot/extra actually printed by a ready order.
--                      A row existing = that slot/extra is printed (and locked).
--                      UNIQUE key blocks printing the same thing twice.
--   print_reprints     a customer's replacement crop for an already-printed slot,
--                      pending until the next order includes it.

-- session_extras.quantity exists in production but in no earlier migration.
ALTER TABLE session_extras ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS print_reprints (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES sessions(id),
  slot_key          text NOT NULL,
  storage_path      text NOT NULL,             -- <session>/reprints/<slot>-<n>.<ext>; never the printed copy
  print_size        text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','included')),
  included_in_order uuid,                      -- print_orders.id once a ready order includes it
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS print_reprints_one_pending
  ON print_reprints (session_id, slot_key) WHERE status = 'pending';
ALTER TABLE print_reprints ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS print_rounds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES sessions(id),
  -- {"slots":[{"slot_key","print_size"}], "extras":[{"extra_id","quantity","print_size"}],
  --  "reprints":[{"reprint_id","slot_key"}]}
  items        jsonb NOT NULL,
  -- prints per Shopify variant id, e.g. {"48078680424673": 14}. The paid line items must match exactly.
  quantities   jsonb NOT NULL,
  total_prints integer NOT NULL CHECK (total_prints >= 1),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','expired')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS print_rounds_session_idx ON print_rounds (session_id);
ALTER TABLE print_rounds ENABLE ROW LEVEL SECURITY;

ALTER TABLE print_orders
  ADD COLUMN IF NOT EXISTS round_id      uuid REFERENCES print_rounds(id),
  ADD COLUMN IF NOT EXISTS paid_quantity integer;

CREATE TABLE IF NOT EXISTS print_order_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  print_order_id uuid NOT NULL REFERENCES print_orders(id),
  session_id     uuid NOT NULL REFERENCES sessions(id),
  kind           text NOT NULL CHECK (kind IN ('slot','extra')),
  item_key       text NOT NULL,                -- slot_key or extra_id
  generation     integer NOT NULL DEFAULT 1,   -- 1 = first print; 2+ = paid reprints (slots only)
  quantity       integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  print_size     text,
  frozen_path    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, kind, item_key, generation)
);
CREATE INDEX IF NOT EXISTS print_order_items_order_idx ON print_order_items (print_order_id);
ALTER TABLE print_order_items ENABLE ROW LEVEL SECURITY;
