-- Ryujin OS — Migration 016: Subcontractor portal + per-job log
--
-- Adds:
--   * subcontractors table (magic-link auth, one row per sub per tenant)
--   * workorders.subcontractor_id FK (keeps legacy text `subcontractor` field for compat)
--   * job_log_entries table (typed entries on a WO with owner approval flow)

-- ─── SUBCONTRACTORS ─────────────────────────────────────────────
create table if not exists subcontractors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  name text not null,
  company text,
  phone text,
  email text,
  trade text default 'roofing',
  magic_link_token text unique,
  magic_link_expires_at timestamptz,
  active boolean default true,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_subcontractors_tenant on subcontractors(tenant_id);
create index if not exists idx_subcontractors_token on subcontractors(magic_link_token);
alter table subcontractors enable row level security;

-- ─── LINK WORK ORDERS ───────────────────────────────────────────
alter table workorders
  add column if not exists subcontractor_id uuid references subcontractors(id);
create index if not exists idx_workorders_sub on workorders(subcontractor_id);

-- ─── LINK PAYSHEETS ─────────────────────────────────────────────
alter table paysheets
  add column if not exists subcontractor_id uuid references subcontractors(id);
create index if not exists idx_paysheets_sub on paysheets(subcontractor_id);

-- ─── JOB LOG ENTRIES ────────────────────────────────────────────
-- Per-WO log: material purchases, scope changes, additional fees, advance payouts.
-- Sub creates, owner approves. Approved entries feed into the paysheet total.
create table if not exists job_log_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  workorder_id uuid references workorders(id) on delete cascade not null,
  paysheet_id uuid references paysheets(id) on delete set null,
  subcontractor_id uuid references subcontractors(id) on delete set null,

  entry_type text not null check (entry_type in (
    'material_purchase',   -- sub bought materials, wants reimbursement
    'scope_change',        -- scope adjustment, may need paysheet change
    'additional_fee',      -- extra charge (rot, labor, surprise)
    'advance_payout',      -- owner paid sub before completion
    'note'                 -- FYI, no $ impact
  )),

  description text not null,
  amount numeric(10,2) default 0,
  vendor text,
  photos jsonb default '[]',        -- array of Vercel Blob URLs

  status text default 'pending' check (status in (
    'pending', 'approved', 'denied'
  )),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  review_notes text,

  created_by_sub boolean default false,  -- true if sub created, false if owner
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_job_log_tenant on job_log_entries(tenant_id);
create index if not exists idx_job_log_wo on job_log_entries(workorder_id);
create index if not exists idx_job_log_paysheet on job_log_entries(paysheet_id);
create index if not exists idx_job_log_status on job_log_entries(status);
alter table job_log_entries enable row level security;

-- ─── SEED RYAN (Atlantic Roofing) ───────────────────────────────
-- Idempotent: upsert by (tenant_id, email).
insert into subcontractors (tenant_id, name, company, phone, email, trade)
select t.id, 'Ryan', 'Atlantic Roofing & Contracting Inc.', null, 'ryan@atlanticroofing.local', 'roofing'
from tenants t where t.slug = 'plus-ultra'
on conflict do nothing;

-- Link existing Ryan paysheets + WOs to this subcontractor row.
update workorders
  set subcontractor_id = (
    select s.id from subcontractors s
    where s.tenant_id = workorders.tenant_id and s.company = 'Atlantic Roofing & Contracting Inc.'
    limit 1
  )
where subcontractor_id is null
  and (sub_crew_lead ilike '%ryan%' or sub_crew_lead ilike '%atlantic%');

update paysheets
  set subcontractor_id = (
    select s.id from subcontractors s
    where s.tenant_id = paysheets.tenant_id and s.company = 'Atlantic Roofing & Contracting Inc.'
    limit 1
  )
where subcontractor_id is null
  and subcontractor ilike '%ryan%';
