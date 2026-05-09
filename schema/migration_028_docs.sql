-- Ryujin OS — Migration 028: Documents System
--
-- Unified branded-doc store. Markdown source of truth, rendered client-side
-- via /doc.html?slug=X. Feeds chat brain + agents as canonical knowledge.
-- Replaces standalone handbook-outside-sales.html and scattered knowledge files.

create table if not exists docs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  slug text not null,
  title text not null,
  markdown text not null default '',
  hero_image text,
  summary text,
  status text not null default 'draft' check (status in ('draft','published')),
  is_system_managed boolean not null default false,
  version int not null default 1,
  gamma_url text,
  gamma_generation_id text,
  gamma_generated_at timestamptz,
  notebook_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create index if not exists idx_docs_tenant_status on docs(tenant_id, status);
create index if not exists idx_docs_tenant_updated on docs(tenant_id, updated_at desc);

-- Auto-bump updated_at on row update
create or replace function docs_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists docs_touch on docs;
create trigger docs_touch
  before update on docs
  for each row execute function docs_touch_updated_at();
