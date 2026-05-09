-- Ryujin OS — Migration 041: Admin Core (HQ rebuild Phase B.1)
--
-- The "single pane of glass" admin layer per the May 9 2026 plan.
-- Five tables that power: Quest Board, KPI Scouter, XP/Power Level,
-- Archetypal Agent reports, Morning Briefing.
--
-- Per-user filtering via assigned_to / for_user_id — Mac, Catherine,
-- and Darcy each see their own queue. Catherine (EA) gets all-access
-- via API-layer policy, not row-level: she can VIEW any user's queue
-- but her *own* delegated work shows up under her assigned_to.
--
-- Tenant isolation enforced by API layer (requireTenant middleware),
-- consistent with migrations 026/028/038. No Postgres RLS.

-- ─── QUESTS ─────────────────────────────────────────────────
-- Both human-assigned (Mac creates a quest for Darcy) and agent-emitted
-- (sales_scan flags a follow-up gap → quest with source_agent='sales').
create table if not exists quests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  assigned_to     uuid references users(id) on delete set null,  -- nullable = unassigned/anyone
  category        text not null check (category in (
                    'sales','marketing','ops','finance','customer','strategy','personal'
                  )),
  type            text not null check (type in ('daily','campaign','optional')),
  title           text not null,
  description     text,
  xp_reward       int not null default 10,
  status          text not null default 'open' check (status in (
                    'open','in_progress','completed','skipped','expired'
                  )),
  source_agent    text,                   -- sales|marketing|ops|finance|customer|strategy|null=manual
  source_id       uuid,                   -- correlate to agent_runs.id when agent-emitted
  metadata        jsonb default '{}'::jsonb,  -- arbitrary structured payload (links, refs, params)
  due_at          timestamptz,
  completed_at    timestamptz,
  completed_by    uuid references users(id),
  created_at      timestamptz not null default now(),
  created_by      uuid references users(id)
);

create index if not exists quests_tenant_user_status
  on quests (tenant_id, assigned_to, status, due_at);
create index if not exists quests_tenant_type_created
  on quests (tenant_id, type, created_at desc);
create index if not exists quests_source
  on quests (tenant_id, source_agent, source_id) where source_agent is not null;

-- ─── KPIS ───────────────────────────────────────────────────
-- Click-to-update tiles. Each KPI is owned by a tenant + identified by `key`.
-- `value` is text so it can hold currency/percent/count without coercing.
-- Targets and sort order let the overview page render them in a curated grid.
create table if not exists kpis (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  key               text not null,
  label             text not null,
  value             text,
  unit              text,                  -- '$' | '%' | 'count' | 'days' | etc
  target            text,
  trend             text check (trend in ('up','down','flat')),
  trend_pct         numeric,
  sort_order        int not null default 100,
  source_agent      text,                  -- which agent last updated it
  last_updated_at   timestamptz default now(),
  last_updated_by   uuid references users(id),
  metadata          jsonb default '{}'::jsonb,
  unique (tenant_id, key)
);

create index if not exists kpis_tenant_sort on kpis (tenant_id, sort_order);

-- ─── XP_LEDGER ──────────────────────────────────────────────
-- Append-only ledger. Power Level is computed by sum(xp) per user.
create table if not exists xp_ledger (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  source_type  text not null check (source_type in (
                 'quest','achievement','manual','dragon_challenge'
               )),
  source_id    uuid,                       -- quest.id or achievement.id, optional
  xp           int not null,               -- positive = earned, negative = correction
  note         text,
  awarded_at   timestamptz not null default now()
);

create index if not exists xp_ledger_tenant_user_awarded
  on xp_ledger (tenant_id, user_id, awarded_at desc);

-- ─── AGENT_RUNS ─────────────────────────────────────────────
-- Audit log + report storage for the daily archetypal agent scans.
-- Each scan run writes one row. The output_jsonb holds the structured
-- report (findings, deltas, recommendations) that agent-cards render.
create table if not exists agent_runs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  agent_slug      text not null check (agent_slug in (
                    'sales','marketing','ops','finance','customer','strategy'
                  )),
  trigger         text not null check (trigger in ('cron_daily','manual','api')),
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  status          text not null default 'running' check (status in (
                    'running','success','partial','error'
                  )),
  summary         text,
  output          jsonb default '{}'::jsonb,  -- full structured report
  emitted_quests  int default 0,
  emitted_kpis    int default 0,
  emitted_briefs  int default 0,
  error_message   text,
  duration_ms     int
);

create index if not exists agent_runs_tenant_agent_started
  on agent_runs (tenant_id, agent_slug, started_at desc);
create index if not exists agent_runs_tenant_started
  on agent_runs (tenant_id, started_at desc);

-- ─── BRIEFING_ITEMS ─────────────────────────────────────────
-- Morning Briefing feed. Items appear at the top of admin-overview
-- on their `for_date`, grouped by priority. Auto-expire after 7 days
-- if not dismissed (handled by API layer, not a trigger).
create table if not exists briefing_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  for_user_id   uuid references users(id) on delete cascade,  -- null = all-hands briefing
  for_date      date not null default current_date,
  priority      text not null default 'normal' check (priority in (
                  'urgent','high','normal'
                )),
  title         text not null,
  body          text,
  cta_label     text,                       -- 'View quest' | 'Open report' | etc
  cta_href      text,
  source_agent  text,
  source_id     uuid,
  metadata      jsonb default '{}'::jsonb,
  dismissed_at  timestamptz,
  dismissed_by  uuid references users(id),
  created_at    timestamptz not null default now()
);

create index if not exists briefing_tenant_user_date
  on briefing_items (tenant_id, for_user_id, for_date desc, priority);
create index if not exists briefing_tenant_date_open
  on briefing_items (tenant_id, for_date desc) where dismissed_at is null;
