-- Lucy Prints — Formalize RLS lockdown + automate sessions.photo_count
-- Last updated: 2026-06-15
--
-- Two hardening changes:
--
-- 1. RLS deny-all policies (M1)
--    RLS is already ENABLED on all three tables, and with no policies the
--    default is "deny everything" — but an empty policy list reads as an
--    oversight rather than a decision. These explicit deny-all policies for
--    the `anon` and `authenticated` roles document the lockdown as intentional.
--    The app only ever touches these tables through the service_role key
--    (src/lib/supabase-server.ts), which BYPASSES RLS entirely, so the running
--    app is unaffected. There is no browser/anon path to this data by design —
--    all reads go through API routes that mint short-lived signed URLs.
--
-- 2. sessions.photo_count trigger (M2)
--    photo_count was recomputed by the /api/photos/upload route on every upload
--    (count rows, then write back). That is racy under concurrent uploads and
--    silently drifts if a row is ever inserted/deleted outside that route.
--    A trigger on session_photos makes the count a property of the data itself.
--
--    DECISION — extras do NOT count toward photo_count. photo_count reflects the
--    48 fixed book slots only (session_photos), matching the prior route behavior
--    (it counted session_photos rows). Extra prints (session_extras) are a
--    separate add-on concept and are intentionally excluded.

-- ============================================================
-- 1. RLS deny-all policies (explicit lockdown)
-- ============================================================
-- FOR ALL + USING (false) + WITH CHECK (false) denies SELECT/INSERT/UPDATE/DELETE
-- for the named role. service_role is exempt from RLS and is unaffected.

-- sessions
DROP POLICY IF EXISTS "deny_all_anon" ON sessions;
DROP POLICY IF EXISTS "deny_all_authenticated" ON sessions;
CREATE POLICY "deny_all_anon" ON sessions
  FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "deny_all_authenticated" ON sessions
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- session_photos
DROP POLICY IF EXISTS "deny_all_anon" ON session_photos;
DROP POLICY IF EXISTS "deny_all_authenticated" ON session_photos;
CREATE POLICY "deny_all_anon" ON session_photos
  FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "deny_all_authenticated" ON session_photos
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- session_extras
DROP POLICY IF EXISTS "deny_all_anon" ON session_extras;
DROP POLICY IF EXISTS "deny_all_authenticated" ON session_extras;
CREATE POLICY "deny_all_anon" ON session_extras
  FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "deny_all_authenticated" ON session_extras
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ============================================================
-- 2. photo_count trigger — keep sessions.photo_count in sync with session_photos
-- ============================================================
-- Recompute-from-truth (not increment/decrement) so the value is always exactly
-- the row count, idempotent, and immune to ON CONFLICT upsert edge cases. Each
-- statement recomputes from the table, so concurrent uploads can't drift the value.
CREATE OR REPLACE FUNCTION sync_session_photo_count()
RETURNS TRIGGER AS $$
DECLARE
  target_session_id UUID;
BEGIN
  -- DELETE exposes the old row; INSERT/UPDATE expose the new row.
  IF (TG_OP = 'DELETE') THEN
    target_session_id := OLD.session_id;
  ELSE
    target_session_id := NEW.session_id;
  END IF;

  UPDATE sessions
    SET photo_count = (
      SELECT COUNT(*) FROM session_photos WHERE session_id = target_session_id
    )
    WHERE id = target_session_id;

  -- AFTER trigger: return value is ignored.
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS session_photos_count_sync ON session_photos;
CREATE TRIGGER session_photos_count_sync
  AFTER INSERT OR DELETE ON session_photos
  FOR EACH ROW EXECUTE FUNCTION sync_session_photo_count();

-- One-time backfill so existing rows match the trigger's invariant going forward.
UPDATE sessions s
  SET photo_count = (
    SELECT COUNT(*) FROM session_photos p WHERE p.session_id = s.id
  );
