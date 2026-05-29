-- Ryujin OS - Migration 078: Inbox Agent
--
-- Background: Cat proposed hiring a person (Carl) to watch the inboxes.
-- Instead we are committing to an inbox agent that does the same job:
-- it polls the GHL conversation tab (which already aggregates SMS, FB,
-- Instagram, WhatsApp, web chat and email DMs), reads each NEW inbound
-- message, and triages it with Claude -- one-line summary, category,
-- urgency, a smart NOTIFY decision, and a suggested reply draft.
--
-- The watchdog (api/agents/watchdog.js) already polled conversations and
-- SMS-pinged on ANY unread item. That over-notified. This agent replaces
-- that behaviour with a high-signal gate: an SMS only fires for a genuine
-- ACTIVE LEAK or an ACTIVE LEAD. Everything else is queued silently for
-- review on /inbox.html. The watchdog's conversation block is removed in
-- the same ship so the owner is not double-pinged.
--
-- Nothing sends without human approval: the agent only DRAFTS. The
-- /inbox.html screen + api/inbox.js are where a human approves, edits, or
-- dismisses; the approve action is the only path that calls GHL send.
--
-- Additive only. Re-runnable without error.

-- ─────────────────────────────────────────────────────────────────────
-- 1. inbox_items -- one row per (conversation, inbound-message state)
-- ─────────────────────────────────────────────────────────────────────
-- Identified by (tenant_id, ghl_conversation_id, state_hash). state_hash
-- is derived by the agent from the latest INBOUND message (its id, or its
-- timestamp as fallback) so:
--   * re-running the agent over the same unchanged conversation is
--     idempotent (the unique constraint blocks a duplicate insert), and
--   * a genuinely NEW inbound message produces a NEW state_hash -> a new
--     row, so a customer who follows up resurfaces even if the prior row
--     was dismissed.
-- When a newer state row is inserted for a conversation, the agent flips
-- any older still-pending rows for that same conversation to 'superseded'
-- so the queue only shows the latest unanswered state per conversation.
--
-- channel / category / urgency are open text (not CHECK) so the agent can
-- evolve the taxonomy without a migration -- same approach as
-- job_artifacts.artifact_kind in migration 072. Only `status` is gated,
-- because the lifecycle is controlled by code, not the model.
create table if not exists inbox_items (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  ghl_conversation_id text not null,
  ghl_contact_id      text,
  contact_name        text,
  channel             text not null default 'sms',   -- sms|facebook|instagram|email|whatsapp|webchat|gmb|other
  last_message_body   text,
  last_message_at     timestamptz,
  last_message_id     text,                           -- GHL inbound message id (dedup + 24h window calc)
  state_hash          text not null,                  -- latest inbound message id/time, per conversation

  -- ── triage output (written by api/agents/inbox.js via Claude) ──
  summary             text,
  category            text,                           -- lead|customer|sub|supplier|spam|other
  urgency             text,                           -- emergency|high|normal|low
  notify              boolean not null default false, -- THE gate: true only for active leak OR active lead
  notify_reason       text,                           -- short phrase for the SMS digest
  needs_reply         boolean not null default false,
  draft_reply         text,

  -- ── lifecycle (controlled by code, not the model) ──
  -- 'sending' is a short-lived claim state: api/inbox.js flips needs_review
  -- -> sending (compare-and-set) BEFORE the GHL send call so two concurrent
  -- approve clicks can't double-send; it resets to needs_review on failure or
  -- advances to sent on success.
  status              text not null default 'needs_review'
    check (status in ('needs_review','sending','sent','dismissed','superseded','error')),
  notified_at         timestamptz,                    -- when an SMS digest included this item (null = not pinged)
  sent_at             timestamptz,
  sent_message_id     text,
  sent_body           text,                           -- what actually went out (may differ from draft if edited)
  error               text,
  agent_run_id        uuid references agent_runs(id) on delete set null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, ghl_conversation_id, state_hash)
);

-- Queue read: the screen lists needs_review items newest-first per tenant.
create index if not exists idx_inbox_items_queue
  on inbox_items (tenant_id, status, last_message_at desc);
-- Supersede sweep: find other pending rows for a conversation quickly.
create index if not exists idx_inbox_items_convo
  on inbox_items (tenant_id, ghl_conversation_id, status);
-- Digest gate: which notify=true rows have not been pinged yet.
create index if not exists idx_inbox_items_notify
  on inbox_items (tenant_id, notify, notified_at)
  where notify = true;

-- ─────────────────────────────────────────────────────────────────────
-- 2. updated_at trigger (mirror the job_folders / workorders pattern)
-- ─────────────────────────────────────────────────────────────────────
create or replace function set_inbox_items_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_inbox_items_updated_at on inbox_items;
create trigger trg_inbox_items_updated_at
  before update on inbox_items
  for each row execute function set_inbox_items_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 3. agent_runs slug widening -- add 'inbox'
-- ─────────────────────────────────────────────────────────────────────
-- The inbox agent writes an agent_runs row per scan (slug 'inbox'). Without
-- adding the slug to the CHECK, that insert fails the constraint and the
-- run record silently drops (per feedback_agent_slug_check_constraint --
-- the exact failure mode that bit 'service' in May 2026 and 'inventory' in
-- migration 062). Keep the full allowed list; this only appends 'inbox'.
alter table agent_runs drop constraint if exists agent_runs_agent_slug_check;
alter table agent_runs add constraint agent_runs_agent_slug_check
  check (agent_slug in (
    'sales','marketing','ops','finance','customer','strategy',
    'service','hq','admin','production','inventory','generator','inbox'
  ));

-- ─────────────────────────────────────────────────────────────────────
-- 4. tenant_settings flag -- opt-in per tenant
-- ─────────────────────────────────────────────────────────────────────
-- Default false so the agent only runs for tenants that opt in. Plus Ultra
-- gets flipped true in a follow-up update statement shipped with the
-- feature (not here -- tenant flips belong with their feature ship, same
-- convention as production_agent_enabled in migration 072).
alter table tenant_settings
  add column if not exists inbox_agent_enabled boolean not null default false;
