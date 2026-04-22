// Ryujin OS — Proposal Analytics Events
//
// POST /api/proposal-events
// Body: { estimateId?, shareToken, refId?, type, payload, at }
//
// Types: proposal_opened | tier_selected | video_played | scope_expanded | signature_started | ...
//
// Writes to activity_log with entity_type='proposal_event'. Public endpoint (share token is auth).
// Fire-and-forget from client — return 204 on success, don't block the page.

import { supabaseAdmin } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { estimateId, shareToken, refId, type, payload, at } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type required' });
  if (!shareToken && !estimateId) return res.status(400).json({ error: 'shareToken or estimateId required' });

  // Resolve the estimate cheaply (share_token is indexed)
  let est = null;
  if (shareToken) {
    const { data } = await supabaseAdmin
      .from('estimates')
      .select('id, tenant_id')
      .eq('share_token', shareToken)
      .maybeSingle();
    est = data;
  } else if (estimateId) {
    const { data } = await supabaseAdmin
      .from('estimates')
      .select('id, tenant_id')
      .eq('id', estimateId)
      .maybeSingle();
    est = data;
  }

  if (!est) return res.status(204).end(); // Silently swallow unknown share tokens — don't leak info

  await supabaseAdmin.from('activity_log').insert({
    tenant_id: est.tenant_id,
    entity_type: 'proposal_event',
    entity_id: est.id,
    action: String(type).slice(0, 64),
    details: {
      payload: payload || null,
      share_token: shareToken || null,
      ref_id: refId || null,
      at: at || new Date().toISOString()
    }
  });

  return res.status(204).end();
}

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };
