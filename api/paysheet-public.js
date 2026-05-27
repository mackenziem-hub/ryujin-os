// Ryujin OS — Public Pay Sheet Read (token-gated)
//
// GET /api/paysheet-public?token=<sub_acceptance_token>
//
// No auth header required. The sub_acceptance_token is the authentication.
// Reads paysheet directly from DB (requires migration 035 applied first).
//
// Field policy for sub-facing responses:
//   - scope_notes is admin-authored free text. It has historically leaked
//     customer retail subtotals, sales rep commission, deposit amounts, and
//     internal section refs. A denylist filter is fragile (any new wording
//     escapes it), so scope_notes is NOT selected at all for this endpoint.
//     If subs need scope guidance later, add a separate sub_scope_notes
//     column and project that instead.
//   - labour_breakdown / add_ons / surcharges line items: keep the
//     description / qty / rate / total fields the sub needs, but strip the
//     per-row .note field which carries internal section refs (§1.1 [A]).

import { supabaseAdmin } from '../lib/supabase.js';

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
