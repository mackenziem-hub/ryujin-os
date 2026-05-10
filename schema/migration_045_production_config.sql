-- Ryujin OS — Migration 045: Production config column
-- Adds tenant_settings.production_config (jsonb) for /production-admin.html persistence.
-- Mirrors migration_044 pattern.

alter table tenant_settings
  add column if not exists production_config jsonb default '{}'::jsonb;
