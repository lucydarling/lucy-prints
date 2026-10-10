-- 009: keep print_orders.updated_at current, the same way sessions and
-- session_photos do (see 007_restore_updated_at_triggers.sql).
-- Reuses the existing public.update_updated_at_column() function (present in the
-- live database); touches no data and no other table.
-- NOT YET APPLIED (written 2026-10-09 for review).

DROP TRIGGER IF EXISTS print_orders_updated_at ON print_orders;
CREATE TRIGGER print_orders_updated_at
  BEFORE UPDATE ON print_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
