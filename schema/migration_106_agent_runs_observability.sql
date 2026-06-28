-- migration_106_agent_runs_observability
--
-- WHY: the agents that produce the owner's daily intelligence -- briefing,
-- daily, weekly, watchdog, heartbeat, cashflow, memory, cron-daily, peer-audit
-- -- were never in the agent_runs.agent_slug CHECK list (last set in
-- migration_082). They write only to snapshot sections, never to agent_runs,
-- so a health check sees zero rows for them and silent degradation (a dead
-- calendar auth, a thin brief, a failed snapshot read) never surfaces. Nothing
-- watched the watchers. lib/agents/logAgentRun.js now logs a run row for each;
-- this widens the CHECK first so those inserts do not silently drop (the exact
-- feedback_agent_slug_check_constraint failure that bit 'service' in May 2026,
-- 'inventory' in 062, 'inbox' in 078, 'reconcile' in 082).
--
-- Additive only. Idempotent: drops the named constraint if present, re-adds
-- with the full migration_082 list PLUS the 9 intelligence-agent slugs.
-- Re-runnable without error. Preserves every existing slug.

alter table agent_runs drop constraint if exists agent_runs_agent_slug_check;
alter table agent_runs add constraint agent_runs_agent_slug_check
  check (agent_slug in (
    'sales','marketing','ops','finance','customer','strategy',
    'service','hq','admin','production','inventory','generator','inbox','questscan','reconcile',
    'briefing','daily','weekly','watchdog','heartbeat','cashflow','memory','cron-daily','peer-audit'
  ));
