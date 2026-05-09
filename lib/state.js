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
  'completed_owner_marked',
  'payable',
  'paid'
]);

const PAYSHEET_TRANSITIONS = Object.freeze({
  draft:                  ['sent', 'declined'],
  sent:                   ['accepted', 'declined', 'draft'],            // owner can pull back to draft
  accepted:               ['pending_re_accept', 'completed_owner_marked'],
  pending_re_accept:      ['accepted', 'declined'],                     // sub re-accepts or declines
  declined:               ['sent'],                                      // owner re-issues with edits → new token, back to sent
  completed_owner_marked: ['payable'],
  payable:                ['paid'],
  paid:                   []                                             // terminal
});

// ────────────────────────────────────────────────────────────────────────
// ESTIMATE / PROPOSAL STATE MACHINE (Bible §5.2)
// ────────────────────────────────────────────────────────────────────────

export const ESTIMATE_STATES = Object.freeze([
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
]);

const ESTIMATE_TRANSITIONS = Object.freeze({
  proposal_draft:            ['proposal_sent', 'closed_lost'],
  proposal_sent:             ['approved_pending_rep_call', 'proposal_draft', 'closed_lost'],
  approved_pending_rep_call: ['contract_pending', 'closed_lost'],
  contract_pending:          ['deposit_pending', 'financing_pending', 'closed_lost'],
  deposit_pending:           ['schedule_pending', 'closed_lost'],
  financing_pending:         ['schedule_pending', 'closed_lost'],
  schedule_pending:          ['scheduled', 'closed_lost'],
  scheduled:                 ['change_order_pending', 'closed_won', 'closed_lost'],
  change_order_pending:      ['scheduled', 'closed_lost'],
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
