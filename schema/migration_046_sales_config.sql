-- Ryujin OS — Migration 046: Sales config column
-- Adds tenant_settings.sales_config (jsonb) for /sales-admin.html persistence.
-- Mirrors migration_044 (marketing_config) and migration_045 (production_config).

alter table tenant_settings
  add column if not exists sales_config jsonb default '{}'::jsonb;
