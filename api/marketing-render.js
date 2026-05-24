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

  // Bug-sweep #4 (2026-04-24 → fixed 2026-05-24): atomic claim. The previous
  // pattern was read-then-check-then-call renderClip, which TOCTOU-races two
  // concurrent invocations (e.g. upload kickoff + cron ?next=1 firing at the
  // same moment) — both pass the status check, both burn ffmpeg + Whisper +
  // Claude credits + Vercel function-seconds rendering the same clip twice.
  // Now we claim with a conditional UPDATE; if 0 rows came back, somebody else
  // got it and we refuse cleanly without doing any work.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('marketing_clips')
    .update({ status: 'rendering' })
    .eq('id', clipId)
    .eq('tenant_id', tenantId)
    .in('status', ['queued', 'failed']) // failed-status retries are allowed; 'rendering' / 'ready' / etc. are not
    .select('id')
    .maybeSingle();
  if (claimErr) {
    return res.status(500).json({ error: 'Claim failed: ' + claimErr.message });
  }
  if (!claimed) {
    return res.status(409).json({ error: 'Already rendering or in a non-renderable state' });
  }

  try {
    const result = await renderClip(clipId);
    return res.json(result);
  } catch (err) {
    // If the renderer crashes after we claimed, flip back to 'failed' so the
    // next sweep can retry (otherwise the row gets stranded in 'rendering'
    // forever and the cron will skip it).
    await supabaseAdmin.from('marketing_clips')
      .update({ status: 'failed', error_message: 'Renderer crashed: ' + (err.message || String(err)) })
      .eq('id', clipId).eq('tenant_id', tenantId).eq('status', 'rendering');
    return res.status(500).json({ error: err.message || String(err), clipId });
  }
}

export default requireTenant(handler);
