-- ============================================================
-- 006: Extra print orientation
-- ============================================================
-- Extra prints are cropped portrait by default, and the customer can flip a
-- rectangular one (4x3, 4x6) to landscape. The choice has to survive a
-- resume, so it lives alongside the print size.
--
-- Existing rows predate the option and were all cropped portrait, so the
-- default backfills them correctly.

ALTER TABLE session_extras
  ADD COLUMN IF NOT EXISTS orientation TEXT NOT NULL DEFAULT 'portrait';

ALTER TABLE session_extras
  DROP CONSTRAINT IF EXISTS session_extras_orientation_check;

ALTER TABLE session_extras
  ADD CONSTRAINT session_extras_orientation_check
  CHECK (orientation IN ('portrait', 'landscape'));

COMMENT ON COLUMN session_extras.orientation IS
  'portrait (default) | landscape — only meaningful for 4x3 and 4x6 prints';
