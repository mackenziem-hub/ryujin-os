// Ryujin OS — Public Pay Sheet Read (token-gated)
//
// GET /api/paysheet-public?token=<sub_acceptance_token>
//
// No auth header required. The sub_acceptance_token is the authentication.
// Reads paysheet directly from DB (requires migration 035 applied first).

import { supabaseAdmin } from '../lib/supabase.js';

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
  return res.status(200).json(data);
}
