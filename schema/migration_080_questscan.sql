-- Ryujin OS - Migration 080: Quest Scanner agent
--
-- The daily quest-scanner (api/agents/questscan.js) reads live business state
-- (stale proposals, accepted-but-unscheduled jobs, completed jobs with no
-- invoice, overdue receivables, stale leads) and emits assigned, deduped,
-- auto-expiring quests onto the admin Quest Board (source_agent='questscan').
-- This is the "daily agent scan populates each person's to-dos" engine the
-- single-pane doctrine assumed but never actually had.
--
-- Additive only. Re-runnable without error.

-- 1. agent_runs slug widening - add 'questscan'. A missing slug silently drops
--    the run row (per feedback_agent_slug_check_constraint), so this is the full
--    current allowed list plus questscan.
alter table agent_runs drop constraint if exists agent_runs_agent_slug_check;
alter table agent_runs add constraint agent_runs_agent_slug_check
  check (agent_slug in (
    'sales','marketing','ops','finance','customer','strategy',
    'service','hq','admin','production','inventory','generator','inbox','questscan'
  ));

-- 2. Opt-in flag, dormant by default (same convention as production_agent_enabled
--    / inbox_agent_enabled). Plus Ultra flips it true with the feature ship, not
--    here, so the daily cron is a safe no-op until deliberately switched on.
alter table tenant_settings
  add column if not exists questscan_agent_enabled boolean not null default false;

-- 3. Optional per-tenant assignee overrides. jsonb shape:
--    { "sales_user_id": "<uuid>", "scheduler_user_id": "<uuid>", "finance_user_id": "<uuid>" }
--    When a key is unset the agent resolves the owner for sales work and
--    best-effort name/email-matches the scheduler (Catherine) + finance (Melodie),
--    and if it still cannot resolve a person it leaves the quest unassigned
--    (unassigned quests are visible to everyone on the board).
alter table tenant_settings
  add column if not exists questscan_config jsonb not null default '{}'::jsonb;

-- 4. Partial index for the dedup + auto-expire sweeps (only the agent's own rows).
create index if not exists idx_quests_questscan
  on quests (tenant_id, status)
  where source_agent = 'questscan';
