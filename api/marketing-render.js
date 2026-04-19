// Ryujin OS — Marketing Render Worker
//
// POST /api/marketing-render?id=CLIP_ID
//   Called fire-and-forget by /api/marketing upload handler.
//   Long-running (Vercel Pro function, maxDuration 300s).
//   Internal auth: x-internal-key header must match INTERNAL_RENDER_KEY env (if set).
//
// POST /api/marketing-render?next=1
//   Pulls the oldest queued clip for this tenant and renders it.
//   Useful for cron resilience (catches any clip whose fire-and-forget kickoff dropped).
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { renderClip } from '../lib/marketingRenderer.js';

export const config = {
  maxDuration: 300, // seconds — Vercel Pro max is 900
};

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Optional internal key check
  const expectedKey = (process.env.INTERNAL_RENDER_KEY || '').trim();
  if (expectedKey) {
    const got = (req.headers['x-internal-key'] || '').trim();
    if (got !== expectedKey) {
      return res.status(401).json({ error: 'Invalid internal key' });
    }
  }

  const tenantId = req.tenant.id;
  let clipId = req.query.id;

  if (!clipId && req.query.next) {
    const { data } = await supabaseAdmin
      .from('marketing_clips')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    if (!data) return res.json({ ok: true, rendered: null, reason: 'no queued clips' });
    clipId = data.id;
  }

  if (!clipId) return res.status(400).json({ error: 'Missing ?id= or ?next=1' });

  // Verify clip belongs to tenant
  const { data: clip } = await supabaseAdmin
    .from('marketing_clips')
    .select('id, tenant_id, status')
    .eq('id', clipId)
    .single();
  if (!clip || clip.tenant_id !== tenantId) {
    return res.status(404).json({ error: 'Clip not found' });
  }
  if (clip.status === 'rendering') {
    return res.status(409).json({ error: 'Already rendering' });
  }

  try {
    const result = await renderClip(clipId);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err), clipId });
  }
}

export default requireTenant(handler);
