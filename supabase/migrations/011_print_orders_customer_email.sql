-- 011: print_orders remembers who to email and which customer emails were sent.
-- NOT YET APPLIED (written 2026-10-11 for Kevin's review).
-- Adds four nullable columns to print_orders. Touches no data and no other table.
-- Apply BEFORE deploying the step-4 code: the webhook's upsert writes customer_email.
--   customer_email         the Shopify order's email, saved when the order is recorded
--   received_email_sent_at "Order received" email sent (set once; stops a webhook retry re-sending)
--   held_email_sent_at     "We need photos" email sent (same)
--   shipped_email_sent_at  reserved for the shipped email; unused until tracking arrives

ALTER TABLE print_orders
  ADD COLUMN IF NOT EXISTS customer_email         text,
  ADD COLUMN IF NOT EXISTS received_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS held_email_sent_at     timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_email_sent_at  timestamptz;
