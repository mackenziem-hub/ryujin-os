// Ryujin OS — Public Pay Sheet Read (token-gated)
//
// GET /api/paysheet-public?token=<sub_acceptance_token>
//
// No auth header required. The sub_acceptance_token is the authentication.
// Reads paysheet directly from DB (requires migration 035 applied first).
//
// Sanitization: scope_notes and labour_breakdown[].note are admin-authored
// internal commentary that has historically leaked customer retail subtotals,
// sales rep commission percentages, deposit amounts, and internal section
// references. These are stripped here before the payload reaches the sub.

import { supabaseAdmin } from '../lib/supabase.js';

const INTERNAL_NOTE_PATTERNS = [
  /commission/i,
  /\bdarcy\b/i,
  /signed\s+subtotal/i,
  /customer\s+retail/i,
  /customer\s+deposit/i,
  /\bdeposit\s+\$/i,
  /NOT\s+APPLIED/i,
  /tracked\s+on\s+estimate/i,
  /reinstated|terminated/i,
  /Mac\s+judgment/i,
  /SUBCONTRACTOR_RATE_SHEET/i,
  /GHL\s+inv/i,
  /Sub\s+payout/i,
];

function isInternalLine(line) {
  if (line == null) return false;
  const s = String(line);
  return INTERNAL_NOTE_PATTERNS.some((re) => re.test(s));
}

function stripInternalNote(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const { note, ...rest } = row;
    return rest;
  });
}

function sanitizeForSub(paysheet) {
  return {
    ...paysheet,
    scope_notes: Array.isArray(paysheet.scope_notes)
      ? paysheet.scope_notes.filter((n) => !isInternalLine(n))
      : paysheet.scope_notes,
    labour_breakdown: stripInternalNote(paysheet.labour_breakdown),
    add_ons: stripInternalNote(paysheet.add_ons),
    surcharges: stripInternalNote(paysheet.surcharges),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const { data, error } = await supabaseAdmin
    .from('paysheets')
    .select(`
      job_id,
      address,
      customer_name,
      subcontractor,
      shingle_product,
      job_type,
      labour_breakdown,
      add_ons,
      surcharges,
      subtotal,
      hst,
      total,
      scope_notes,
      scheduled_date,
      sub_acceptance_status,
      sub_decision_at,
      sub_decision_note,
      created_at
    `)
    .eq('sub_acceptance_token', token)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Pay sheet not found for this link' });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(sanitizeForSub(data));
}
