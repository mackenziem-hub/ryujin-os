-- Ryujin OS — Migration 048: Customer config column
-- Adds tenant_settings.customer_config (jsonb) for /customer-admin.html persistence.
alter table tenant_settings
  add column if not exists customer_config jsonb default '{}'::jsonb;
