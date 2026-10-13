-- 013: sessions remember "I don't want milestone reminders".
-- Applied 2026-10-13 after Kevin's review.
-- Adds one column to sessions. Existing rows get false; no data is changed,
-- and the birthdate is never touched by an opt-out.
-- Apply BEFORE deploying the opt-out code: the session routes write this column.
--   milestone_opt_out  true once the parent ticks the box (memory books only)

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS milestone_opt_out boolean NOT NULL DEFAULT false;
