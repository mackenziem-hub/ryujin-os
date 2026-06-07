// ═══════════════════════════════════════════════════════════════
// META AD SWEEP — full-fidelity 90-day (configurable) pull of every
// ad/campaign with spend, clicks, video watch-time, and leads.
// Owner/cron gated. Pure Meta reader; the Ryujin sales-side join
// (estimates/workorders) is done by the caller against Supabase.
//
//   GET /api/meta-sweep?days=90
//   Authorization: Bearer <CRON_SECRET | owner session | service token>
// ═══════════════════════════════════════════════════════════════

import { getMetaSweep, checkTokenHealth } from '../lib/meta.js';
import { requireCronOrOwner } from '../lib/cronAuth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const days = Math.min(Math.max(parseInt(req.query?.days || '90', 10) || 90, 1), 365);
  const t0 = Date.now();

  try {
    const tokenHealth = await checkTokenHealth();
    if (!tokenHealth.valid) {
      return res.status(401).json({
        error: 'Meta token invalid or expired',
        detail: tokenHealth.error || null,
        fix: 'Generate a new 60-day token in Meta Business Settings and update META_ACCESS_TOKEN in Vercel.'
      });
    }

    const sweep = await getMetaSweep({ days });
    return res.status(200).json({
      ok: true,
      tokenHealth: { valid: tokenHealth.valid, expiresAt: tokenHealth.expiresAt, daysLeft: tokenHealth.daysLeft },
      durationMs: Date.now() - t0,
      ...sweep
    });
  } catch (e) {
    console.error('[meta-sweep]', e.message);
    return res.status(500).json({ error: e.message, durationMs: Date.now() - t0 });
  }
}
