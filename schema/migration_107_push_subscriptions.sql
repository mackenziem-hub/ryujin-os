-- migration_107_push_subscriptions
--
-- WHY: the field crew app (companion -> field.html) needs true background push so
-- a new task or message dings the phone even when the app is closed/locked. Web
-- Push stores one Push API subscription per device per user. This table holds them,
-- tenant-scoped, keyed by the subscription endpoint (the unique device address).
--
-- Additive only. Idempotent (IF NOT EXISTS). Re-runnable without error.
-- Pairs with the VAPID env vars (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY /
-- VAPID_SUBJECT) read by lib/webpush.js; without those the send path is a no-op,
-- so this table can ship ahead of the keys harmlessly.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- One row per device endpoint (re-subscribing updates rather than duplicates).
create unique index if not exists push_subscriptions_endpoint_uniq on push_subscriptions (endpoint);
create index if not exists push_subscriptions_tenant_user_idx on push_subscriptions (tenant_id, user_id);
