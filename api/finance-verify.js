// Ryujin OS — FinanceIt Manual Verification Endpoint
//
// POST /api/finance-verify
// Auth: Bearer token (Owner or Admin role only — Manus peer review §6 mandate)
// Body: {
//   estimate_id: uuid,
//   approval_reference: string,           // FinanceIt approval letter reference number
//   approval_letter_url: string?,         // optional uploaded/saved letter URL
//   verified_amount: int (cents),         // verified financed amount, must match estimate
//   verified_by_typed_name: string,       // owner types their full name to confirm (Tier 3)
//   notes?: string                         // optional context
// }
//
// State transition: estimate.state='financing_pending' → 'schedule_pending'
// Side effects:
//   * estimates.finance_status = 'approved'
//   * estimates.finance_approved_at = now()
//   * estimates.schedule_due_by = computeScheduleDue(now()) (3 business days)
//   * activity_log row with full evidence payload
//
// Manus peer review §6 hard rules:
//   - Owner/admin role only (lib/auth-server.js requireOwnerOrAdmin)
//   - Tier 3 typed-name confirmation (verified_by_typed_name must match user.name)
//   - State machine guard via assertTransition
//   - Audit log required, not optional

import { supabaseAdmin } from '../lib/supabase.js';
import { requireOwnerOrAdmin } from '../lib/auth-server.js';
import { assertTransition, computeScheduleDue } from '../lib/state.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // ── Owner/admin auth ──
  const auth = await requireOwnerOrAdmin(req, res);
  if (!auth) return; // helper already sent 401/403

  const {
    estimate_id,
    approval_reference,
    approval_letter_url,
    verified_amount,
    verified_by_typed_name,
    notes
  } = req.body || {};

  // ── Required-field validation ──
  if (!estimate_id) return res.status(400).json({ error: 'estimate_id required' });
  if (!approval_reference || String(approval_reference).trim().length < 3) {
    return res.status(400).json({ error: 'approval_reference required (FinanceIt reference number)' });
  }
  if (typeof verified_amount !== 'number' || !Number.isInteger(verified_amount) || verified_amount <= 0) {
    return res.status(400).json({ error: 'verified_amount must be a positive integer (cents)' });
  }
  if (!verified_by_typed_name || String(verified_by_typed_name).trim().length === 0) {
    return res.status(400).json({ error: 'verified_by_typed_name required for Tier 3 confirmation' });
  }

  // Tier 3: typed name must match user.name (case-insensitive, trimmed)
  // Manus peer review §6 — confirmation friction is server-side, not client-side
  const typedNameNormalized = String(verified_by_typed_name).trim().toLowerCase();
  const userNameNormalized = String(auth.user.name || '').trim().toLowerCase();
  if (typedNameNormalized !== userNameNormalized) {
    return res.status(400).json({
      error: 'Typed name does not match authenticated user — Tier 3 confirmation failed',
      expected_match: auth.user.name,
      received: verified_by_typed_name
    });
  }

  // ── Load estimate + verify state ──
  const { data: estimate, error: lookupErr } = await supabaseAdmin
    .from('estimates')
    .select('id, tenant_id, estimate_number, state, finance_status, finance_provider, final_accepted_total, customer:customers(full_name)')
    .eq('id', estimate_id)
    .eq('tenant_id', auth.tenant_id)        // tenant-scope guard
    .single();

  if (lookupErr || !estimate) {
    return res.status(404).json({ error: 'Estimate not found in your tenant' });
  }

  // ── Amount match guard ──
  // verified_amount (cents) must match the estimate's final_accepted_total (dollars).
  // This protects against amount-tampering attempts.
  const estimateAmountCents = Math.round((Number(estimate.final_accepted_total) || 0) * 100);
  if (verified_amount !== estimateAmountCents) {
    return res.status(400).json({
      error: 'Verified amount does not match estimate total',
      estimate_total_cents: estimateAmountCents,
      verified_amount_cents: verified_amount
    });
  }

  // ── State machine guard ──
  try {
    assertTransition('estimate', estimate.state, 'schedule_pending');
  } catch (e) {
    return res.status(409).json({
      error: e.message,
      current_state: estimate.state,
      attempted: 'schedule_pending'
    });
  }
  if (estimate.finance_status !== 'pending') {
    return res.status(409).json({
      error: 'Finance status is not pending — verification not applicable',
      current_finance_status: estimate.finance_status
    });
  }

  // ── Apply transition ──
  const now = new Date().toISOString();
  const scheduleDueBy = computeScheduleDue(now);
  const update = {
    state: 'schedule_pending',
    finance_status: 'approved',
    finance_approved_at: now,
    schedule_due_by: scheduleDueBy
  };

  const { error: updateErr } = await supabaseAdmin
    .from('estimates')
    .update(update)
    .eq('id', estimate.id);

  if (updateErr) {
    console.error('[finance-verify] update failed', updateErr);
    return res.status(500).json({ error: 'Update failed', detail: updateErr.message });
  }

  // ── Audit log entry ──
  await supabaseAdmin.from('activity_log').insert({
    tenant_id: auth.tenant_id,
    entity_type: 'estimate',
    entity_id: estimate.id,
    action: 'finance_verified',
    details: {
      previous_state: estimate.state,
      new_state: 'schedule_pending',
      finance_provider: estimate.finance_provider,
      approval_reference: String(approval_reference).trim(),
      approval_letter_url: approval_letter_url || null,
      verified_amount_cents: verified_amount,
      verified_by_user_id: auth.user.id,
      verified_by_typed_name: auth.user.name,
      notes: notes ? String(notes).slice(0, 1000) : null,
      schedule_due_by: scheduleDueBy
    }
  }).then(({ error }) => {
    if (error) console.error('[finance-verify] activity_log insert failed', error.message);
  });

  return res.status(200).json({
    ok: true,
    estimate_id: estimate.id,
    estimate_number: estimate.estimate_number,
    customer: estimate.customer?.full_name || null,
    previous_state: estimate.state,
    new_state: 'schedule_pending',
    finance_status: 'approved',
    finance_approved_at: now,
    schedule_due_by: scheduleDueBy,
    verified_by: auth.user.name,
    verified_at: now
  });
}

export const config = { api: { bodyParser: { sizeLimit: '128kb' } } };
