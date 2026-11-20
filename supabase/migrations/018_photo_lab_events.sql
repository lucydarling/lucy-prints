-- 018: photo_lab_events — first-party usage events (ZIP downloads, entry source,
-- print-checkout funnel steps). The ZIP is built in the browser, so the server
-- never saw a download before this table.
-- Creates one new table and touches nothing else. Stores no personal data:
-- session id + event name + small allow-listed JSON. Test sessions are
-- filterable by joining sessions.email.

CREATE TABLE IF NOT EXISTS photo_lab_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event       text NOT NULL,
  props       jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photo_lab_events_event_created_idx ON photo_lab_events (event, created_at);
CREATE INDEX IF NOT EXISTS photo_lab_events_session_idx ON photo_lab_events (session_id);

-- Server-side only (service role). No policies: anon and authenticated get nothing.
ALTER TABLE photo_lab_events ENABLE ROW LEVEL SECURITY;
