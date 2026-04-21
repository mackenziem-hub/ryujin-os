-- Ryujin OS — Migration 013: Production (Pay Sheets + Work Orders)
-- Adds two tables behind the Production section: paysheets (subcontractor pay tracking)
-- and workorders (per-job scope for crew dispatch). Both tenant-scoped, both link back
-- to an estimate where applicable.

-- ─── PAY SHEETS ──────────────────────────────────────────────
create table if not exists paysheets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  job_id text not null,                              -- e.g. PU-2026-EDGE (unique per tenant)
  address text not null,
  customer_name text,
  subcontractor text not null default 'Atlantic Roofing & Contracting Inc. (Ryan)',
  status text not null default 'scheduled' check (status in (
    'scheduled','in_progress','completed','invoice_final','cancelled'
  )),
  shingle_product text,
  eagleview_report text,
  job_type text default 'replacement' check (job_type in ('replacement','new_construction','repair')),

  -- Line items (all stored as JSONB arrays for flexibility)
  labour_breakdown jsonb default '[]',               -- [{description,qty_sq,rate_per_sq,total}]
  add_ons jsonb default '[]',                        -- [{description,qty,rate,total}]
  surcharges jsonb default '[]',                     -- [{description,qty,rate,total}] — mansard, travel, etc.

  -- Totals
  subtotal numeric(12,2) default 0,
  hst numeric(12,2) default 0,
  total numeric(12,2) default 0,

  -- Payments
  payment_tracker jsonb default '[]',                -- [{date,method,amount,note}]
  paid_to_date numeric(12,2) default 0,
  balance_due numeric(12,2) default 0,

  -- Notes (stored as arrays of strings)
  scope_notes text[] default '{}',
  pricing_sources text[] default '{}',               -- [A]/[M]/[J]/[I] source codes
  outstanding text[] default '{}',

  -- Refs
  linked_estimate_id uuid references estimates(id) on delete set null,
  scheduled_date date,
  completed_date date,
  invoice_finalized_at timestamptz,

  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(tenant_id, job_id)
);

create index if not exists idx_paysheets_tenant on paysheets(tenant_id);
create index if not exists idx_paysheets_status on paysheets(tenant_id, status);
create index if not exists idx_paysheets_estimate on paysheets(linked_estimate_id);

-- ─── WORK ORDERS ─────────────────────────────────────────────
create table if not exists workorders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  wo_number serial,
  linked_estimate_id uuid references estimates(id) on delete set null,
  linked_paysheet_id uuid references paysheets(id) on delete set null,

  -- Client info
  customer_name text not null,
  address text not null,
  phone text,
  email text,
  special_notes text,                                -- pets, parking, gate code, etc.

  -- Schedule
  start_date date,
  estimated_duration_days int,
  work_hours text,
  no_work_days text,

  -- Assignment
  sub_crew_lead text,
  support_crew text[],
  onsite_contact text,

  -- Scope
  job_type text check (job_type in ('full_replacement','repair','gutters','siding','other')),
  total_sq numeric(6,2),
  roof_pitch text,
  layers_to_remove int,
  shingle_product text,
  shingle_color text,
  package_tier text check (package_tier in ('gold','platinum','diamond','grand_manor',null)),

  scope_items jsonb default '[]',                    -- [{item,qty,included,notes}] from WO template checklist
  additional_scope text,

  -- Status
  status text default 'draft' check (status in (
    'draft','issued','in_progress','complete','cancelled'
  )),
  issued_at timestamptz,
  completed_at timestamptz,

  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_workorders_tenant on workorders(tenant_id);
create index if not exists idx_workorders_status on workorders(tenant_id, status);
create index if not exists idx_workorders_estimate on workorders(linked_estimate_id);
create index if not exists idx_workorders_start on workorders(tenant_id, start_date);

-- Enable RLS (service_role bypasses)
alter table paysheets enable row level security;
alter table workorders enable row level security;
