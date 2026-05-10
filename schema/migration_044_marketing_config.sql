-- Ryujin OS — Migration 044: Marketing config column
-- Adds tenant_settings.marketing_config (jsonb) for /marketing-admin.html persistence.

alter table tenant_settings
  add column if not exists marketing_config jsonb default '{}'::jsonb;
