-- Ryujin OS - Migration 093: Inbox sub-portal source + workorder measurement method
--
-- Two additive changes, both re-runnable without error.
--
-- 1) inbox_items can now hold items that did NOT come from GHL.
--    The inbox agent (api/agents/inbox.js) polls GHL conversations, but Ryan
--    (and any sub) also sends topic-routed questions from the sub portal that
--    land only in the `messages` table -> they never reached /inbox.html. This
--    migration lets the agent bridge those threads into the same review queue
--    so the inbox is the single pane for "someone needs you," GHL or not.
--
--    * source        : provenance ('ghl' | 'sub_portal'); defaults 'ghl' so
--                      every existing row keeps its meaning.
--    * ghl_conversation_id is made NULLABLE (a sub message has no GHL convo).
--    * ref_table / ref_id : loose pointer to the source row, e.g.
--                      ('message_thread', <messages.thread_id>), so the UI can
--                      deep-link to the real thread and the bridge stays
--                      idempotent.
--    * sub_id        : which subcontractor, when source='sub_portal'.
--
--    Idempotency for bridged rows: the existing unique
--    (tenant_id, ghl_conversation_id, state_hash) does NOT dedup sub rows
--    because ghl_conversation_id is NULL and Postgres treats NULLs as
--    distinct in a UNIQUE. A separate PARTIAL unique index on
--    (tenant_id, ref_table, ref_id) guarantees one inbox item per source row.
--
-- 2) workorders.measurement_method records HOW the roof was measured
--    (eagleview | satellite | hand_takeoff | other). Open text (not a CHECK)
--    so the taxonomy can evolve without a migration, same convention as
--    inbox_items.channel / job_artifacts.artifact_kind. Surfaced to the sub in
--    the new measurements section + on the paysheet ("Measured via EagleView").
--    When null, the app infers EagleView from a present eagleview report/doc.

-- ─────────────────────────────────────────────────────────────────────
-- 1. inbox_items: non-GHL source support
-- ─────────────────────────────────────────────────────────────────────
alter table inbox_items
  add column if not exists source    text not null default 'ghl',  -- ghl|sub_portal
  add column if not exists ref_table text,                          -- e.g. 'message_thread'
  add column if not exists ref_id    uuid,                          -- e.g. messages.thread_id
  add column if not exists sub_id    uuid;                          -- subcontractors.id when sub_portal

-- A sub message has no GHL conversation id.
alter table inbox_items alter column ghl_conversation_id drop not null;

-- One inbox item per source row (bridge idempotency + race backstop).
create unique index if not exists idx_inbox_items_ref_unique
  on inbox_items (tenant_id, ref_table, ref_id)
  where ref_id is not null;

-- Queue filter by source (e.g. "show only sub messages").
create index if not exists idx_inbox_items_source
  on inbox_items (tenant_id, source, status);

-- ─────────────────────────────────────────────────────────────────────
-- 2. workorders: how the roof was measured + deliverable check-off map
-- ─────────────────────────────────────────────────────────────────────
alter table workorders
  add column if not exists measurement_method text;  -- eagleview|satellite|hand_takeoff|other

-- Deliverable check-off, kept SEPARATE from the `checklist` array on purpose:
-- the sub portal derives the four photo-gate deliverables by fuzzy-matching
-- checklist task text, so writing synthetic deliverable rows INTO checklist
-- would (a) cross-match other photo deliverables and (b) inflate progress
-- counts. A dedicated { deliverable_key: bool } map keeps the manual toggle
-- honest without touching checklist semantics.
alter table workorders
  add column if not exists deliverables jsonb not null default '{}'::jsonb;
