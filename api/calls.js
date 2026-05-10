// ═══════════════════════════════════════════════════════════════
// /api/calls — list endpoint for the call-log UI.
//
//   GET /api/calls?since_days=14&limit=200&user_id=<uuid>
//     returns: { calls: [...] }
//
// owner+admin can pass any user_id; sales/crew get filtered to themselves.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { resolveSession, effectiveUserId } from '../lib/portalAuth.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const session = await resolveSession(req);

  const sinceDays = Math.min(parseInt(req.query.since_days, 10) || 14, 90);
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const userId = effectiveUserId(session, req.query.user_id);

  let q = supabaseAdmin
    .from('phone_calls')
    .select(`
      id, twilio_call_sid, direction, status,
      from_phone, to_phone, ryujin_phone,
      started_at, answered_at, ended_at, duration_sec,
      voice_memo_id, recording_url,
      customer:customers(id, full_name),
      from_user:users!phone_calls_from_user_id_fkey(id, name),
      to_user:users!phone_calls_to_user_id_fkey(id, name),
      memo:voice_memos(id, blob_url, transcription, transcription_status),
      metadata
    `)
    .eq('tenant_id', tenantId)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (userId) q = q.or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ calls: data || [], since_days: sinceDays });
}

export default requireTenant(handler);
