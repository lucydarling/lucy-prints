-- Lucy Prints — Add klaviyo_sync_status for real-consent verification tracking
-- Run this in the Supabase SQL editor.
-- Last updated: 2026-07-06
--
-- Backfills migration history for a column that was already added directly to
-- production via the Supabase dashboard/API. The klaviyo_sync_status object
-- records the outcome of the post-signup Klaviyo consent check (per-channel
-- email_subscribed / sms_subscribed and the resolved consent_status), so the
-- app persists *verified* marketing consent instead of trusting the
-- job-enqueue. See src/lib/klaviyo.ts and src/app/api/sessions/route.ts.
--
-- IF NOT EXISTS makes this idempotent: a no-op against the already-migrated
-- production database, and correct for a fresh environment. The column
-- definition (jsonb, NOT NULL, default '{}') matches the live schema exactly.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS klaviyo_sync_status jsonb NOT NULL DEFAULT '{}'::jsonb;
