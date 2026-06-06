// Ryujin OS — Owner-side Paysheet Edit Endpoint
//
// POST /api/paysheet-edit
// Body: { paysheet_id, fields: { ...fields to update }, edit_reason? }
//
// Bible §5.1 enforcement: if a paysheet is already accepted (or in pending_re_accept),
// any owner edit invalidates the prior token, bumps version, sets state to
// pending_re_accept, generates a fresh token, and SMSs the sub the new link.
//
// Owner-authenticated. Requires `x-user-token` header validated via lib/auth.
// (For tenant 0, this is the existing admin auth path — same as production-paysheet.html.)

import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { paysheetEditRequiresReAccept } from '../lib/state.js';
import { requireOwnerOrAdmin } from '../lib/auth-server.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const APP_BASE = (process.env.APP_BASE_URL || 'https://ryujin-os.vercel.app').trim();

async function smsSub(subContactId, message) {
  const token = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
  if (!token || !subContactId) {
    console.warn('[paysheet-edit] SMS sub skipped (missing token or contact id)');
    return;
  }
  try {
    await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ type: 'SMS', contactId: subContactId, message }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (e) {
    console.error(`[paysheet-edit] SMS failed: ${e.message}`);
  }
}

// Fields the owner is allowed to edit via this endpoint. Anything not in this
// allowlist is silently dropped — prevents tampering with state, token, or audit fields.
const ALLOWED_FIELDS = new Set([
  'total', 'rate_per_sq', 'sq_count', 'travel_per_sq', 'extra_layer_per_sq',
  'chimney_count', 'chimney_size', 'skylight_count', 'skylight_type',
  'redeck_sheets', 'pipe_count', 'vent_count',
  'scope_notes', 'address', 'customer_name', 'subcontractor',
  'waste_removal_override', 'mobilization_override',
  'line_items',                  // jsonb
  'expected_install_date',
  'pay_terms_note'
]);

function newToken() {
  return randomBytes(16).toString('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-tenant-id, x-user-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Owner/admin auth. Accepts Authorization: Bearer <token> or x-user-token
  // (lib/auth-server.js readBearerToken). On failure it sends 401/403 itself.
  const auth = await requireOwnerOrAdmin(req, res);
  if (!auth) return;

  const { paysheet_id, fields, edit_reason } = req.body || {};
  if (!paysheet_id) return res.status(400).json({ error: 'paysheet_id required' });
  if (!fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'fields object required' });
  }

  // Load current paysheet (need state, version, sub contact id, token)
  const { data: paysheet, error: lookupErr } = await supabaseAdmin
    .from('paysheets')
    .select('id, tenant_id, job_id, address, customer_name, subcontractor, total, state, sub_acceptance_status, sub_acceptance_token, version, sub_contact_id')
    .eq('id', paysheet_id)
    .single();

  if (lookupErr || !paysheet) {
    return res.status(404).json({ error: 'Paysheet not found' });
  }

  // Tenant isolation: supabaseAdmin bypasses RLS, so verify the paysheet
  // belongs to the caller's tenant before any mutation. Return 404 (not 403)
  // so cross-tenant probes can't confirm a paysheet id exists.
  if (paysheet.tenant_id !== auth.tenant_id) {
    return res.status(404).json({ error: 'Paysheet not found' });
  }

  // Strip non-allowlisted fields
  const safeFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (ALLOWED_FIELDS.has(k)) safeFields[k] = v;
  }
  if (Object.keys(safeFields).length === 0) {
    return res.status(400).json({ error: 'No editable fields provided', allowed: [...ALLOWED_FIELDS] });
  }

  const currentState = paysheet.state || (
    paysheet.sub_acceptance_status === 'accepted' ? 'accepted'
    : paysheet.sub_acceptance_status === 'declined' ? 'declined'
    : (paysheet.sub_acceptance_token ? 'sent' : 'draft')
  );

  const { needsReAccept, reason: reAcceptReason } = paysheetEditRequiresReAccept(currentState);
  const now = new Date().toISOString();

  // Base update (always applied)
  const update = {
    ...safeFields,
    version: (paysheet.version || 1) + 1,
    updated_at: now
  };

  let smsBody = null;
  let publicLink = null;

  if (needsReAccept) {
    // Generate fresh token, revoke prior, flip state to pending_re_accept.
    // Keep sub_acceptance_status legacy column at 'pending' so older UI still works.
    const fresh = newToken();
    update.sub_acceptance_token = fresh;
    update.sub_acceptance_status = 'pending';
    update.state = 'pending_re_accept';
    update.superseded_token_at = now;
    update.sub_decision_at = null;
    update.sub_decision_note = null;
    publicLink = `${APP_BASE}/paysheet.html?token=${fresh}`;
    smsBody = [
      `Updated paysheet for ${paysheet.job_id || 'job'} — please review.`,
      paysheet.customer_name ? paysheet.customer_name : null,
      paysheet.address ? paysheet.address : null,
      `Reason: ${edit_reason || reAcceptReason}`,
      publicLink
    ].filter(Boolean).join('\n');
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('paysheets')
    .update(update)
    .eq('id', paysheet_id)
    .eq('tenant_id', auth.tenant_id)
    .select('id, state, version, total, updated_at')
    .single();

  if (updateErr) {
    console.error('[paysheet-edit] update failed', updateErr);
    return res.status(500).json({ error: 'Update failed', detail: updateErr.message });
  }

  // If we revoked + reissued, fire SMS to sub (fire-and-forget — never block response)
  if (needsReAccept && smsBody) {
    smsSub(paysheet.sub_contact_id, smsBody).catch(() => {});
  }

  return res.status(200).json({
    ok: true,
    state: updated.state,
    version: updated.version,
    superseded_prior_token: needsReAccept,
    reason: needsReAccept ? reAcceptReason : null,
    sms_sent: !!(needsReAccept && paysheet.sub_contact_id),
    paysheet: {
      id: updated.id,
      total: updated.total,
      updated_at: updated.updated_at
    }
  });
}

export const config = { api: { bodyParser: { sizeLimit: '256kb' } } };
