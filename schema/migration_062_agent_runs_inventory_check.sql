-- migration_062_agent_runs_inventory_check
--
-- The agent_runs.agent_slug CHECK constraint was widened in migration_057
-- to include service/hq/admin/production. Adding `inventory` for the 9th
-- canonical pillar (Materials) shipping in Phase 2 of the IA roadmap
-- (.claude/plans/let-s-break-this-down-majestic-avalanche.md).
--
-- Without this, every cron-daily inventory_scan row would silently drop
-- via CHECK violation — same failure mode that bit us with `service`
-- in May 2026 (commit 02b0abb / migration_057 backstory).
--
-- Idempotent: drops the named constraint if present, re-adds with the
-- expanded set. Preserves all existing slugs.

alter table agent_runs drop constraint if exists agent_runs_agent_slug_check;
alter table agent_runs add constraint agent_runs_agent_slug_check
  check (agent_slug in (
    'sales','marketing','ops','finance','customer','strategy',
    'service','hq','admin','production','inventory'
  ));
