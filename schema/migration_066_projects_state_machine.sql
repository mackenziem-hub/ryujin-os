-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 066: Project state machine + progress + crew
--
-- Unblocks the Jobs card v2 (mockup tylD4): a LIVE/pulsing pill, a
-- progress bar with %, a row of crew face avatars, Started/Due
-- timestamps, and Start/Pause/Complete state-machine buttons.
--
-- Schema additions:
--   - progress_pct int (0–100) — manual entry by crew lead; later we
--     might compute from completed-tickets ratio.
--   - started_at timestamptz — set when Mac taps Start. Surfaces as
--     "Started 9:14 am" on the card.
--   - crew_members uuid[] — full crew on this job. Display shows up to
--     4 avatars with a "+N" overflow badge. Each entry joins to
--     users.id (and users.avatar_url which already exists in this
--     schema — no migration_067 needed).
--
-- CHECK widening:
--   The existing projects.status CHECK locks values to a 5-state set.
--   The Jobs card v2 adds 'paused' as a sixth state, so the constraint
--   needs widening BEFORE any code writes the new value (per the
--   feedback_agent_slug_check_constraint hard rule).
-- ═══════════════════════════════════════════════════════════════

alter table projects
  add column if not exists progress_pct int check (progress_pct is null or (progress_pct >= 0 and progress_pct <= 100)),
  add column if not exists started_at timestamptz,
  add column if not exists crew_members uuid[] default '{}';

-- Widen the status CHECK to include 'paused'. Drop + recreate is the
-- only path in Postgres for CHECK constraints.
alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check check (
  status in ('not_started', 'active', 'paused', 'punch_list', 'complete', 'cancelled')
);

-- GIN index on crew_members for "show me all projects user X is on"
-- queries that the Jobs filter (Mine) will eventually need. Cheap.
create index if not exists idx_projects_crew_members on projects using gin (crew_members);

-- ─── Backfill: started_at for already-active projects ─────────────
-- Any project currently in 'active' status without a started_at gets
-- updated_at as a best-effort proxy. This keeps the "Started 9:14 am"
-- display from being blank on existing live work.
update projects
   set started_at = updated_at
 where status = 'active'
   and started_at is null;
