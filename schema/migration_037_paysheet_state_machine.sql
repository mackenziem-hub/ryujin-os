-- migration_037_paysheet_state_machine.sql
-- Bible Priority #3 — Paysheet Freeze/Reaccept Flow.
-- Extends migration_035 with full state machine per Bible §5.1.
--
-- New columns:
--   state               — full state machine (extends sub_acceptance_status)
--   version             — bumped on owner edit while accepted
--   superseded_token_at — when prior token was invalidated by owner edit
--   completed_at        — when owner marked job complete (triggers payable)
--   payable_at          — when payment workflow opened
--   paid_at             — when payment cleared
--
-- Backward-compatible: old sub_acceptance_status preserved. New endpoints read
-- `state` first, fall back to old column if state is NULL.

ALTER TABLE paysheets
  ADD COLUMN IF NOT EXISTS state text
    CHECK (state IN (
      'draft',
      'sent',
      'accepted',
      'pending_re_accept',
      'declined',
      'completed_owner_marked',
      'payable',
      'paid'
    )),
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS superseded_token_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payable_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE INDEX IF NOT EXISTS paysheets_state_idx ON paysheets (tenant_id, state);
CREATE INDEX IF NOT EXISTS paysheets_pending_re_accept_idx ON paysheets (tenant_id, state)
  WHERE state = 'pending_re_accept';

-- Backfill: map old sub_acceptance_status → new state
UPDATE paysheets SET state = 'accepted' WHERE state IS NULL AND sub_acceptance_status = 'accepted';
UPDATE paysheets SET state = 'declined' WHERE state IS NULL AND sub_acceptance_status = 'declined';
UPDATE paysheets SET state = 'sent'     WHERE state IS NULL AND sub_acceptance_status = 'pending' AND sub_acceptance_token IS NOT NULL;
UPDATE paysheets SET state = 'draft'    WHERE state IS NULL AND (sub_acceptance_status = 'pending' OR sub_acceptance_status IS NULL) AND sub_acceptance_token IS NULL;

-- State transition audit table
CREATE TABLE IF NOT EXISTS paysheet_state_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paysheet_id   uuid NOT NULL REFERENCES paysheets(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prev_state    text,
  new_state     text NOT NULL,
  triggered_by  text,                                          -- 'sub' | 'owner' | 'system' | 'admin'
  actor_user_id uuid REFERENCES users(id),
  reason        text,
  version_before int,
  version_after  int,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paysheet_state_log_paysheet_idx ON paysheet_state_log (paysheet_id, changed_at DESC);

-- Trigger: write audit row whenever state OR version changes
CREATE OR REPLACE FUNCTION paysheet_log_transition() RETURNS trigger AS $$
BEGIN
  IF (NEW.state IS DISTINCT FROM OLD.state) OR (NEW.version IS DISTINCT FROM OLD.version) THEN
    INSERT INTO paysheet_state_log (paysheet_id, tenant_id, prev_state, new_state, version_before, version_after)
    VALUES (NEW.id, NEW.tenant_id, OLD.state, NEW.state, OLD.version, NEW.version);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS paysheet_state_log_trg ON paysheets;
CREATE TRIGGER paysheet_state_log_trg
  AFTER UPDATE ON paysheets
  FOR EACH ROW EXECUTE FUNCTION paysheet_log_transition();
