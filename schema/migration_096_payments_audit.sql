-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS - Migration 096: payments audit trail + overhead categories
--
-- Batch B (Finance operator loop), pillar review 2026-06-09.
--
-- 1) payments.updated_at / updated_by - stamped by api/payments.js PATCH
--    on every update (reconcile modal match/unmatch). Who + when, with the
--    previous -> new matched_estimate_id logged to activity_log
--    (entity_type 'payment', action 'matched'/'unmatched'/'updated').
--    updated_by is text, not a users FK, because service-token callers
--    resolve to a synthetic session with no users row ('service').
--
-- 2) tenant_settings.overhead_categories - optional monthly overhead
--    breakdown, jsonb array of { "name": text, "monthly": numeric }.
--    Edited in finance-admin.html; consumed by finance-pl.html, which
--    sums categories (prorated to the period) when at least one has an
--    amount, and falls back to the flat daily_overhead otherwise.
--
-- Idempotent: safe to re-run in any environment.
-- ═══════════════════════════════════════════════════════════════

alter table payments
  add column if not exists updated_at timestamptz;

alter table payments
  add column if not exists updated_by text;

comment on column payments.updated_at is
  'Stamped by api/payments.js PATCH on every update (reconcile match/unmatch).';
comment on column payments.updated_by is
  'Email of the session user who last updated the row, or ''service'' for service-token callers. Text on purpose: not every caller has a users row.';

alter table tenant_settings
  add column if not exists overhead_categories jsonb not null default '[]'::jsonb;

comment on column tenant_settings.overhead_categories is
  'Optional monthly overhead breakdown: [{"name":"Rent","monthly":1200}, ...]. When any category has an amount, the P&L view sums these (prorated to the period) instead of the flat daily_overhead.';
