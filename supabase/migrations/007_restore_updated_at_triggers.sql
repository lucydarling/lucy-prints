-- 007: restore the updated_at triggers on sessions and session_photos.
--
-- Migration 001 defined them, but the live database only had the function:
-- session_photos.updated_at (and sessions.updated_at) never changed after
-- insert. Recreates function + triggers; touches no data.

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sessions_updated_at ON sessions;
CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS session_photos_updated_at ON session_photos;
CREATE TRIGGER session_photos_updated_at
  BEFORE UPDATE ON session_photos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
