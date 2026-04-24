-- Ryujin OS · Migration 014 · Social posting pipeline
-- Adds brand identity + brand→GHL account mapping + scheduled-post tracking
-- on top of the marketing clips lifecycle (migration 010).
--
-- Run in Supabase SQL editor. All statements idempotent.

-- ─── BRANDS ────────────────────────────────────────────────────────────────
-- One brand = one "voice" + one audience. A tenant can have many brands (Plus
-- Ultra has three: Plus Ultra Roofing, Mackenzie Mazerolle personal, Roofing
-- Fundamentals). Brand voice feeds the Claude caption generator.
create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  slug text not null,
  name text not null,
  voice text,             -- free-form voice description for Claude prompt
  tagline text,           -- brand tagline / hook line
  hashtags text[],         -- default hashtags merged into every post
  cta text,               -- default CTA ("Book your free inspection", etc.)
  website text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, slug)
);

create index if not exists idx_brands_tenant on brands(tenant_id);

-- ─── BRAND ACCOUNTS ────────────────────────────────────────────────────────
-- Maps each connected GHL social account to a brand (or marks it excluded).
-- ghl_account_id is the opaque string GHL returns — we cache it here so we
-- don't need to relist accounts on every schedule. platform is denormalized
-- for fast UI filtering.
create table if not exists brand_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  brand_id uuid references brands(id) on delete set null,  -- null + excluded=true = ignore
  ghl_account_id text not null,
  platform text not null,  -- 'facebook','instagram','youtube','tiktok','google'
  account_name text,
  account_handle text,      -- @username where applicable
  excluded boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, ghl_account_id)
);

create index if not exists idx_brand_accounts_tenant on brand_accounts(tenant_id);
create index if not exists idx_brand_accounts_brand on brand_accounts(brand_id);
create index if not exists idx_brand_accounts_platform on brand_accounts(tenant_id, platform);

-- ─── SCHEDULED POSTS ───────────────────────────────────────────────────────
-- One row per (clip × brand × platform × GHL account). When we fan out, we
-- insert N rows and POST each to GHL's Social Planner. status flows
-- draft → scheduled → posted (or failed).
create table if not exists scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  clip_id uuid,                                   -- optional: link to marketing_clips
  brand_id uuid references brands(id) on delete set null,
  ghl_account_id text not null,
  ghl_post_id text,                               -- returned by GHL after create
  platform text not null,
  caption text,
  media_url text,                                 -- video/image URL sent to GHL
  media_type text default 'video',                -- 'video' | 'image'
  scheduled_at timestamptz not null,
  status text not null default 'draft' check (status in (
    'draft','scheduled','posting','posted','failed','cancelled'
  )),
  posted_at timestamptz,
  error_msg text,
  raw_response jsonb,                             -- GHL response payload for debugging
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_scheduled_posts_tenant_time on scheduled_posts(tenant_id, scheduled_at);
create index if not exists idx_scheduled_posts_clip on scheduled_posts(clip_id);
create index if not exists idx_scheduled_posts_status on scheduled_posts(tenant_id, status);
create index if not exists idx_scheduled_posts_brand on scheduled_posts(tenant_id, brand_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────
alter table brands enable row level security;
alter table brand_accounts enable row level security;
alter table scheduled_posts enable row level security;
-- Service role (used by Vercel functions) bypasses RLS. No user-facing policies
-- needed yet — tenant enforcement happens in the API layer via requireTenant.

-- ─── SEED PLUS ULTRA BRANDS ───────────────────────────────────────────────
-- Idempotent: only inserts if absent.
insert into brands (tenant_id, slug, name, voice, cta, website)
select
  (select id from tenants where slug = 'plus-ultra'),
  b.slug, b.name, b.voice, b.cta, b.website
from (values
  (
    'plus_ultra',
    'Plus Ultra Roofing',
    'Warm, authoritative, family-roofing business. 3rd-gen pride without bragging. Focus on durability, certainty, the CertainTeed system. Avoid sci-fi/techy tone and negations (Jewels'' rules). Riverview NB, serves greater Moncton.',
    'Get your free roof inspection',
    'plusultraroofing.com'
  ),
  (
    'mackenzie',
    'Mackenzie Mazerolle',
    'Personal, candid. Owner of Plus Ultra sharing trade insights, behind-the-scenes ops, and lessons from 3rd-gen roofing. Trade-first, human second.',
    'Follow for more',
    null
  ),
  (
    'roofing_fundamentals',
    'Roofing Fundamentals',
    'Educational, technical, how-to. Explains roofing concepts for homeowners and new tradespeople. Plain-language teacher tone. Not Plus Ultra branded — standalone educational channel.',
    'Subscribe to learn more',
    null
  )
) as b(slug, name, voice, cta, website)
where (select id from tenants where slug = 'plus-ultra') is not null
on conflict (tenant_id, slug) do nothing;
