-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 010: Marketing Clips
-- Selfie-video → auto-captioned, silence-trimmed MP4 → scheduled post
-- Pipeline: Whisper transcribe → Haiku keyword flag → ffmpeg render
-- ═══════════════════════════════════════════════════════════════

create table if not exists marketing_clips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  created_by uuid references users(id) on delete set null,

  -- ─── Source video (raw upload) ───────────────────────────────
  source_url text not null,
  source_filename text,
  source_mime_type text,
  source_size_bytes bigint,
  source_duration_seconds numeric(8,2),

  -- ─── Rendered output ─────────────────────────────────────────
  rendered_url text,
  rendered_duration_seconds numeric(8,2),
  thumbnail_url text,

  -- ─── Transcript + captions ───────────────────────────────────
  -- transcript: { text: string, words: [{word, start, end}] }
  transcript jsonb,
  emphasis_indices int[] default '{}',       -- indices into transcript.words flagged for pop
  caption_style jsonb default '{}',          -- per-clip overrides (font, color, position)

  -- ─── Post metadata ───────────────────────────────────────────
  title text,
  description text,
  hashtags text[] default '{}',

  -- ─── Scheduling ──────────────────────────────────────────────
  target_platforms text[] default '{}',      -- ['facebook', 'youtube', 'gbp']
  scheduled_at timestamptz,
  ghl_post_id text,                          -- set after push to GHL Social Planner
  posted_at timestamptz,

  -- ─── State machine ───────────────────────────────────────────
  status text default 'queued' check (status in (
    'queued',      -- uploaded, waiting to render
    'rendering',   -- pipeline running
    'ready',       -- rendered, awaiting schedule
    'scheduled',   -- pushed to GHL
    'posted',      -- confirmed posted
    'failed'       -- error
  )),
  error_message text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_marketing_clips_tenant on marketing_clips(tenant_id);
create index if not exists idx_marketing_clips_status on marketing_clips(tenant_id, status);
create index if not exists idx_marketing_clips_scheduled on marketing_clips(tenant_id, scheduled_at)
  where scheduled_at is not null;

create trigger trg_marketing_clips_updated before update on marketing_clips
  for each row execute function update_updated_at();

alter table marketing_clips enable row level security;
