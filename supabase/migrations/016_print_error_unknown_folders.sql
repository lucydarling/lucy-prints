-- 016: print_error_unknown_folders — one row per folder found in a hotfolder's _error/
-- that matches no print_orders row (e.g. a folder dropped in by hand that pfRouter rejected).
-- The row is what makes the "unknown order in _error" alert go out once per folder.
-- Creates one new table and touches nothing else.
-- Apply BEFORE deploying the check that writes it (if it's missing, the unknown-folder
-- part fails, is logged, and the cron answers 500; the sent-order _error check still runs).

CREATE TABLE IF NOT EXISTS print_error_unknown_folders (
  destination    text NOT NULL CHECK (destination IN ('demo', 'live')),
  folder         text NOT NULL,
  reason         text,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (destination, folder)
);

-- Server-side only (service role). No policies: anon and authenticated get nothing.
ALTER TABLE print_error_unknown_folders ENABLE ROW LEVEL SECURITY;
