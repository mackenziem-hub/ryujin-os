-- Migration 020 — Caption overrides (approval flow)
--
-- Adds caption_overrides jsonb to marketing_clips. Keyed by brand_id —
-- when present, the publisher uses these approved captions instead of
-- generating fresh ones at fan-out time.
--
-- Format:  { "<brand_id>": "approved caption text" }
--
-- Idempotent.

ALTER TABLE marketing_clips
  ADD COLUMN IF NOT EXISTS caption_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN marketing_clips.caption_overrides IS
  'Per-brand approved caption from the capture-page review flow. Publisher reads this first; falls back to AI auto-gen, then brand-template fallback.';
