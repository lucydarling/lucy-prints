-- 015: print_orders.stalled_alerted_at — when Kevin was told a "sent" order was
-- still sitting in the hotfolder (pfRouter had not picked it up). Set once, by a
-- guarded update, so the alert goes out once per order.
-- Adds one nullable column; touches no data and no other table.
-- Apply BEFORE deploying the stalled check (it selects this column).

ALTER TABLE print_orders
  ADD COLUMN IF NOT EXISTS stalled_alerted_at timestamptz;
