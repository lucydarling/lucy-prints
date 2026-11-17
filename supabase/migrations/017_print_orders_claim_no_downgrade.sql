-- 017: one paid-order delivery at a time per Shopify order, and a print order
-- is never downgraded.
--
-- Why (2026-11-17 04:19 UTC, Shopify #60895): Shopify delivered orders/paid
-- twice about a second apart. The second delivery saw the first one's items as
-- "already printed", recorded `refused` with an unconditional upsert and sent the
-- refused alert. The first delivery's `ready` happened to land last; had it not,
-- a paid order would have been stuck at `refused`.
--
-- Changes (no data touched, no rows deleted):
--   * status 'processing': a row a delivery has claimed but not finished. The
--     webhook writes it before committing items (it used to write 'ready' there).
--     Nothing else reads it: delivery, reminders and the monitors filter on
--     explicit statuses.
--   * claim_id / claimed_at: which delivery is working on the order.
--   * claim_print_order(): insert-or-take the claim, atomically. A claim older
--     than p_stale_seconds (a crashed delivery) can be taken over.
--   * record_print_order(): the only write of a paid-order outcome. Refused,
--     held or processing never overwrite ready, sent or error; nothing overwrites
--     sent or error. Returns true only when the write took effect.
-- Service role only (RLS on print_orders has no policies; EXECUTE revoked from
-- anon/authenticated).

ALTER TABLE print_orders DROP CONSTRAINT IF EXISTS print_orders_status_check;
ALTER TABLE print_orders ADD CONSTRAINT print_orders_status_check
  CHECK (status IN ('processing','ready','held','refused','sent','error'));

ALTER TABLE print_orders
  ADD COLUMN IF NOT EXISTS claim_id   uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE OR REPLACE FUNCTION claim_print_order(p_shopify_order_id text, p_claim uuid, p_stale_seconds integer DEFAULT 300)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  INSERT INTO print_orders (shopify_order_id, status, claim_id, claimed_at)
  VALUES (p_shopify_order_id, 'processing', p_claim, now())
  ON CONFLICT (shopify_order_id) DO UPDATE
    SET claim_id = EXCLUDED.claim_id, claimed_at = EXCLUDED.claimed_at
    WHERE print_orders.claim_id IS NULL
       OR print_orders.claimed_at < now() - make_interval(secs => p_stale_seconds);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$$;

CREATE OR REPLACE FUNCTION release_print_order(p_shopify_order_id text, p_claim uuid)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE print_orders SET claim_id = NULL, claimed_at = NULL
  WHERE shopify_order_id = p_shopify_order_id AND claim_id = p_claim;
$$;

-- p: {shopify_order_id, shopify_order_name, session_id, status, reasons, warnings,
--     snapshot, external_id, print_count, round_id, paid_quantity, customer_email}
CREATE OR REPLACE FUNCTION record_print_order(p jsonb)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  INSERT INTO print_orders AS o (
    shopify_order_id, shopify_order_name, session_id, status, reasons, warnings, snapshot,
    external_id, print_count, round_id, paid_quantity, customer_email, test_mode, updated_at
  ) VALUES (
    p->>'shopify_order_id',
    p->>'shopify_order_name',
    NULLIF(p->>'session_id', '')::uuid,
    p->>'status',
    COALESCE(p->'reasons', '[]'::jsonb),
    COALESCE(p->'warnings', '[]'::jsonb),
    NULLIF(p->'snapshot', 'null'::jsonb),
    p->>'external_id',
    NULLIF(p->>'print_count', '')::integer,
    NULLIF(p->>'round_id', '')::uuid,
    NULLIF(p->>'paid_quantity', '')::integer,
    NULLIF(p->>'customer_email', ''),
    true,
    now()
  )
  ON CONFLICT (shopify_order_id) DO UPDATE SET
    shopify_order_name = EXCLUDED.shopify_order_name,
    session_id         = EXCLUDED.session_id,
    status             = EXCLUDED.status,
    reasons            = EXCLUDED.reasons,
    warnings           = EXCLUDED.warnings,
    snapshot           = EXCLUDED.snapshot,
    external_id        = EXCLUDED.external_id,
    print_count        = EXCLUDED.print_count,
    round_id           = EXCLUDED.round_id,
    paid_quantity      = EXCLUDED.paid_quantity,
    customer_email     = COALESCE(EXCLUDED.customer_email, o.customer_email),
    test_mode          = true,
    updated_at         = now()
  WHERE o.status NOT IN ('sent', 'error')
    AND NOT (o.status = 'ready' AND EXCLUDED.status <> 'ready');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$$;

REVOKE ALL ON FUNCTION claim_print_order(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_print_order(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_print_order(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_print_order(text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION release_print_order(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION record_print_order(jsonb) TO service_role;
