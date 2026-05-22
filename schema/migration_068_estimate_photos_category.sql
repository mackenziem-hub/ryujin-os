-- ═══════════════════════════════════════════════════════════════
-- Migration 068 · estimate_photos.category
--
-- Adds a `category` column to estimate_photos so the admin upload
-- UI can label photos as Cover / Before / After / Damage / Material /
-- Inspection / Site / Other when attaching to an estimate. Previously
-- the only label-like field was the free-text `caption` plus the
-- `is_cover` boolean, which left no first-class spot for the
-- before/after distinction that proposals need.
--
-- TEXT (no CHECK enum) so we can evolve the list without a follow-up
-- migration. The convention codifies in the UI; downstream readers
-- (proposal-client.html, commercial-proposal.html) treat unknown
-- values as 'other'.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE estimate_photos
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_estimate_photos_estimate_category
  ON estimate_photos (estimate_id, category);
