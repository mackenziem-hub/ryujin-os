// lib/state.js
// State machine helpers for Ryujin per Interface Bible §5.
//
// Two state machines defined here:
//   1. PAYSHEET_STATE  — sub paysheet lifecycle (Bible §5.1)
//   2. ESTIMATE_STATE  — customer proposal lifecycle (Bible §5.2)
//
// Plus a CHANGE_ORDER_STATUS map for completeness.
//
// Use `canTransition(machine, from, to)` before any update. Use
// `nextStates(machine, from)` to render UI options. Use `assertTransition`
// to throw if the transition is illegal.
//
// Single source of truth — endpoints + UI both read from here.

// ────────────────────────────────────────────────────────────────────────
// PAYSHEET STATE MACHINE (Bible §5.1)
// ────────────────────────────────────────────────────────────────────────

export const PAYSHEET_STATES = Object.freeze([
  'draft',
  'sent',
  'accepted',
  'pending_re_accept',
  'declined',
  'cancelled',                                                            // owner-side abandonment (Manus peer review §1.1)
  'completed_owner_marked',
  'payable',
  'paid'
]);

// Manus peer review §1.1 hard rules:
//   - 'declined' is a sub-facing verb. Owner-side abandonment uses 'cancelled'.
//   - sent → draft requires endpoint to revoke the public token. Token revoke
//     is enforced in api/paysheet-edit.js (owner edits) and the equivalent
//     pullback path; UI copy alone is not enough.
//   - declined → sent is a NEW offer, not a resurrection. Endpoint MUST
//     generate a fresh sub_acceptance_token, increment version, and write an
//     audit note every time. Old token is invalidated (superseded_token_at).
//   - accepted → pending_re_accept requires material-change reason. The
//     paysheetEditRequiresReAccept helper drives this; reason is captured
//     in the edit endpoint's audit note.
//   - payable → paid stays owner-only. Don't let any public/sub path advance.
const PAYSHEET_TRANSITIONS = Object.freeze({
  draft:                  ['sent', 'cancelled'],                          // was 'draft → declined'; renamed per peer review
  sent:                   ['accepted', 'declined', 'cancelled', 'draft'], // pullback to draft requires token revoke
  accepted:               ['pending_re_accept', 'completed_owner_marked', 'cancelled'],
  pending_re_accept:      ['accepted', 'declined', 'cancelled'],
  declined:               ['sent', 'cancelled'],                          // re-issue ALWAYS = new token + version bump (endpoint-enforced)
  cancelled:              [],                                              // terminal — owner abandoned; create fresh paysheet for new attempt
  completed_owner_marked: ['payable'],
  payable:                ['paid'],
  paid:                   []                                                // terminal
});

// ────────────────────────────────────────────────────────────────────────
// ESTIMATE / PROPOSAL STATE MACHINE (Bible §5.2)
// ────────────────────────────────────────────────────────────────────────

export const ESTIMATE_STATES = Object.freeze([
  'proposal_draft',
  'proposal_sent',
  'proposal_expired',                                                     // Manus peer review §1.2 — stale proposals get a real state, not just a P1 alert
  'approved_pending_rep_call',
  'contract_pending',
  'deposit_pending',
  'financing_pending',
  'schedule_pending',
  'scheduled',
  'change_order_pending',
  'closed_won',
  'closed_lost'
]);

// Semantics (Manus peer review §1.2):
//   closed_won = "commercially secured/sold"  (NOT "completed").
//   The active job lifecycle remains in `scheduled` through install + closeout.
//   change_order_pending → scheduled is the resume path; → closed_lost the kill path.
//   No change_order_pending → closed_won transition is intentional (closed_won
//   should reflect the moment of contract signing, not post-CO reconciliation).
//
// Manus peer review §1.2:
//   - Expired rate hold should transition into `proposal_expired` rather than
//     remain ambiguously in `proposal_sent`. Re-issue path = `proposal_expired
//     → proposal_sent` (resets rate_hold_expires_at via endpoint).
//   - Stripe webhook MUST call assertTransition('estimate', 'deposit_pending',
//     'schedule_pending') before updating any estimate row.
//   - Finance endpoint MUST require owner/admin role + Tier 3 typed-name
//     confirmation per Bible v0.2 §5.
//   - change_order_pending → scheduled requires CO status='approved' (or
//     superseded by a later approved CO). Endpoint enforces this; state
//     machine alone cannot.
const ESTIMATE_TRANSITIONS = Object.freeze({
  proposal_draft:            ['proposal_sent', 'closed_lost'],
  proposal_sent:             ['approved_pending_rep_call', 'proposal_expired', 'proposal_draft', 'closed_lost'],
  proposal_expired:          ['proposal_sent', 'proposal_draft', 'closed_lost'], // re-issue resets rate_hold_expires_at
  approved_pending_rep_call: ['contract_pending', 'closed_lost'],
  contract_pending:          ['deposit_pending', 'financing_pending', 'closed_lost'],
  deposit_pending:           ['schedule_pending', 'closed_lost'],
  financing_pending:         ['schedule_pending', 'closed_lost'],
  schedule_pending:          ['scheduled', 'closed_lost'],
  scheduled:                 ['change_order_pending', 'closed_won', 'closed_lost'],
  change_order_pending:      ['scheduled', 'closed_lost'],                         // requires CO.status='approved' — endpoint-enforced
  closed_won:                [],
  closed_lost:               []
});

// ────────────────────────────────────────────────────────────────────────
// CHANGE ORDER STATUS
// ────────────────────────────────────────────────────────────────────────

export const CHANGE_ORDER_STATUSES = Object.freeze([
  'draft',
  'pending_customer',
  'pending_sub',
  'pending_both',
  'approved',
  'rejected',
  'superseded',
  'cancelled'
]);

const CHANGE_ORDER_TRANSITIONS = Object.freeze({
  draft:            ['pending_customer', 'pending_sub', 'pending_both', 'cancelled'],
  pending_customer: ['approved', 'rejected', 'superseded', 'cancelled'],
  pending_sub:      ['approved', 'rejected', 'superseded', 'cancelled'],
  pending_both:     ['pending_customer', 'pending_sub', 'approved', 'rejected', 'superseded', 'cancelled'],
  approved:         ['superseded'],
  rejected:         [],
  superseded:       [],
  cancelled:        []
});

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────

const MACHINES = Object.freeze({
  paysheet: PAYSHEET_TRANSITIONS,
  estimate: ESTIMATE_TRANSITIONS,
  change_order: CHANGE_ORDER_TRANSITIONS
});

/**
 * Returns true if `from → to` is an allowed transition for the given machine.
 */
export function canTransition(machine, from, to) {
  const t = MACHINES[machine];
  if (!t) throw new Error(`Unknown state machine: ${machine}`);
  if (from === to) return false;
  if (!t[from]) return false;
  return t[from].includes(to);
}

/**
 * Returns the array of states reachable from `from` for the given machine.
 * Useful for rendering UI buttons + dropdowns.
 */
export function nextStates(machine, from) {
  const t = MACHINES[machine];
  if (!t) throw new Error(`Unknown state machine: ${machine}`);
  return t[from] || [];
}

/**
 * Throws Error if the transition is illegal. Use in endpoints before update.
 */
export function assertTransition(machine, from, to) {
  if (!canTransition(machine, from, to)) {
    throw new Error(`Illegal ${machine} transition: ${from} → ${to}`);
  }
}

/**
 * Returns true if a state is terminal (no outgoing transitions).
 */
export function isTerminal(machine, state) {
  return nextStates(machine, state).length === 0;
}

// ────────────────────────────────────────────────────────────────────────
// PAYSHEET-SPECIFIC HELPERS
// ────────────────────────────────────────────────────────────────────────

/**
 * Determine whether an owner-side edit on a paysheet should trigger
 * pending_re_accept + token revoke. Per Bible §5.1: any material edit
 * while accepted forces re-acceptance.
 *
 * Returns { needsReAccept, reason } — endpoint then bumps version,
 * generates new token, sets state='pending_re_accept', SMSs sub.
 */
export function paysheetEditRequiresReAccept(currentState) {
  if (currentState === 'accepted') {
    return { needsReAccept: true, reason: 'Edit while accepted — sub must re-confirm new terms' };
  }
  if (currentState === 'pending_re_accept') {
    // Owner edit while pending_re_accept invalidates prior token; sub always sees latest
    return { needsReAccept: true, reason: 'Edit while pending re-accept — supersedes prior token' };
  }
  return { needsReAccept: false, reason: null };
}

/**
 * Manus peer review §1.1: paysheet pullback (sent → draft) must revoke
 * the public token. Same applies to declined → sent re-issue: every
 * re-issue is a NEW offer with a fresh token, never a resurrection of
 * the prior one.
 *
 * Returns { needsTokenRevoke, needsNewToken, reason } so endpoint can
 * decide what to do during the transition.
 */
export function paysheetTransitionRequiresTokenAction(fromState, toState) {
  // Pullback to draft — revoke existing token, no new one needed (paysheet not visible)
  if (fromState === 'sent' && toState === 'draft') {
    return { needsTokenRevoke: true, needsNewToken: false, reason: 'Pullback to draft — public token must be revoked immediately' };
  }
  // Re-issue after decline — generate brand new token + version bump
  if (fromState === 'declined' && toState === 'sent') {
    return { needsTokenRevoke: true, needsNewToken: true, reason: 'Re-issue after decline — new offer with new token, version bump' };
  }
  // Cancellation from any non-terminal state — revoke token (no new one)
  if (toState === 'cancelled' && (fromState === 'sent' || fromState === 'accepted' || fromState === 'pending_re_accept' || fromState === 'declined')) {
    return { needsTokenRevoke: true, needsNewToken: false, reason: 'Owner-side cancellation — public token must be revoked' };
  }
  return { needsTokenRevoke: false, needsNewToken: false, reason: null };
}

// ────────────────────────────────────────────────────────────────────────
// CHANGE ORDER ENFORCEMENT HELPER
// ────────────────────────────────────────────────────────────────────────

/**
 * Manus peer review §1.3: pending_both → approved is NOT a UI button.
 * It is a computed result of both customer + sub acceptance OR a Tier 4
 * owner override with audit trail.
 *
 * Returns { canApprove, reason } based on the CO's customer + sub
 * acceptance fields.
 *
 * @param {object} co - { customer_accept_status, sub_accept_status, status }
 * @param {object} options - { ownerOverride: bool, overrideReason: string }
 */
export function changeOrderCanApprove(co, options = {}) {
  if (co.status === 'approved') {
    return { canApprove: false, reason: 'Already approved (terminal)' };
  }
  if (co.status === 'rejected' || co.status === 'cancelled' || co.status === 'superseded') {
    return { canApprove: false, reason: `CO is ${co.status} — cannot approve` };
  }

  const customerOk = co.customer_accept_status === 'accepted' || co.customer_accept_status === 'not_applicable';
  const subOk = co.sub_accept_status === 'accepted' || co.sub_accept_status === 'not_applicable';

  if (customerOk && subOk) {
    return { canApprove: true, reason: 'Both required sides have accepted' };
  }

  if (options.ownerOverride) {
    if (!options.overrideReason || options.overrideReason.length < 10) {
      return { canApprove: false, reason: 'Owner override requires a reason (≥10 chars) for audit trail' };
    }
    return { canApprove: true, reason: `Tier 4 owner override: ${options.overrideReason}` };
  }

  const waiting = [];
  if (!customerOk) waiting.push(`customer (${co.customer_accept_status})`);
  if (!subOk) waiting.push(`sub (${co.sub_accept_status})`);
  return { canApprove: false, reason: `Awaiting acceptance from: ${waiting.join(', ')}` };
}

/**
 * Manus peer review §1.2: change_order_pending → scheduled requires that
 * all active CO chains on the estimate are resolved (approved or superseded).
 * The endpoint that performs this transition must call this and refuse if
 * any CO is still pending.
 *
 * @param {Array<object>} cos - active change orders for the estimate
 * @returns {{canResume: boolean, blockedBy: Array<object>}}
 */
export function estimateCanResumeFromChangeOrder(cos) {
  const blocking = (cos || []).filter(co =>
    ['draft', 'pending_customer', 'pending_sub', 'pending_both'].includes(co.status)
  );
  return {
    canResume: blocking.length === 0,
    blockedBy: blocking.map(co => ({ id: co.id, status: co.status, reason: co.reason }))
  };
}

// ────────────────────────────────────────────────────────────────────────
// ESTIMATE-SPECIFIC HELPERS
// ────────────────────────────────────────────────────────────────────────

const RATE_HOLD_DAYS = 30;          // Bible §5.2 + proposal-client.html copy
const REP_CALL_HOURS = 24;          // Bible §5.2 — "rep call due within 24h"
const SCHEDULE_BUSINESS_DAYS = 3;   // Bible §5.2 — "schedule within 3 business days"
const DEPOSIT_PERCENT = 33;         // From contract-pdf.js:247

/**
 * Compute rate hold expiry (30 days from proposal_sent).
 */
export function computeRateHoldExpiry(sentAt = new Date()) {
  const d = new Date(sentAt);
  d.setDate(d.getDate() + RATE_HOLD_DAYS);
  return d.toISOString();
}

/**
 * Compute rep call due (24 hours from approved_at).
 */
export function computeRepCallDue(approvedAt = new Date()) {
  const d = new Date(approvedAt);
  d.setHours(d.getHours() + REP_CALL_HOURS);
  return d.toISOString();
}

/**
 * Compute schedule due (3 business days from deposit_cleared OR finance_approved).
 * Skips weekends. Doesn't account for stat holidays — that's a Phase B refinement.
 */
export function computeScheduleDue(triggerAt = new Date()) {
  const d = new Date(triggerAt);
  let added = 0;
  while (added < SCHEDULE_BUSINESS_DAYS) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d.toISOString();
}

/**
 * Compute Stripe deposit amount in cents (33% of total with HST).
 * Bible §5.2 + contract-pdf.js. Returns 0 if financing path elected.
 */
export function computeDepositAmountCents(totalWithTax, isFinanced) {
  if (isFinanced) return 0;
  return Math.round((Number(totalWithTax) || 0) * (DEPOSIT_PERCENT / 100) * 100);
}

export const ESTIMATE_TIMING = Object.freeze({
  RATE_HOLD_DAYS,
  REP_CALL_HOURS,
  SCHEDULE_BUSINESS_DAYS,
  DEPOSIT_PERCENT
});
