-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 022: Tenant Settings — Floor Enforcement
-- Adds five fields to tenant_settings so the quote engine can:
--   1. Apply a sales+overhead+marketing loading layer to selling price
--   2. Refuse-to-recommend below a per-workday net floor
--   3. Bake supervisor day rate (e.g. AJ on Ryan-led jobs) into hard cost
--   4. Pick the right sub rate sheet for paysheet/labor lookup
-- All columns are nullable / IF NOT EXISTS — safe to re-run.
-- Plus Ultra defaults reflect verbal alignment on Apr 27 2026.
-- ═══════════════════════════════════════════════════════════════

alter table tenant_settings
  add column if not exists loading_pct numeric(5,4) default 0.30;       -- 20% sales + 5% overhead + 5% marketing

alter table tenant_settings
  add column if not exists min_net_per_workday numeric(10,2) default 800; -- $600 net + $200 buffer floor

alter table tenant_settings
  add column if not exists supervisor_day_rate numeric(10,2) default 270;  -- AJ at $270/day

alter table tenant_settings
  add column if not exists supervisor_required boolean default true;       -- Plus Ultra: AJ on every Ryan-led job

alter table tenant_settings
  add column if not exists default_sub_slug text default 'atlantic-roofing'; -- which rate sheet drives labor

-- Backfill — only patches Plus Ultra explicitly. Other tenants inherit
-- column defaults on next read.
update tenant_settings ts
   set loading_pct          = coalesce(ts.loading_pct,          0.30),
       min_net_per_workday  = coalesce(ts.min_net_per_workday,  800),
       supervisor_day_rate  = coalesce(ts.supervisor_day_rate,  270),
       supervisor_required  = coalesce(ts.supervisor_required,  true),
       default_sub_slug     = coalesce(ts.default_sub_slug,     'atlantic-roofing')
  from tenants t
 where t.id = ts.tenant_id
   and t.slug = 'plus-ultra';

comment on column tenant_settings.loading_pct           is 'Sales+overhead+marketing as fraction of selling price (Plus Ultra: 0.30)';
comment on column tenant_settings.min_net_per_workday   is 'Floor: minimum mac-net-per-workday before a tier is recommended (Plus Ultra: 800)';
comment on column tenant_settings.supervisor_day_rate   is 'Day rate for the on-site supervisor baked into hard cost (Plus Ultra: AJ @ 270)';
comment on column tenant_settings.supervisor_required   is 'If true, supervisor_day_rate * workdays is added to every quote';
comment on column tenant_settings.default_sub_slug      is 'Sub rate sheet to use for labor cost (lib/subcontractor-rates.js key)';
