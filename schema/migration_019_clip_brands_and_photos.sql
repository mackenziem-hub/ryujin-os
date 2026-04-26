-- Ryujin OS · Migration 019 · Multi-brand clips + photo support
--
-- 1. marketing_clip_brands: a clip can target multiple brands at once
--    (Plus Ultra, Mackenzie, Roofing Fundamentals — all three connected
--    accounts get their own scheduled_post when the clip publishes).
-- 2. marketing_clips.is_photo: photos skip the Whisper/ffmpeg renderer
--    entirely and post the source image directly.
--
-- All statements idempotent. Apply via:
--   node scripts/run-migration.mjs schema/migration_019_clip_brands_and_photos.sql

-- ─── Multi-brand link ─────────────────────────────────────────────────
create table if not exists marketing_clip_brands (
  clip_id uuid not null references marketing_clips(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (clip_id, brand_id)
);

create index if not exists idx_clip_brands_brand on marketing_clip_brands(brand_id);

alter table marketing_clip_brands enable row level security;
-- Service role bypasses RLS; user-facing access enforced in API layer.

-- ─── Photo support ────────────────────────────────────────────────────
alter table marketing_clips
  add column if not exists is_photo boolean not null default false;

-- Photos can have status='ready' the instant upload finishes, so we
-- relax the NOT NULL constraints that the renderer fills (transcript,
-- emphasis_indices, rendered_duration). Those are already nullable in
-- the base schema (migration 010) — kept here as a documented assumption.
