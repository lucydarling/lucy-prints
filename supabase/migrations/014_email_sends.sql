-- 014: email_sends — one row per customer email outcome, plus each alert to Kevin.
-- Approved by Kevin 2026-10-13. Creates one new table and touches nothing else.
-- Apply BEFORE deploying the recording code (if it's missing, the app logs
-- "[email-sends] insert failed" and still sends every email).
--
-- Why it exists: the retrieval emails logged their outcome only to Vercel logs,
-- which the Photo Lab monitor can't read. That is how the 2026-03 → 08-18
-- email outage ran silently. The monitor reads this table instead.
--
-- Never stored here: the address, the email body, or the resume token.
--   route               magic-link | my-books-email | print-order-received |
--                       print-order-held | print-order-shipped | alert
--   outcome             what happened (lookup-* = no email was attempted)
--   resend_id           Resend's id for a sent email (the delivery check reads it)
--   error_code          Resend's error name on a failed send, e.g. missing_api_key
--   recipient_hash      sha256 of the lowercased address
--   internal_recipient  the address is @lucydarling.com (tests, Kevin's alerts)
--   delivery_status     Resend's last_event, filled in by the daily monitor

CREATE TABLE IF NOT EXISTS email_sends (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  route               text NOT NULL,
  -- SET NULL so test cleanup can still delete sessions.
  session_id          uuid REFERENCES sessions(id) ON DELETE SET NULL,
  outcome             text NOT NULL CHECK (outcome IN ('sent', 'send-failed', 'lookup-miss', 'lookup-error', 'unexpected-error')),
  resend_id           text,
  error_code          text,
  recipient_hash      text,
  internal_recipient  boolean NOT NULL DEFAULT false,
  delivery_status     text,
  delivery_checked_at timestamptz
);

CREATE INDEX IF NOT EXISTS email_sends_created_idx ON email_sends (created_at);
CREATE INDEX IF NOT EXISTS email_sends_session_idx ON email_sends (session_id);

-- RLS on, no policies: default-deny for anon and authenticated. Only the
-- service_role key (our API routes, the monitor) bypasses RLS.
ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;
