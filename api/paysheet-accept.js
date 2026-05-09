// Ryujin OS — Sub Paysheet Acceptance Endpoint
//
// POST /api/paysheet-accept
// Body: { token, decision: 'accept'|'decline', note?, signature_text? }
//
// Public endpoint (no auth header). The sub_acceptance_token is the authentication.
// Mirrors proposal-accept pattern: token-gated, single-shot decision, SMS Mac.
// Requires migration 035 applied (adds sub_acceptance_* columns to paysheets).

import { supabaseAdmin } from '../lib/supabase.js';

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
    .select('id, tenant_id, job_id, address, customer_name, subcontractor, total, sub_acceptance_status, sub_decision_at, sub_decision_note')
    .eq('sub_acceptance_token', token)
    .single();

  if (lookupErr || !paysheet) {
    return res.status(404).json({ error: 'Pay sheet not found for this link' });
  }

  if (paysheet.sub_acceptance_status === 'accepted' || paysheet.sub_acceptance_status === 'declined') {
    return res.status(409).json({
      error: 'Already decided',
      status: paysheet.sub_acceptance_status,
      decided_at: paysheet.sub_decision_at,
      previous_note: paysheet.sub_decision_note
    });
  }

  const newStatus = decision === 'accept' ? 'accepted' : 'declined';
  const decisionNote = [note, signature_text].filter(Boolean).join(' · ').slice(0, 1000) || null;
  const decidedAt = new Date().toISOString();

  const { error: updateErr } = await supabaseAdmin
    .from('paysheets')
    .update({
      sub_acceptance_status: newStatus,
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
  const smsLines = [
    `${subName} ${verb} paysheet`,
    `${paysheet.job_id} — ${paysheet.customer_name || ''}`.trim(),
    `${paysheet.address || ''}`,
    `Pay: ${fmtMoney(paysheet.total)}`
  ];
  if (decision === 'decline' && decisionNote) {
    smsLines.push(`Reason: ${decisionNote.slice(0, 200)}`);
  }
  smsMackenzie(smsLines.filter(Boolean).join('\n')).catch(() => {});

  return res.status(200).json({
    ok: true,
    status: newStatus,
    decided_at: decidedAt,
    job_id: paysheet.job_id,
    address: paysheet.address,
    total: paysheet.total
  });
}
