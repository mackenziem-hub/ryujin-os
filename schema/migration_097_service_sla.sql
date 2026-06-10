-- Ryujin OS - Migration 097: Service SLA activation
--
-- Adds service_tickets.acknowledged_at so the service scan agent
-- (lib/agents/service_scan.js) can flag tickets that sit unacknowledged
-- past the tenant's ack SLA. The SLA hours themselves live in
-- tenant_settings.service_config.sla (saved by /service-admin.html via
-- /api/settings); this column is the timestamp side of that loop.
--
-- Applied by hand via the Supabase Management API. Idempotent.

alter table service_tickets
  add column if not exists acknowledged_at timestamptz;

-- Partial index keeps the scan agent's "open + unacknowledged" sweep cheap.
create index if not exists service_tickets_unacked
  on service_tickets (tenant_id, reported_at)
  where acknowledged_at is null and status = 'open';
