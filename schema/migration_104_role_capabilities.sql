-- migration_104_role_capabilities.sql
-- Phase 1 of the Companion OS: a tenant-scoped role -> capability map so ONE app
-- (companion.html) paints the right tabs + features per role. Mac's locked role
-- model (Jun 26): owner / admin(EA) / crew(in-house) / sub(lead) / installer
-- (media-only link: job folder + photos only, a sub's people or any installer).
--
-- This map drives the UI + a coarse default. It is NOT the security boundary:
-- every data endpoint still re-checks scope server-side (isPrivileged /
-- effectiveUserId / per-row tenant + assignment filters). Idempotent: re-running
-- upserts the same rows.

create table if not exists role_capabilities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  role text not null,
  -- tab visibility
  show_tasks boolean not null default false,
  show_schedule boolean not null default false,
  show_jobs boolean not null default false,
  show_media boolean not null default false,
  show_clock boolean not null default false,
  show_paysheets boolean not null default false,
  show_workorders boolean not null default false,
  show_inbox boolean not null default false,
  show_dashboard boolean not null default false,
  -- feature gates
  can_create_job boolean not null default false,
  can_upload_photos boolean not null default false,
  can_view_pricing boolean not null default false,
  can_issue_pay boolean not null default false,
  -- 'self' | 'team' | 'tenant' | 'all'
  data_scope text not null default 'self',
  updated_at timestamptz not null default now(),
  unique (tenant_id, role)
);

-- Seed Plus Ultra's roles. cols: tasks,sched,jobs,media,clock,pay,wo,inbox,dash, createjob,uploadphoto,viewprice,issuepay, scope
insert into role_capabilities
  (tenant_id, role, show_tasks, show_schedule, show_jobs, show_media, show_clock, show_paysheets, show_workorders, show_inbox, show_dashboard, can_create_job, can_upload_photos, can_view_pricing, can_issue_pay, data_scope)
select t.id, v.role, v.show_tasks, v.show_schedule, v.show_jobs, v.show_media, v.show_clock, v.show_paysheets, v.show_workorders, v.show_inbox, v.show_dashboard, v.can_create_job, v.can_upload_photos, v.can_view_pricing, v.can_issue_pay, v.data_scope
from tenants t
cross join (values
  ('owner',     true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  'all'),
  ('admin',     true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  false, false, 'tenant'),
  ('crew',      true,  true,  true,  true,  true,  false, true,  true,  false, false, true,  false, false, 'self'),
  ('sub',       true,  true,  true,  true,  false, true,  true,  true,  false, false, true,  false, false, 'self'),
  ('installer', false, false, true,  true,  false, false, false, false, false, false, true,  false, false, 'self')
) as v(role, show_tasks, show_schedule, show_jobs, show_media, show_clock, show_paysheets, show_workorders, show_inbox, show_dashboard, can_create_job, can_upload_photos, can_view_pricing, can_issue_pay, data_scope)
where t.slug = 'plus-ultra'
on conflict (tenant_id, role) do update set
  show_tasks=excluded.show_tasks, show_schedule=excluded.show_schedule, show_jobs=excluded.show_jobs,
  show_media=excluded.show_media, show_clock=excluded.show_clock, show_paysheets=excluded.show_paysheets,
  show_workorders=excluded.show_workorders, show_inbox=excluded.show_inbox, show_dashboard=excluded.show_dashboard,
  can_create_job=excluded.can_create_job, can_upload_photos=excluded.can_upload_photos,
  can_view_pricing=excluded.can_view_pricing, can_issue_pay=excluded.can_issue_pay,
  data_scope=excluded.data_scope, updated_at=now();
