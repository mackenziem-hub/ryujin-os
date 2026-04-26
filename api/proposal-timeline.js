// Ryujin OS — Proposal Activity Timeline
//
// GET /api/proposal-timeline?share=<share_token>
//
// Returns the activity log for a given proposal: proposal_opened events,
// video_played, tier_selected, scope_expanded, pdf_rendered, accepted, etc.
//
// Public-ish endpoint (share token is the auth). Intended for the internal
// proposal-history UI — does NOT expose anything a client couldn't already
// see on the proposal page itself.

import { supabaseAdmin } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const share = String(req.query.share || '').trim();
  if (!share) return res.status(400).json({ error: 'Missing ?share=<token>' });

  const { data: est, error: estErr } = await supabaseAdmin
    .from('estimates')
    .select('id, tenant_id, estimate_number, status, share_token, selected_package, calculated_packages, customer:customers(full_name, email, phone)')
    .eq('share_token', share)
    .maybeSingle();
  if (estErr || !est) return res.status(404).json({ error: 'Proposal not found' });

  const { data: events, error: evErr } = await supabaseAdmin
    .from('activity_log')
    .select('id, action, details, created_at, entity_type')
    .eq('entity_id', est.id)
    .order('created_at', { ascending: true })
    .limit(500);
  if (evErr) return res.status(500).json({ error: evErr.message });

  // Summary counts for the top of the drawer
  const summary = {
    opened: 0,
    videoPlayed: 0,
    tiersExpanded: 0,
    pdfRendered: 0,
    accepted: false,
    firstOpenAt: null,
    lastActivityAt: null,
    tierSelected: null
  };
  for (const e of (events || [])) {
    const action = String(e.action || '').toLowerCase();
    if (action.includes('opened')) {
      summary.opened++;
      if (!summary.firstOpenAt) summary.firstOpenAt = e.created_at;
    }
    if (action.includes('video')) summary.videoPlayed++;
    if (action.includes('tier') || action.includes('scope')) summary.tiersExpanded++;
    if (action.includes('pdf')) summary.pdfRendered++;
    if (action === 'accepted') {
      summary.accepted = true;
      summary.tierSelected = e.details?.tier_name || e.details?.tier_id || summary.tierSelected;
    }
    summary.lastActivityAt = e.created_at;
  }

  return res.json({
    estimate: {
      id: est.id,
      number: est.estimate_number,
      status: est.status,
      customer: est.customer?.full_name || '',
      selectedPackage: est.selected_package
    },
    summary,
    events: events || []
  });
}
