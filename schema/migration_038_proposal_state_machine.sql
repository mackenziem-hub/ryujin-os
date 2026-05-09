-- migration_038_proposal_state_machine.sql
-- Bible Priority #4 — Customer Lock-In Flow.
-- Extends estimates table with full state machine per Bible §5.2.
-- Also adds GHL sync drift visibility (gap #9 from Claude audit).
--
-- New columns:
--   state                  — full state machine (proposal_draft → closed_won)
--   approved_at            — when customer clicked Approve
--   rate_hold_expires_at   — 30 days from proposal_sent (Bible: locked at 30 days)
--   rep_call_due_at        — 24 hours from approved_at
--   contract_status        — 'pending' | 'sent' | 'signed' | 'voided'
--   contract_sent_at       — when contract PDF emailed
--   contract_signed_at     — when e-sign returned
--   deposit_status         — 'not_required' (financed) | 'pending' | 'cleared' | 'failed'
--   deposit_amount         — cents
--   deposit_cleared_at     — when Stripe webhook confirmed
--   deposit_payment_intent — Stripe PaymentIntent ID
--   finance_status         — 'not_applicable' | 'pending' | 'approved' | 'declined'
--   finance_provider       — 'financeit' | etc
--   finance_approved_at    — when financing confirmed
--   schedule_due_by        — 3 business days from deposit_cleared_at OR finance_approved_at
--   scheduled_at           — when work order created + on calendar
--   closed_won_at          — terminal success state
--   last_synced_at         — most recent successful GHL sync (gap #9)
--   ghl_sync_status        — 'synced' | 'pending' | 'drifted' | 'error' (gap #9)
--   ghl_sync_error         — last sync error message
--
-- Backward-compatible: old `status` column preserved. New endpoints read `state`,
-- fall back to `status` if `state` is NULL.

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS state text
    CHECK (state IN (
      'proposal_draft',
      'proposal_sent',
      'approved_pending_rep_call',
      'contract_pending',
      'deposit_pending',
      'financing_pending',
      'schedule_pending',
      'scheduled',
      'change_order_pending',
      'closed_won',
      'closed_lost'
    )),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rate_hold_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS rep_call_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_status text
    CHECK (contract_status IN ('pending','sent','signed','voided')),
  ADD COLUMN IF NOT EXISTS contract_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_status text
    CHECK (deposit_status IN ('not_required','pending','cleared','failed')),
  ADD COLUMN IF NOT EXISTS deposit_amount int,
  ADD COLUMN IF NOT EXISTS deposit_cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_payment_intent text,
  ADD COLUMN IF NOT EXISTS finance_status text
    CHECK (finance_status IN ('not_applicable','pending','approved','declined')),
  ADD COLUMN IF NOT EXISTS finance_provider text,
  ADD COLUMN IF NOT EXISTS finance_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_due_by timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_won_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS ghl_sync_status text
    CHECK (ghl_sync_status IN ('synced','pending','drifted','error')),
  ADD COLUMN IF NOT EXISTS ghl_sync_error text;

CREATE INDEX IF NOT EXISTS estimates_state_idx ON estimates (tenant_id, state);
CREATE INDEX IF NOT EXISTS estimates_rep_call_due_idx ON estimates (rep_call_due_at)
  WHERE state = 'approved_pending_rep_call';
CREATE INDEX IF NOT EXISTS estimates_rate_hold_expires_idx ON estimates (rate_hold_expires_at)
  WHERE state = 'proposal_sent';
CREATE INDEX IF NOT EXISTS estimates_schedule_due_idx ON estimates (schedule_due_by)
  WHERE state = 'schedule_pending';
CREATE INDEX IF NOT EXISTS estimates_ghl_drift_idx ON estimates (last_synced_at)
  WHERE ghl_sync_status IN ('drifted','error') OR ghl_opportunity_id IS NOT NULL;

-- Backfill: map old status → new state (conservative)
UPDATE estimates SET state = 'proposal_draft' WHERE state IS NULL AND status = 'draft';
UPDATE estimates SET state = 'proposal_sent'  WHERE state IS NULL AND status IN ('quoted','sent','presented');
UPDATE estimates SET state = 'approved_pending_rep_call' WHERE state IS NULL AND status = 'accepted';
UPDATE estimates SET state = 'closed_won'    WHERE state IS NULL AND status IN ('signed','closed','won');
UPDATE estimates SET state = 'closed_lost'   WHERE state IS NULL AND status IN ('lost','dead','rejected');
UPDATE estimates SET state = 'proposal_draft' WHERE state IS NULL; -- catch-all

-- State transition audit
CREATE TABLE IF NOT EXISTS estimate_state_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id   uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prev_state    text,
  new_state     text NOT NULL,
  triggered_by  text,                                          -- 'customer' | 'rep' | 'system' | 'admin' | 'webhook'
  actor_user_id uuid REFERENCES users(id),
  reason        text,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estimate_state_log_estimate_idx ON estimate_state_log (estimate_id, changed_at DESC);

CREATE OR REPLACE FUNCTION estimate_log_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO estimate_state_log (estimate_id, tenant_id, prev_state, new_state)
    VALUES (NEW.id, NEW.tenant_id, OLD.state, NEW.state);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS estimate_state_log_trg ON estimates;
CREATE TRIGGER estimate_state_log_trg
  AFTER UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION estimate_log_transition();
