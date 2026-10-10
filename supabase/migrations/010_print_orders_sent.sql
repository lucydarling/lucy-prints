-- 010: print_orders can be "sent" (delivered to the print partner's hotfolder)
-- and "error" (pfRouter moved it to _error). Adds when/where it was sent and
-- why it failed. Touches no data and no other table.
-- Approved by Kevin 2026-10-10.

ALTER TABLE print_orders DROP CONSTRAINT IF EXISTS print_orders_status_check;
ALTER TABLE print_orders ADD CONSTRAINT print_orders_status_check
  CHECK (status IN ('ready','held','refused','sent','error'));
ALTER TABLE print_orders
  ADD COLUMN IF NOT EXISTS sent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS destination  text CHECK (destination IN ('demo','live')),
  ADD COLUMN IF NOT EXISTS error_reason text,
  ADD COLUMN IF NOT EXISTS error_at     timestamptz;
