-- migration_040_state_extensions.sql
-- Extends paysheet + estimate state CHECK constraints per Manus peer review
-- May 9 2026 §1.1 + §1.2:
--
--   paysheets.state += 'cancelled'
--     Per review: draft → declined is semantically wrong (declined is a
--     sub-facing decision verb). Use 'cancelled' for owner-side abandonment
--     of a draft.
--
--   estimates.state += 'proposal_expired'
--     Per review: rate-hold-expired proposal currently stays in proposal_sent
--     while briefing flags expired_rate_hold. State should reflect commercial
--     reality: stale proposal is no longer an ordinary sent proposal.
--     Allows proposal_sent → proposal_expired (auto via cron or manual)
--     and proposal_expired → proposal_sent (re-issue via owner action).

-- ── Paysheet: add cancelled ────────────────────────────────────────────
ALTER TABLE paysheets DROP CONSTRAINT IF EXISTS paysheets_state_check;
ALTER TABLE paysheets ADD CONSTRAINT paysheets_state_check
  CHECK (state IN (
    'draft',
    'sent',
    'accepted',
    'pending_re_accept',
    'declined',
    'cancelled',
    'completed_owner_marked',
    'payable',
    'paid'
  ));

-- ── Estimates: add proposal_expired ────────────────────────────────────
ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_state_check;
ALTER TABLE estimates ADD CONSTRAINT estimates_state_check
  CHECK (state IN (
    'proposal_draft',
    'proposal_sent',
    'proposal_expired',
    'approved_pending_rep_call',
    'contract_pending',
    'deposit_pending',
    'financing_pending',
    'schedule_pending',
    'scheduled',
    'change_order_pending',
    'closed_won',
    'closed_lost'
  ));

-- ── Index for proposal_expired surfacing in cockpit ────────────────────
CREATE INDEX IF NOT EXISTS estimates_state_expired_idx ON estimates (tenant_id, state)
  WHERE state = 'proposal_expired';
