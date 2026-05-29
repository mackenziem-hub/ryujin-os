-- Ryujin OS · Migration 074 · Generator Scheduler
-- Adds the media-pool catalog + generator metadata on marketing_clips so the
-- weekly Generator agent can pick photos from the existing media corpus,
-- draft a Claude caption, and insert a draft clip for Mac/Cat approval.
--
-- Architecture:
--   media_pool          one row per post-eligible visual across all 4 sources
--                       (project_files, CompanyCam archive, Media folder,
--                       estimate_photos). Dedup by content_hash. Pair links
--                       via pair_partner_id for before/after couples.
--   generator_runs      audit row per weekly fire (when, how many drafts
--                       inserted, low-inventory warnings).
--   marketing_clips     three additive columns: source_kind ('upload' vs
--                       'generator'), generator_run_id (groups a run's
--                       drafts), caption_suggestion (Claude draft pre-
--                       approval; the existing caption_overrides remains
--                       the publish-gate).
--
-- Run in Supabase SQL editor. All statements idempotent.

-- ─── MEDIA POOL ────────────────────────────────────────────────────────────
create table if not exists media_pool (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,

  -- Provenance
  source_bucket text not null check (source_bucket in (
    'project_files', 'companycam_archive', 'media_folder', 'estimate_photos'
  )),
  source_id text,                                  -- foreign id in originating table or path
  project_id uuid,                                 -- nullable; not all sources have a project
  customer_name text,                              -- denormalized for fast caption context
  address_city text,                               -- denormalized for caption context
  package_tier text,                               -- 'Economy','Gold','Platinum','Diamond' when known

  -- Media
  url text not null,                               -- blob URL or canonical source URL
  thumbnail_url text,
  mime_type text,
  width_px integer,
  height_px integer,
  size_bytes bigint,
  content_hash text,                               -- sha256 of bytes for dedup

  -- Classification
  pair_role text check (pair_role in ('before', 'after', null)),
  pair_partner_id uuid references media_pool(id) on delete set null,
  tags text[] default '{}',
  captured_at timestamptz,
  quality_score numeric(4,2),                      -- 0-10, computed by scanner

  -- Usage tracking (skip if used recently)
  last_used_at timestamptz,
  used_in_clip_id uuid,                            -- FK to marketing_clips(id), set when generator picks it

  -- Generator-side flags
  excluded boolean not null default false,         -- manual veto
  excluded_reason text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, content_hash)
);

create index if not exists idx_media_pool_tenant on media_pool(tenant_id);
create index if not exists idx_media_pool_unused on media_pool(tenant_id, last_used_at) where excluded = false;
create index if not exists idx_media_pool_pairs on media_pool(tenant_id, pair_role) where pair_partner_id is not null;
create index if not exists idx_media_pool_project on media_pool(project_id) where project_id is not null;
create index if not exists idx_media_pool_quality on media_pool(tenant_id, quality_score desc) where excluded = false;

alter table media_pool enable row level security;

-- ─── GENERATOR RUNS ───────────────────────────────────────────────────────
create table if not exists generator_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  fired_at timestamptz default now(),
  cadence text default 'weekly',                   -- 'weekly' default, 'manual' for ad-hoc fires
  brand_slug text default 'plus_ultra',            -- v1: hard-coded to Plus Ultra Roofing
  target_count integer default 4,
  inserted_count integer default 0,
  candidates_considered integer default 0,
  warnings text[] default '{}',                    -- e.g. 'low_inventory', 'claude_fallback'
  caption_model text,                              -- which Claude model was used
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_generator_runs_tenant_time on generator_runs(tenant_id, fired_at desc);

alter table generator_runs enable row level security;

-- ─── MARKETING_CLIPS ADDITIONS ────────────────────────────────────────────
-- Three additive columns; all default-safe so existing rows stay valid.
alter table marketing_clips
  add column if not exists source_kind text not null default 'upload'
    check (source_kind in ('upload', 'generator'));

alter table marketing_clips
  add column if not exists generator_run_id uuid references generator_runs(id) on delete set null;

alter table marketing_clips
  add column if not exists caption_suggestion text;

create index if not exists idx_marketing_clips_source_kind
  on marketing_clips(tenant_id, source_kind) where source_kind = 'generator';

-- ─── MEDIA POOL → CLIP BACKLINK ───────────────────────────────────────────
-- One generator-sourced clip can compose multiple media_pool items
-- (e.g. before+after pair rendered into one image via the sharp generator).
create table if not exists clip_media_sources (
  clip_id uuid references marketing_clips(id) on delete cascade not null,
  media_id uuid references media_pool(id) on delete cascade not null,
  role text,                                       -- 'before', 'after', 'hero', etc.
  primary key (clip_id, media_id)
);

create index if not exists idx_clip_media_sources_media on clip_media_sources(media_id);

alter table clip_media_sources enable row level security;

-- ─── UPDATE TRIGGERS ──────────────────────────────────────────────────────
-- Reuses the shared update_updated_at() helper from migrations.sql
drop trigger if exists trg_media_pool_updated on media_pool;
create trigger trg_media_pool_updated before update on media_pool
  for each row execute function update_updated_at();

-- ─── MARKETING_CLIPS STATUS WIDENING ─────────────────────────────────────
-- Generator drafts need a holding status that the marketing-publish sweep
-- ignores until approval flips the row to 'ready'. Without this, the
-- existing */10 minute sweep would see status='ready' + empty
-- caption_overrides + scheduled_at-in-window and IMMEDIATELY fail the row
-- (per marketing-publish.js refused-without-approval guard). Adding
-- 'awaiting_approval' gives drafts a quiet waiting state that the sweep's
-- status='ready' filter naturally skips. Approval flips status to 'ready'
-- and populates caption_overrides in one transaction.
alter table marketing_clips drop constraint if exists marketing_clips_status_check;
alter table marketing_clips add constraint marketing_clips_status_check
  check (status in (
    'queued', 'rendering', 'ready', 'scheduled', 'posted', 'failed',
    'awaiting_approval'
  ));

-- ─── AGENT_RUNS SLUG WIDENING ─────────────────────────────────────────────
-- Add 'generator' to the agent_runs CHECK constraint so the weekly generator
-- cron can write a run record without silently dropping via constraint
-- violation (per feedback_agent_slug_check_constraint — the same failure
-- mode that bit 'service' in May 2026 and 'inventory' in migration 062).
alter table agent_runs drop constraint if exists agent_runs_agent_slug_check;
alter table agent_runs add constraint agent_runs_agent_slug_check
  check (agent_slug in (
    'sales','marketing','ops','finance','customer','strategy',
    'service','hq','admin','production','inventory','generator'
  ));
