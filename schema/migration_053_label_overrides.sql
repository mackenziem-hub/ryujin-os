-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 053: Label overrides
--
-- Per-tenant rename of any UI label. Operators can change "Pipeline
-- Value" → "Deal Flow" or "Customer" → "Client" to match their own
-- vocabulary. White-label feel without a full layout builder.
--
-- Read path: lib/labels.js getLabel(tenantSettings, key, fallback).
-- Write path: PATCH /api/settings { label_overrides: { <key>: <new> } }.
--
-- Canonical key format: <pillar>.<scope>.<id>
--   sales.kpi.pipeline_value
--   customer.action.send_review
--   service.tile.callbacks_open
--
-- Phase MA of the 3-mode architecture refactor (advanced-mode polish).
-- ═══════════════════════════════════════════════════════════════

alter table tenant_settings
  add column if not exists label_overrides jsonb not null default '{}'::jsonb;

comment on column tenant_settings.label_overrides is
  'Per-tenant UI label overrides. Keyed by canonical <pillar>.<scope>.<id>. Read via lib/labels.js. Operator-editable in advanced mode.';
