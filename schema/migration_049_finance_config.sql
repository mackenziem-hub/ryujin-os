-- Ryujin OS — Migration 049: Finance config column
-- Adds tenant_settings.finance_config jsonb for /finance-admin.html persistence.
-- No new tables — Finance panel reads from existing payments + paysheets +
-- estimates + scheduled_posts. P&L / cashflow / AR/AP all derived.
alter table tenant_settings
  add column if not exists finance_config jsonb default '{}'::jsonb;
