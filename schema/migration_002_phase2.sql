-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 002: Phase 2 — Field Ops
-- Projects, Files, Time Entries, Comments, Inspections
-- ═══════════════════════════════════════════════════════════════

-- ─── PROJECTS ────────────────────────────────────────────────
-- Central folder for a job. Auto-created when estimate hits "scheduled".
-- Links estimate → photos → tickets → client portal.
create table projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  estimate_id uuid references estimates(id),
  customer_id uuid references customers(id),
  name text not null,                     -- e.g., '105 Rue Fortune — Arzaga'
  address text,
  city text,
  province text default 'NB',
  status text default 'not_started' check (status in (
    'not_started', 'active', 'punch_list', 'complete', 'cancelled'
  )),
  share_token text unique,               -- client portal access token
  share_expires_at timestamptz,           -- optional expiry for collaborator access
  notes text,
  tags text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_projects_tenant on projects(tenant_id);
create index idx_projects_estimate on projects(estimate_id);
create index idx_projects_share on projects(share_token);
create index idx_projects_status on projects(tenant_id, status);

-- Link tickets to projects (add column to existing tickets table)
alter table tickets add column project_id uuid references projects(id);
create index idx_tickets_project on tickets(project_id);

-- ─── PROJECT FILES ───────────────────────────────────────────
-- Photos, videos, documents uploaded by crew or office staff.
create table project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  tenant_id uuid references tenants(id) on delete cascade not null,
  uploaded_by uuid references users(id),

  -- File info
  url text not null,                      -- Vercel Blob URL
  thumbnail_url text,                     -- auto-generated thumbnail for gallery
  filename text,
  mime_type text,                         -- image/jpeg, video/mp4, application/pdf, etc.
  file_size int,                          -- bytes

  -- Organization
  category text default 'general' check (category in (
    'before', 'during', 'after', 'damage', 'material', 'safety', 'inspection', 'general'
  )),
  caption text,                           -- description / notes on this file
  tags text[] default '{}',               -- custom tags

  -- Annotations (stored as JSON — drawing data from the editor)
  annotations jsonb default '[]',         -- [{ type: 'circle', x, y, r, color }, { type: 'line', points, color }, ...]
  annotated_url text,                     -- URL of the annotated/flattened version

  -- Visibility
  client_visible boolean default false,   -- show in client portal?
  is_cover boolean default false,         -- cover photo for the project
  sort_order int default 0,

  -- Metadata
  captured_at timestamptz,                -- when the photo was actually taken (EXIF)
  latitude numeric(10,7),                 -- GPS from phone
  longitude numeric(10,7),
  uploaded_at timestamptz default now()
);

create index idx_files_project on project_files(project_id);
create index idx_files_tenant on project_files(tenant_id);
create index idx_files_category on project_files(project_id, category);
create index idx_files_client on project_files(project_id, client_visible) where client_visible = true;

-- ─── TIME ENTRIES ────────────────────────────────────────────
-- Clock in/out per user per day. Simple daily punches.
create table time_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  user_id uuid references users(id) on delete cascade not null,
  date date not null,                     -- the work day
  clock_in timestamptz,
  clock_out timestamptz,
  total_hours numeric(5,2),              -- auto-calculated on clock out
  notes text,                             -- optional day summary
  status text default 'open' check (status in ('open', 'closed', 'approved')),
  approved_by uuid references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, date)                   -- one entry per user per day
);

create index idx_time_tenant on time_entries(tenant_id);
create index idx_time_user on time_entries(user_id, date desc);

-- ─── COMMENTS ────────────────────────────────────────────────
-- Comments on projects — from clients (collaborators), crew, or admin.
create table comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  tenant_id uuid references tenants(id) on delete cascade not null,

  -- Author — either a registered user or a guest (client)
  user_id uuid references users(id),     -- null if guest
  guest_name text,                        -- for collaborator/client comments
  guest_email text,

  -- Content
  body text not null,
  file_id uuid references project_files(id), -- optional: comment on a specific photo

  -- Meta
  is_internal boolean default false,      -- internal = not shown to clients
  created_at timestamptz default now()
);

create index idx_comments_project on comments(project_id);
create index idx_comments_file on comments(file_id);

-- ─── INSPECTIONS ─────────────────────────────────────────────
-- Generated inspection reports from project photos.
create table inspections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  tenant_id uuid references tenants(id) on delete cascade not null,
  created_by uuid references users(id),

  -- Content
  title text not null,                    -- e.g., '105 Rue Fortune — Roof Inspection'
  template text default 'standard',       -- template name for formatting
  summary text,                           -- overview / findings text
  selected_files uuid[] default '{}',     -- IDs of project_files included in this report
  sections jsonb default '[]',            -- [{ title, description, file_ids, annotations_snapshot }]

  -- Generated output
  pdf_url text,                           -- Vercel Blob URL of generated PDF
  html_content text,                      -- cached HTML for re-rendering

  -- Status
  status text default 'draft' check (status in ('draft', 'final', 'shared')),
  shared_with_client boolean default false,
  share_token text unique,                -- separate share link for the inspection report

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_inspections_project on inspections(project_id);
create index idx_inspections_tenant on inspections(tenant_id);
create index idx_inspections_share on inspections(share_token);

-- ─── RLS ─────────────────────────────────────────────────────
alter table projects enable row level security;
alter table project_files enable row level security;
alter table time_entries enable row level security;
alter table comments enable row level security;
alter table inspections enable row level security;

-- ─── UPDATED_AT TRIGGERS ─────────────────────────────────────
create trigger trg_projects_updated before update on projects for each row execute function update_updated_at();
create trigger trg_time_entries_updated before update on time_entries for each row execute function update_updated_at();
create trigger trg_inspections_updated before update on inspections for each row execute function update_updated_at();
