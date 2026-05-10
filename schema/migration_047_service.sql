-- Ryujin OS — Migration 047: Service domain (AJ's pillar)
--
-- Service ≠ post-production closeout. This is ongoing repair/callback/
-- warranty-claim work that happens weeks-months-years after the original
-- install. AJ owns this per the Outside Sales Handbook (sub-$2.5K repairs).
--
-- Two tables:
--   service_tickets   — repair work, callbacks, scheduled maintenance
--   warranty_claims   — CertainTeed + workmanship warranty filings
-- Plus tenant_settings.service_config for /service-admin.html persistence.

-- ─── service_tickets ─────────────────────────────────────────────
create table if not exists service_tickets (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  customer_id     uuid references customers(id) on delete set null,
  -- Optional link back to the original install (estimate/workorder) so we can
  -- track callback rate per job and per crew.
  source_estimate uuid references estimates(id) on delete set null,
  source_workorder uuid,  -- workorders may not have FK guaranteed in this schema; keep loose
  ticket_type     text not null default 'repair' check (ticket_type in (
                    'repair','callback','maintenance','warranty_visit','inspection'
                  )),
  priority        text not null default 'normal' check (priority in ('urgent','high','normal','low')),
  status          text not null default 'open' check (status in (
                    'open','scheduled','in_progress','complete','cancelled'
                  )),
  title           text not null,
  description     text,
  reported_at     timestamptz not null default now(),
  scheduled_at    timestamptz,
  completed_at    timestamptz,
  assigned_to     uuid references users(id) on delete set null,    -- typically AJ
  estimated_cost  numeric,
  actual_cost     numeric,
  customer_pays   boolean default true,                              -- false = warranty/courtesy
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  created_by      uuid references users(id)
);

create index if not exists service_tickets_tenant_status on service_tickets (tenant_id, status, reported_at desc);
create index if not exists service_tickets_tenant_assigned on service_tickets (tenant_id, assigned_to, status);
create index if not exists service_tickets_customer on service_tickets (tenant_id, customer_id);

-- ─── warranty_claims ────────────────────────────────────────────
create table if not exists warranty_claims (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  customer_id     uuid references customers(id) on delete set null,
  source_estimate uuid references estimates(id) on delete set null,
  -- Type captures whether it's manufacturer (CertainTeed/IKO) or our workmanship
  claim_type      text not null check (claim_type in (
                    'manufacturer','workmanship','surestart_10yr','suregold','other'
                  )),
  manufacturer    text,                       -- CertainTeed | IKO | etc.
  status          text not null default 'open' check (status in (
                    'open','documenting','filed','approved','denied','resolved','withdrawn'
                  )),
  title           text not null,
  description     text,
  defect_observed text,
  filed_at        timestamptz,                -- when filed with manufacturer
  reference_number text,                       -- manufacturer claim ref
  resolution      text,                        -- 'replacement','refund','no_action','goodwill'
  resolved_at     timestamptz,
  service_ticket_id uuid references service_tickets(id) on delete set null,  -- if a service visit was needed
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  created_by      uuid references users(id),
  updated_at      timestamptz not null default now()
);

create index if not exists warranty_claims_tenant_status on warranty_claims (tenant_id, status, created_at desc);
create index if not exists warranty_claims_customer on warranty_claims (tenant_id, customer_id);

create or replace function set_warranty_claims_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists warranty_claims_updated_at on warranty_claims;
create trigger warranty_claims_updated_at
  before update on warranty_claims
  for each row execute procedure set_warranty_claims_updated_at();

-- ─── tenant_settings.service_config ─────────────────────────────
alter table tenant_settings
  add column if not exists service_config jsonb default '{}'::jsonb;
