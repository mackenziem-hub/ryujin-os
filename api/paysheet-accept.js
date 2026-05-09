// Ryujin OS — Sub Paysheet Acceptance Endpoint
//
// POST /api/paysheet-accept
// Body: { token, decision: 'accept'|'decline', note?, signature_text? }
//
// Public endpoint (no auth header). The sub_acceptance_token is the authentication.
// Mirrors proposal-accept pattern: token-gated, single-shot decision, SMS Mac.
//
// Requires migrations 035 + 037 applied. Reads/writes both the legacy
// sub_acceptance_status (migration 035) AND the new state column (migration 037)
// to keep them in sync during the transition period.

import { supabaseAdmin } from '../lib/supabase.js';
import { canTransition } from '../lib/state.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const MACKENZIE_CONTACT = '02IhxZfSwZZAZ2fooVGu';

async function smsMackenzie(message) {
  const token = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
  if (!token) {
    console.warn('[paysheet-accept] No GHL token, skipping SMS');
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
      body: JSON.stringify({ type: 'SMS', contactId: MACKENZIE_CONTACT, message }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (e) {
    console.error(`[paysheet-accept] SMS failed: ${e.message}`);
  }
}

function fmtMoney(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Resolve current state, preferring the new `state` column but falling
// back to legacy sub_acceptance_status during the transition period.
function resolveCurrentState(row) {
  if (row.state) return row.state;
  switch (row.sub_acceptance_status) {
    case 'accepted': return 'accepted';
    case 'declined': return 'declined';
    case 'pending':
    default:
      return row.sub_acceptance_token ? 'sent' : 'draft';
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { token, decision, note, signature_text } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing token' });
  if (!['accept', 'decline'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "accept" or "decline"' });
  }

  const { data: paysheet, error: lookupErr } = await supabaseAdmin
    .from('paysheets')
    .select('id, tenant_id, job_id, address, customer_name, subcontractor, total, state, sub_acceptance_status, sub_decision_at, sub_decision_note, version')
    .eq('sub_acceptance_token', token)
    .single();

  if (lookupErr || !paysheet) {
    return res.status(404).json({ error: 'Pay sheet not found for this link' });
  }

  // State machine guard — only `sent` and `pending_re_accept` accept incoming
  // sub decisions. Anything else (already accepted/declined/paid/etc.) returns
  // 409 with the current state so the UI can show a clear message.
  const currentState = resolveCurrentState(paysheet);
  const targetState = decision === 'accept' ? 'accepted' : 'declined';

  if (!canTransition('paysheet', currentState, targetState)) {
    return res.status(409).json({
      error: 'Transition not allowed in current state',
      current_state: currentState,
      attempted: targetState,
      decided_at: paysheet.sub_decision_at,
      previous_note: paysheet.sub_decision_note
    });
  }

  const decisionNote = [note, signature_text].filter(Boolean).join(' · ').slice(0, 1000) || null;
  const decidedAt = new Date().toISOString();

  // Sync both columns: new `state` is canonical, legacy `sub_acceptance_status`
  // mirrors so older code paths still work. Once all reads are migrated to
  // `state`, the legacy column can be dropped.
  const { error: updateErr } = await supabaseAdmin
    .from('paysheets')
    .update({
      state: targetState,
      sub_acceptance_status: targetState,
      sub_decision_at: decidedAt,
      sub_decision_note: decisionNote,
      updated_at: decidedAt
    })
    .eq('id', paysheet.id);

  if (updateErr) {
    console.error('[paysheet-accept] update failed', updateErr);
    return res.status(500).json({ error: 'Update failed', detail: updateErr.message });
  }

  // SMS Mac
  const subName = paysheet.subcontractor || 'Sub';
  const verb = decision === 'accept' ? 'ACCEPTED' : 'DECLINED';
  const reAcceptNote = currentState === 'pending_re_accept' ? ' (re-accept after edit)' : '';
  const smsLines = [
    `${subName} ${verb} paysheet${reAcceptNote}`,
    `${paysheet.job_id} — ${paysheet.customer_name || ''}`.trim(),
    `${paysheet.address || ''}`,
    `Pay: ${fmtMoney(paysheet.total)} (v${paysheet.version || 1})`
  ];
  if (decision === 'decline' && decisionNote) {
    smsLines.push(`Reason: ${decisionNote.slice(0, 200)}`);
  }
  smsMackenzie(smsLines.filter(Boolean).join('\n')).catch(() => {});

  return res.status(200).json({
    ok: true,
    state: targetState,
    status: targetState, // legacy field name — kept for backward-compat with paysheet.html
    decided_at: decidedAt,
    job_id: paysheet.job_id,
    address: paysheet.address,
    total: paysheet.total,
    version: paysheet.version || 1
  });
}
