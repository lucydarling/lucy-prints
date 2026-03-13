-- Lucy Prints — Add last_activity_at for inactivity-based session expiration
-- Run this in the Supabase SQL editor if the sessions table already exists.
-- Last updated: 2026-03-13
--
-- Why: The app is a companion for filling out a Baby's First Year memory book,
-- spanning months to years. Creation-date-based expiration (90 days) was too
-- aggressive. Now we expire after 2 years of INACTIVITY — as long as mom keeps
-- coming back, her session stays alive forever.

-- Add the column (defaults to created_at for existing rows)
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- Backfill existing rows: use updated_at as best approximation of last activity
UPDATE sessions
  SET last_activity_at = COALESCE(updated_at, created_at)
  WHERE last_activity_at IS NULL;

-- Set NOT NULL with default for future rows
ALTER TABLE sessions
  ALTER COLUMN last_activity_at SET DEFAULT NOW(),
  ALTER COLUMN last_activity_at SET NOT NULL;

-- Index for cleanup queries (find stale sessions)
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at);
