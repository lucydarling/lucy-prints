-- Lucy Prints — Supabase Schema
-- Run this in the Supabase SQL editor to create all required tables and storage.
-- Last updated: 2026-03-13

-- ============================================================
-- Sessions — one per customer save
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT UNIQUE NOT NULL,          -- 24-char URL-safe token (magic link key)
  email       TEXT NOT NULL,
  baby_name   TEXT,
  baby_birthdate DATE,
  phone       TEXT,
  sms_opt_in  BOOLEAN DEFAULT FALSE,
  book_theme  TEXT NOT NULL,                 -- e.g. "little_artist"
  photo_count INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'active',         -- active | completed | expired
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- for inactivity-based expiration (2 years)
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);

-- ============================================================
-- Session Photos — one row per photo slot per session
-- ============================================================
CREATE TABLE IF NOT EXISTS session_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  slot_key      TEXT NOT NULL,               -- e.g. "month_3", "first_bath"
  storage_path  TEXT NOT NULL,               -- path in "photos" bucket
  custom_label  TEXT,                        -- for "My First ___" slots
  milestone_date DATE,                       -- optional date for personal records
  print_size    TEXT DEFAULT '4x4',          -- "3x3" | "4x4" | "4x6"
  status        TEXT DEFAULT 'cropped',      -- cropped | uploaded
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(session_id, slot_key)
);

CREATE INDEX IF NOT EXISTS idx_session_photos_session ON session_photos(session_id);

-- ============================================================
-- Session Extras — extra prints for blank pages
-- ============================================================
CREATE TABLE IF NOT EXISTS session_extras (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  extra_id      TEXT NOT NULL,               -- client-generated ID like "extra_1710000000_ab12c"
  print_size    TEXT DEFAULT '4x4',          -- "3x3" | "4x4" | "4x6"
  storage_path  TEXT NOT NULL,               -- path in "photos" bucket
  created_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(session_id, extra_id)
);

CREATE INDEX IF NOT EXISTS idx_session_extras_session ON session_extras(session_id);

-- ============================================================
-- Storage bucket
-- ============================================================
-- Create a PRIVATE bucket named "photos" in Supabase Dashboard > Storage.
-- Files stored at: {session_id}/{slot_key}.jpg
-- Extra prints at: {session_id}/extras/{extra_id}.jpg
--
-- RLS: No public access. All uploads go through the service_role key
-- via the /api/photos/upload route.
--
-- Signed URLs (for resume) are generated server-side with a 1-hour expiry.

-- ============================================================
-- Auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER session_photos_updated_at
  BEFORE UPDATE ON session_photos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
