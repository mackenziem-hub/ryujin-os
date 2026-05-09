-- Migration 033 — link Ryujin estimates to GHL estimates
-- Adds ghl_estimate_id column so we know which Ryujin estimates have been
-- pushed to GHL Payments → Estimates, and can prevent duplicate pushes.

alter table estimates
  add column if not exists ghl_estimate_id text,
  add column if not exists ghl_estimate_synced_at timestamptz;

create index if not exists idx_estimates_ghl_estimate on estimates(ghl_estimate_id);

comment on column estimates.ghl_estimate_id is 'GHL Payments → Estimates _id (set by /api/estimates/sync-to-ghl). Null = not synced.';
comment on column estimates.ghl_estimate_synced_at is 'Timestamp of last successful sync to GHL.';
