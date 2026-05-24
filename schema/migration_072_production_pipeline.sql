-- Ryujin OS - Migration 072: Production Pipeline Agent foundation
--
-- Background: As of 2026-05-23, Plus Ultra is between concrete tickboard
-- systems. The `tickets` table has gone dormant (May snapshot showed 35
-- abandoned April checklist items on completed WOs). The canonical record
-- of job state lives in three places:
--   1. Local OneDrive vault: Plus Ultra/Jobs/<street>/ (Mac authors here)
--   2. Google Drive: Cat creates per-job folders so Mac can see them
--   3. GHL CRM: invoices + contact-note threads
--
-- This migration lays the foundation for a Production Pipeline Agent
-- (slug 'production', already allowed by migration 057's agent_runs CHECK)
-- that reads all three sources, derives each job's pipeline stage from
-- artifacts (warranty PDF = completed, work order PDF = scheduled, etc.),
-- and surfaces stage-transition SUGGESTIONS for human confirmation.
--
-- Three new tables:
--   * job_folders         -- one row per job (canonical, identified by address)
--   * job_artifacts       -- every artifact discovered across sources, deduped
--   * pipeline_suggestions -- agent-emitted stage proposals awaiting confirmation
--
-- Additive only. Re-runnable without error. Does not touch tickets,
-- workorders, estimates, or any existing tables.

-- ─────────────────────────────────────────────────────────────────────
-- 1. job_folders -- canonical row per job
-- ─────────────────────────────────────────────────────────────────────
-- One row per real-world job. Identified by `address` within tenant.
-- Optional FKs link the job back to whatever Ryujin records the same job
-- under (estimates, workorders, ghl contact). All optional because a job
-- folder can exist in OneDrive before an estimate is ever written.
create table if not exists job_folders (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  address             text not null,                     -- raw display form, e.g. "178 Summerhill Dr"
  address_key         text not null,                     -- normalized for dedup (see below)
  customer_name       text,
  linked_estimate_id  uuid references estimates(id) on delete set null,
  linked_workorder_id uuid references workorders(id) on delete set null,
  linked_ghl_contact_id text,
  linked_drive_folder_id text,
  current_stage       text not null default 'unknown'
    check (current_stage in (
      'unknown','prospect','proposal_sent','accepted',
      'scheduled','in_progress','completed','paid','lost','cold'
    )),
  stage_confirmed_at  timestamptz,
  stage_confirmed_by  uuid references users(id) on delete set null,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, address_key)
);

-- address_key normalization (canonical for dedup across sources):
-- - lowercase
-- - collapse whitespace to single space
-- - strip leading/trailing whitespace
-- - strip common street-type suffixes (dr/drive, st/street, ave/avenue,
--   rd/road, ct/court, cres/crescent, ln/lane, blvd, way, pl/place, hwy)
-- - strip trailing city/province/postal noise (everything from first
--   comma onward)
-- Performed by the agent in api/agents/production.js so the rule can
-- evolve without a migration. The schema only requires uniqueness on
-- whatever the agent writes. Example: "178 Summerhill Drive, Moncton, NB"
-- and "178 Summerhill Dr" both normalize to "178 summerhill".

create index if not exists idx_job_folders_tenant_stage
  on job_folders (tenant_id, current_stage);
create index if not exists idx_job_folders_estimate
  on job_folders (linked_estimate_id) where linked_estimate_id is not null;
create index if not exists idx_job_folders_workorder
  on job_folders (linked_workorder_id) where linked_workorder_id is not null;
create index if not exists idx_job_folders_drive
  on job_folders (linked_drive_folder_id) where linked_drive_folder_id is not null;

-- ─────────────────────────────────────────────────────────────────────
-- 2. job_artifacts -- every discovered file / message / record
-- ─────────────────────────────────────────────────────────────────────
-- One row per detected artifact across all sources. Deduped on
-- (tenant_id, source, source_path) so re-runs are idempotent. The agent's
-- stage-derivation reads from this table rather than re-walking sources
-- on every reasoning pass.
--
-- `artifact_kind` is open-ended text (not a CHECK) so the agent can
-- introduce new kinds without a migration. Known canonical values:
--   cover_photo, before_photo, proposal, contract, eagleview,
--   measurements, work_order, paysheet, install_photo, warranty,
--   invoice, payment_receipt, transcript, summary_note, contact_note,
--   sms_thread, call_recording, other
create table if not exists job_artifacts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  job_folder_id uuid not null references job_folders(id) on delete cascade,
  source        text not null check (source in ('onedrive','drive','ghl','obsidian','ryujin')),
  source_path   text not null,
  artifact_kind text not null default 'other',
  file_name     text,
  mtime         timestamptz,
  detected_at   timestamptz not null default now(),
  raw_meta      jsonb not null default '{}'::jsonb,
  unique (tenant_id, source, source_path)
);

create index if not exists idx_job_artifacts_folder
  on job_artifacts (job_folder_id, mtime desc nulls last);
create index if not exists idx_job_artifacts_kind
  on job_artifacts (tenant_id, artifact_kind);

-- ─────────────────────────────────────────────────────────────────────
-- 3. pipeline_suggestions -- agent-proposed stage transitions
-- ─────────────────────────────────────────────────────────────────────
-- Every time the production agent thinks a job's stage should change,
-- it writes a row here. The cockpit surfaces pending rows as prompts
-- ("I think 178 Summerhill is COMPLETED because warranty PDF dated
-- 4/23 + paysheet present. Confirm?"). Human confirms, corrects, or
-- dismisses; outcome is logged on the same row.
--
-- `evidence` is jsonb so the agent can attach a list of artifact ids
-- + free-text reasoning bullets. Keep this rich -- it's the audit trail
-- for why the suggestion was made + how the agent learns priors.
create table if not exists pipeline_suggestions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  job_folder_id    uuid not null references job_folders(id) on delete cascade,
  previous_stage   text,
  suggested_stage  text not null
    check (suggested_stage in (
      'unknown','prospect','proposal_sent','accepted',
      'scheduled','in_progress','completed','paid','lost','cold'
    )),
  reasoning        text not null,
  evidence         jsonb not null default '[]'::jsonb,
  agent_run_id     uuid references agent_runs(id) on delete set null,
  status           text not null default 'pending'
    check (status in ('pending','confirmed','corrected','dismissed','expired')),
  confirmed_stage  text,
  resolved_at      timestamptz,
  resolved_by      uuid references users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_pipeline_suggestions_pending
  on pipeline_suggestions (tenant_id, created_at desc)
  where status = 'pending';
create index if not exists idx_pipeline_suggestions_job
  on pipeline_suggestions (job_folder_id, created_at desc);

-- Concurrent-run dedup. Two cron / manual invocations of the production
-- agent can race past the app-side "skip if pending exists" check and
-- both insert. A partial UNIQUE on (job_folder_id, suggested_stage)
-- WHERE status='pending' blocks the second insert at the DB level. Once
-- the human resolves the suggestion (status flips out of 'pending'),
-- the constraint allows a new pending row for that folder/stage pair.
create unique index if not exists uq_pipeline_suggestions_pending_dedup
  on pipeline_suggestions (job_folder_id, suggested_stage)
  where status = 'pending';

-- ─────────────────────────────────────────────────────────────────────
-- 4. updated_at trigger on job_folders (mirror the workorders pattern)
-- ─────────────────────────────────────────────────────────────────────
create or replace function set_job_folders_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_job_folders_updated_at on job_folders;
create trigger trg_job_folders_updated_at
  before update on job_folders
  for each row execute function set_job_folders_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 5. tenant_settings flag -- opt-in for the production agent per tenant
-- ─────────────────────────────────────────────────────────────────────
-- Default false so the agent only runs once a tenant explicitly opts in.
-- Plus Ultra gets flipped to true in a follow-up update statement (NOT
-- in this migration, since tenant flips belong with their feature ship).
alter table tenant_settings
  add column if not exists production_agent_enabled boolean not null default false;
