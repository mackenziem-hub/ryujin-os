-- ═══════════════════════════════════════════════════════════════
-- Migration 100 · tenant_settings.production_assistant_day_rate
--
-- Optional extra-crew labor rate. The quote engine (lib/quoteEngineV3.js) prices
-- a production assistant only when measurements.productionAssistantDays > 0, at
-- this day rate. The engine code defaults to $115 when the column is absent, so
-- quoting works with or without this migration applied; the column just makes the
-- rate tenant-tunable and surfaces it in the pricing admin.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS production_assistant_day_rate NUMERIC;

-- Seed the Plus Ultra default (matches the engine code default of 115).
UPDATE tenant_settings
  SET production_assistant_day_rate = 115
  WHERE production_assistant_day_rate IS NULL;
