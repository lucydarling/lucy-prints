-- Lucy Prints — Add book details (notes) and details mode to sessions
-- Run this in the Supabase SQL editor.
-- Last updated: 2026-03-13
--
-- Supports the "Book Details" feature: optional text prompts alongside photos.
-- Notes are stored as a JSONB object keyed by slotKey → promptKey → value.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS notes JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS details_mode BOOLEAN DEFAULT FALSE;
