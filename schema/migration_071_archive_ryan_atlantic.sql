-- Ryujin OS - Migration 071: Archive Ryan / Atlantic Roofing subcontractor
--
-- Background: The Atlantic Roofing & Contracting Inc. (Ryan) subcontractor
-- arrangement was terminated effective May 18, 2026. Plus Ultra now uses
-- in-house crew (Mac + Diego + AJ + Pavanjot + new hires) instead of subs.
--
-- Numbered 071 because migrations 068 (estimate_photos_category), 069
-- (chat_working_context), and 070 (companycam_archive) already landed on
-- main.
--
-- This migration:
--   1. Adds `archived_at` to subcontractors (soft archive, preserves history)
--   2. Archives the specific Ryan/Atlantic row seeded by migration 016
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

-- 2. Archive the exact Ryan / Atlantic Roofing row that migration 016 seeded.
--    Scoped to the Plus Ultra tenant. Matched on the EXACT company string
--    "Atlantic Roofing & Contracting Inc." (the canonical seed value) so
--    other subs whose name happens to contain "ryan" (e.g. "Bryan ...") or
--    "atlantic" elsewhere in their company string are not touched.
--
--    Sets BOTH archived_at AND active=false so the existing sub-portal
--    magic-link check (which only inspects `active`) immediately starts
--    rejecting any token tied to one of these rows. Defense-in-depth:
--    api/sub-portal.js also gets an explicit `archived_at IS NULL` guard
--    in this same PR so future archive-only writes stay safe even if
--    someone forgets to flip `active` at the same time.
update subcontractors s
  set archived_at = now(),
      active = false
  from tenants t
  where t.id = s.tenant_id
    and t.slug = 'plus-ultra'
    and (
      s.email = 'ryan@atlanticroofing.local'
      or (s.name = 'Ryan' and s.company = 'Atlantic Roofing & Contracting Inc.')
      or s.company = 'Atlantic Roofing & Contracting Inc.'
    )
    and s.archived_at is null;

-- 3. Default supervisor pointer on tenant_settings
alter table tenant_settings
  add column if not exists default_supervisor_user_id uuid references users(id);
