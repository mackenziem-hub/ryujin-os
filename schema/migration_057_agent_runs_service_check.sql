-- migration_057_agent_runs_service_check
--
-- The agent_runs.agent_slug CHECK constraint shipped in migration_041
-- only allowed the original 6 agents. When the dedicated `service` agent
-- landed (commit 02b0abb, May 10 2026) every cron-daily run silently
-- dropped its row — and so did the matching error-row insert — so AJ's
-- service portal was empty and the portal then fell back to showing all
-- briefing items from all agents (cross-contamination).
--
-- Widen the constraint to include `service` (immediate need) plus
-- `hq`, `admin`, and `production` (forward-compat for the planned
-- agent rename: ops→production, strategy→hq, + new admin agent).
--
-- Idempotent: drops the named constraint if present, re-adds with the
-- expanded set.

alter table agent_runs drop constraint if exists agent_runs_agent_slug_check;
alter table agent_runs add constraint agent_runs_agent_slug_check
  check (agent_slug in (
    'sales','marketing','ops','finance','customer','strategy',
    'service','hq','admin','production'
  ));
