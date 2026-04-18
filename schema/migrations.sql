-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Database Schema v0.1
-- Multi-tenant business operating system
-- ═══════════════════════════════════════════════════════════════

-- ─── TENANTS ─────────────────────────────────────────────────
-- Each business is a tenant. Plus Ultra = tenant #1.
create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,              -- 'plus-ultra', 'acme-roofing'
  name text not null,                     -- 'Plus Ultra Roofing'
  domain text,                            -- custom domain if any
  branding jsonb default '{}',            -- logo_url, colors, fonts, skin, load_in_animation
  config jsonb default '{}',              -- feature flags, integrations, AI persona
  owner_email text not null,
  plan text default 'starter',            -- starter, pro, enterprise
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── USERS ───────────────────────────────────────────────────
-- Users belong to a tenant. Roles: owner, admin, estimator, crew
create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  email text not null,
  name text not null,
  phone text,
  role text default 'estimator' check (role in ('owner', 'admin', 'estimator', 'crew')),
  avatar_url text,
  bio text,
  active boolean default true,
  created_at timestamptz default now(),
  unique(tenant_id, email)
);

-- ─── CUSTOMERS ───────────────────────────────────────────────
create table customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  full_name text not null,
  email text,
  phone text,
  address text,
  city text,
  province text default 'NB',
  postal_code text,
  source text,                            -- 'ad', 'referral', 'walk-in', 'website'
  ghl_contact_id text,                    -- GoHighLevel link
  tags text[] default '{}',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_customers_tenant on customers(tenant_id);
create index idx_customers_name on customers(tenant_id, full_name);

-- ─── PACKAGE TEMPLATES ───────────────────────────────────────
-- Configurable per tenant. These define the available packages.
create table package_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  system text not null check (system in ('asphalt', 'metal', 'exterior', 'commercial')),
  tier text not null,                     -- 'gold', 'platinum', 'diamond', 'economy', 'standard', 'enhanced', 'premium'
  name text not null,                     -- Display name: 'Gold — CertainTeed Landmark'
  description text,
  material_spec jsonb default '{}',       -- shingle brand, bundle cost, underlayment, I&W, etc.
  labor_rates jsonb default '{}',         -- base rates, pitch tiers, adders
  multipliers jsonb default '{}',         -- margin multipliers or divisors per pricing model
  warranty_years int,
  warranty_adder_per_sq numeric(10,2) default 0,
  margin_floor numeric(5,2),              -- minimum margin %
  sort_order int default 0,
  is_default boolean default false,       -- show "Most Popular" badge
  active boolean default true,
  created_at timestamptz default now()
);

create index idx_packages_tenant on package_templates(tenant_id, system);

-- ─── ESTIMATES ───────────────────────────────────────────────
-- The core estimate record. Links to customer, holds measurements + pricing.
create table estimates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  estimate_number serial,                 -- human-readable #
  customer_id uuid references customers(id),
  created_by uuid references users(id),
  sales_owner uuid references users(id),

  -- Scope
  proposal_mode text default 'Roof Only' check (proposal_mode in (
    'Roof Only', 'Hybrid', 'Roof + Soffit/Fascia', 'Metal', 'Full Exterior', 'Commercial'
  )),
  pricing_model text default 'Local' check (pricing_model in ('Local', 'Day Trip', 'Extended Stay')),

  -- Roof measurements
  roof_area_sqft numeric(10,2),           -- 2D area before pitch
  roof_pitch text,                        -- '6/12', '10/12'
  complexity text default 'medium' check (complexity in ('simple', 'medium', 'complex')),
  eaves_lf numeric(10,2) default 0,
  rakes_lf numeric(10,2) default 0,
  ridges_lf numeric(10,2) default 0,
  valleys_lf numeric(10,2) default 0,
  walls_lf numeric(10,2) default 0,
  hips_lf numeric(10,2) default 0,
  pipes int default 0,
  vents int default 0,
  chimneys int default 0,
  chimney_size text default 'small' check (chimney_size in ('small', 'large')),
  chimney_cricket boolean default false,
  stories int default 1,
  extra_layers int default 0,
  cedar_tearoff boolean default false,
  redeck_sheets int default 0,
  new_construction boolean default false,

  -- Exterior measurements (Performance Shell / Full Exterior)
  siding_sqft numeric(10,2) default 0,
  soffit_lf numeric(10,2) default 0,
  fascia_lf numeric(10,2) default 0,
  gutter_lf numeric(10,2) default 0,
  window_count int default 0,
  door_count int default 0,
  osb_sheets int default 0,              -- substrate for Performance Shell
  remediation_allowance numeric(10,2) default 0,

  -- Distance
  distance_km numeric(10,2) default 0,

  -- Calculated pricing (stored after quote engine runs)
  calculated_packages jsonb default '{}', -- { gold: { hardCost, sellingPrice, hst, total }, ... }
  selected_package text,                  -- which package the customer chose
  custom_prices jsonb default '{}',       -- manual overrides per package

  -- Status
  status text default 'draft' check (status in (
    'draft', 'calculated', 'proposal_sent', 'viewed', 'accepted', 'declined',
    'scheduled', 'in_progress', 'complete', 'cancelled'
  )),
  accepted_at timestamptz,
  share_token text unique,                -- public share link token

  -- Meta
  notes jsonb default '[]',              -- [{ text, date, author }]
  tags text[] default '{}',
  ghl_opportunity_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_estimates_tenant on estimates(tenant_id);
create index idx_estimates_customer on estimates(customer_id);
create index idx_estimates_status on estimates(tenant_id, status);
create index idx_estimates_share on estimates(share_token);

-- ─── ESTIMATE PHOTOS ─────────────────────────────────────────
create table estimate_photos (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid references estimates(id) on delete cascade not null,
  url text not null,
  filename text,
  mime_type text,
  is_cover boolean default false,
  caption text,
  sort_order int default 0,
  uploaded_at timestamptz default now()
);

create index idx_photos_estimate on estimate_photos(estimate_id);

-- ─── PROPOSALS ───────────────────────────────────────────────
-- The client-facing sales page. One estimate can have multiple proposal versions.
create table proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  estimate_id uuid references estimates(id) on delete cascade not null,
  version int default 1,

  -- Content (all editable live)
  headline text default 'Your System. Your Timeline. Your Decision.',
  tagline text,
  custom_message text,
  cover_photo_url text,
  video_url text,
  gallery_photos jsonb default '[]',      -- [{ url, alt }]

  -- Layout config
  template text default 'standard',       -- template name for rendering
  show_financing boolean default true,
  show_warranty_comparison boolean default true,
  highlighted_package text,               -- which package gets "Most Popular"

  -- Tracking
  view_count int default 0,
  last_viewed_at timestamptz,
  share_url text,

  -- Meta
  published boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_proposals_estimate on proposals(estimate_id);

-- ─── CREW TICKETS ────────────────────────────────────────────
-- Replaces Action Board
create table tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  ticket_number serial,
  title text not null,
  description text,
  estimate_id uuid references estimates(id),
  customer_id uuid references customers(id),
  assigned_to uuid references users(id),
  priority text default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text default 'open' check (status in ('open', 'active', 'blocked', 'done', 'cancelled')),
  due_date date,
  completed_at timestamptz,
  tags text[] default '{}',
  notes jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_tickets_tenant on tickets(tenant_id);
create index idx_tickets_assigned on tickets(assigned_to);
create index idx_tickets_status on tickets(tenant_id, status);

-- ─── LEADS ───────────────────────────────────────────────────
-- Replaces Instant Estimator lead tracking
create table leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  customer_id uuid references customers(id),
  source text,                            -- 'facebook_ad', '10cm_pdf', 'website', 'referral', 'phone'
  campaign text,                          -- ad campaign name
  channel text,                           -- 'facebook', 'google', 'organic', 'direct'
  status text default 'new' check (status in (
    'new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost', 'stale'
  )),
  value numeric(12,2),                    -- estimated deal value
  assigned_to uuid references users(id),
  first_contact_at timestamptz,
  last_activity_at timestamptz,
  notes text,
  metadata jsonb default '{}',            -- utm params, form data, etc.
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_leads_tenant on leads(tenant_id);
create index idx_leads_status on leads(tenant_id, status);
create index idx_leads_created on leads(tenant_id, created_at desc);

-- ─── SOPs & TEMPLATES ────────────────────────────────────────
-- Structured SOPs and document templates per tenant
create table sops (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  category text not null,                 -- 'sales', 'crew', 'admin', 'marketing', 'onboarding'
  title text not null,
  content text not null,                  -- markdown
  tags text[] default '{}',
  sort_order int default 0,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_sops_tenant on sops(tenant_id, category);

-- ─── ACTIVITY LOG ────────────────────────────────────────────
-- Universal audit trail across the platform
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  user_id uuid references users(id),
  entity_type text not null,              -- 'estimate', 'proposal', 'ticket', 'lead', 'customer'
  entity_id uuid not null,
  action text not null,                   -- 'created', 'updated', 'viewed', 'accepted', 'assigned'
  details jsonb default '{}',
  created_at timestamptz default now()
);

create index idx_activity_tenant on activity_log(tenant_id, created_at desc);
create index idx_activity_entity on activity_log(entity_type, entity_id);

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────
-- Every table is tenant-scoped. No cross-tenant data leaks.
alter table tenants enable row level security;
alter table users enable row level security;
alter table customers enable row level security;
alter table package_templates enable row level security;
alter table estimates enable row level security;
alter table estimate_photos enable row level security;
alter table proposals enable row level security;
alter table tickets enable row level security;
alter table leads enable row level security;
alter table sops enable row level security;
alter table activity_log enable row level security;

-- Service role bypasses RLS (for API routes)
-- Anon/authenticated users get tenant-scoped access via policies
-- Policies will be added after auth strategy is finalized

-- ─── UPDATED_AT TRIGGER ─────────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_tenants_updated before update on tenants for each row execute function update_updated_at();
create trigger trg_customers_updated before update on customers for each row execute function update_updated_at();
create trigger trg_estimates_updated before update on estimates for each row execute function update_updated_at();
create trigger trg_proposals_updated before update on proposals for each row execute function update_updated_at();
create trigger trg_tickets_updated before update on tickets for each row execute function update_updated_at();
create trigger trg_leads_updated before update on leads for each row execute function update_updated_at();
create trigger trg_sops_updated before update on sops for each row execute function update_updated_at();
