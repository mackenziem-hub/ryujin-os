-- Ryujin OS — Migration 043: Campaigns table
--
-- Backs the marketing-campaign.html builder. Uses Hormozi's "Core Four"
-- step framing (offer · audience · creative · funnel/budget). Stored
-- as JSONB so the schema stays light while the builder evolves.

create table if not exists campaigns (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  name            text not null,
  status          text not null default 'draft' check (status in ('draft','active','paused','completed','archived')),
  hormozi_step    int default 1 check (hormozi_step between 1 and 5),
  offer           jsonb default '{}'::jsonb,        -- the value prop, price, guarantee
  audience        jsonb default '{}'::jsonb,        -- targeting + sizing
  creative        jsonb default '{}'::jsonb,        -- hook, headline, asset refs
  budget          jsonb default '{}'::jsonb,        -- daily/total spend, bid strategy
  funnel          jsonb default '{}'::jsonb,        -- step-by-step CTA flow
  brand_ids       uuid[] default array[]::uuid[],   -- which brands this fans out to
  schedule_start  timestamptz,
  schedule_end    timestamptz,
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  created_by      uuid references users(id),
  updated_at      timestamptz not null default now()
);

create index if not exists campaigns_tenant_status on campaigns (tenant_id, status, updated_at desc);
create index if not exists campaigns_tenant_step on campaigns (tenant_id, hormozi_step);

-- Auto-update updated_at on row updates
create or replace function set_campaigns_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists campaigns_updated_at on campaigns;
create trigger campaigns_updated_at
  before update on campaigns
  for each row execute procedure set_campaigns_updated_at();
