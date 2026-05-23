-- Ryujin OS - Migration 068: Archive Ryan / Atlantic Roofing subcontractor
--
-- Background: The Atlantic Roofing & Contracting Inc. (Ryan) subcontractor
-- arrangement was terminated effective May 18, 2026. Plus Ultra now uses
-- in-house crew (Mac + Diego + AJ + Pavanjot + new hires) instead of subs.
--
-- This migration:
--   1. Adds `archived_at` to subcontractors (soft archive, preserves history)
--   2. Marks Ryan / Atlantic rows as archived (idempotent)
--   3. Adds tenant_settings.default_supervisor_user_id so api/sub-portal.js
--      no longer hardcodes AJ as supervisor
--
-- Additive only. Re-runnable without error. Does not touch existing paysheets
-- or workorder rows - their `sub_crew_lead` text and `subcontractor_id` FK
-- stay intact for audit history.

-- 1. Soft-archive column on subcontractors
alter table subcontractors
  add column if not exists archived_at timestamptz;

create index if not exists idx_subcontractors_archived_at
  on subcontractors(archived_at);

-- 2. Archive Ryan / Atlantic rows (idempotent)
update subcontractors
  set archived_at = now()
  where (
    name ilike '%ryan%'
    or name ilike '%atlantic roofing%'
    or company ilike '%atlantic roofing%'
  )
  and archived_at is null;

-- 3. Default supervisor pointer on tenant_settings
alter table tenant_settings
  add column if not exists default_supervisor_user_id uuid references users(id);
