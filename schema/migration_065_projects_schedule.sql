-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 065: Project scheduling + crew lead
--
-- The mobile portal needs a real "today + this week" dispatch list
-- (ServiceTitan model) where each card is a scheduled job. Today the
-- portal hits /api/tickets which is the wrong layer — tickets are full
-- of admin/operational items with no customer link.
--
-- This migration adds the missing scheduling columns to `projects` so
-- a future /api/schedule endpoint can return "what's on the books for
-- the next 7 days" sorted by scheduled_start.
--
-- crew_lead_id is who's running the job on-site (Diego, Arielle, etc.)
-- so the mobile portal can filter the dispatch list per-crew-member.
-- ═══════════════════════════════════════════════════════════════

alter table projects
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end timestamptz,
  add column if not exists crew_lead_id uuid references users(id) on delete set null;

create index if not exists idx_projects_scheduled
  on projects (tenant_id, scheduled_start)
  where scheduled_start is not null;

create index if not exists idx_projects_crew_lead
  on projects (crew_lead_id)
  where crew_lead_id is not null;
