-- Ryujin OS - Migration 094: Marketing Intelligence
-- (1) meta_insights: daily ad/adset/campaign performance incl. full video
--     watch-time, pulled from the Meta Graph API by the meta-insights feeder.
-- (2) attribution jsonb on customers + estimates so a captured ad click
--     (fbclid/utm/ad_id) propagates lead -> customer -> estimate -> proposal.
-- Idempotent. Apply via Supabase Management API + PAT.

-- ── (1) meta_insights ───────────────────────────────────────────────
create table if not exists meta_insights (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,

  level           text not null check (level in ('ad','adset','campaign')),
  object_id       text not null,          -- ad_id | adset_id | campaign_id
  object_name     text,

  -- denormalized hierarchy for filtering/rollups
  campaign_id     text,
  campaign_name   text,
  adset_id        text,
  adset_name      text,

  date_start      date not null,
  date_end        date not null,

  -- delivery
  impressions     bigint  default 0,
  reach           bigint  default 0,
  frequency       numeric default 0,
  spend_cents     bigint  default 0,
  cpm_cents       bigint  default 0,

  -- clicks
  clicks          bigint  default 0,
  link_clicks     bigint  default 0,
  ctr             numeric default 0,
  cpc_cents       bigint  default 0,

  -- leads
  leads           bigint  default 0,
  cost_per_lead_cents bigint,

  -- video watch-time
  video_plays_3s  bigint  default 0,
  video_thruplays bigint  default 0,
  video_p25       bigint  default 0,
  video_p50       bigint  default 0,
  video_p75       bigint  default 0,
  video_p100      bigint  default 0,
  video_avg_watch_sec numeric default 0,

  raw_meta        jsonb   default '{}'::jsonb,
  synced_at       timestamptz default now(),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),

  unique (tenant_id, level, object_id, date_start)
);

create index if not exists idx_meta_insights_tenant_date
  on meta_insights (tenant_id, date_start desc);
create index if not exists idx_meta_insights_campaign
  on meta_insights (tenant_id, campaign_id, date_start desc);
create index if not exists idx_meta_insights_level
  on meta_insights (tenant_id, level, date_start desc);

drop trigger if exists trg_meta_insights_updated on meta_insights;
create trigger trg_meta_insights_updated
  before update on meta_insights
  for each row execute function update_updated_at();

alter table meta_insights enable row level security;

-- ── (2) attribution on customers + estimates ────────────────────────
-- jsonb shape: { utm_source, utm_medium, utm_campaign, utm_content, utm_term,
--                fbclid, gclid, ad_id, adset_id, campaign_id, landing_url,
--                captured_at }
alter table customers add column if not exists attribution jsonb default '{}'::jsonb;
alter table estimates add column if not exists attribution jsonb default '{}'::jsonb;

-- btree expression index on the captured ad_id for fast ad -> sale joins
create index if not exists idx_customers_attr_ad
  on customers (tenant_id, (attribution->>'ad_id'));
create index if not exists idx_estimates_attr_ad
  on estimates (tenant_id, (attribution->>'ad_id'));
create index if not exists idx_estimates_attr_campaign
  on estimates (tenant_id, (attribution->>'campaign_id'));
