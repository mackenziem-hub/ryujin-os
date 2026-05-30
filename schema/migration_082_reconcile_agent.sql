-- Ryujin OS - Migration 082: Reconciliation agent
--
-- The reconciliation agent (api/agents/reconcile.js) cross-checks committed /
-- delivered revenue across the systems that each hold a piece of the same job
-- (estimates = contract price, workorders + paysheets = delivery + sub cost,
-- customers). It surfaces the drift the cockpit was blind to: signed jobs with
-- no contract value recorded, subcontractor costs typed in as the customer
-- price, accepted estimates with a null total, and delivered jobs with no
-- estimate at all. Logic lives in lib/reconcile.js (pure, unit-tested); this
-- migration adds the storage + the dormant opt-in flag.
--
-- Additive only. Re-runnable without error.

-- 1. agent_runs slug widening - add 'reconcile'. A missing slug silently drops
--    the run row (feedback_agent_slug_check_constraint), so this is the full
--    current allowed list (per migration 080) plus reconcile.
alter table agent_runs drop constraint if exists agent_runs_agent_slug_check;
alter table agent_runs add constraint agent_runs_agent_slug_check
  check (agent_slug in (
    'sales','marketing','ops','finance','customer','strategy',
    'service','hq','admin','production','inventory','generator','inbox','questscan','reconcile'
  ));

-- 2. Opt-in flag, dormant by default (same convention as questscan_agent_enabled).
--    Plus Ultra flips it true with the feature ship; until then the cron is a
--    safe no-op and the agent only runs via ?dry=1 preview.
alter table tenant_settings
  add column if not exists reconcile_agent_enabled boolean not null default false;

-- 3. Optional per-tenant tuning (sub-labor ratio band for the estimate, owner
--    user id for fix assignment). Empty default = engine uses its baked-in 0.62.
alter table tenant_settings
  add column if not exists reconcile_config jsonb not null default '{}'::jsonb;

-- 4. Findings store. One row per (tenant, dedup_key); the agent upserts on each
--    run and auto-resolves findings whose condition has cleared.
create table if not exists reconciliation_findings (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  dedup_key     text not null,                 -- kind:estimate_id | kind:normalized-job
  kind          text not null,                 -- NO_ESTIMATE | ACCEPTED_NULL_TOTAL | VALUE_LOOKS_LIKE_COST | ACCEPTED_NO_TIMESTAMP | JOIN_CONFLICT
  job           text,                          -- human label (customer / address)
  detail        text,                          -- what is wrong
  proposed_fix  text,                          -- the one-tap fix description
  dollar_impact numeric,                       -- known $ impact (sub-cost floor or contract), null if hygiene
  estimate_id   uuid,                          -- target estimate when the fix edits one
  status        text not null default 'open'   -- open | resolved | dismissed
                  check (status in ('open','resolved','dismissed')),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  unique (tenant_id, dedup_key)
);

create index if not exists idx_reconcile_findings_open
  on reconciliation_findings (tenant_id, status)
  where status = 'open';
