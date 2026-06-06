// ═══════════════════════════════════════════════════════════════
// META DEEP AUDIT — Full promoted_object + custom conversions + pixel volume
// GET /api/meta-deep-audit?adSetIds=id1,id2
// Default: returns the 2 known-misconfigured ad sets (IE + Bookings).
// ═══════════════════════════════════════════════════════════════

import { getAdSetFull, listCustomConversions, getPixelEventStats } from '../lib/meta.js';
import { requireCronOrOwner } from '../lib/cronAuth.js';

async function listAdsInAdSet(adSetId, token) {
  const url = `https://graph.facebook.com/v21.0/${adSetId}/ads?fields=id,name,status,effective_status,issues_info&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const d = await r.json();
  return d.data || d;
}

const DEFAULT_AD_SETS = [
  '120242781091380601', // Instant Estimator Leads Ad Set
  '120242779508020601', // bookings ad set
];
const PIXEL_ID = '1166833781416817';

export default async function handler(req, res) {
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  try {
    const idsParam = (req.query?.adSetIds || '').toString().trim();
    const adSetIds = idsParam ? idsParam.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_AD_SETS;

    const token = (process.env.META_ACCESS_TOKEN || '').trim();
    const adSets = {};
    for (const id of adSetIds) {
      try {
        const full = await getAdSetFull(id);
        let ads = [];
        try { ads = await listAdsInAdSet(id, token); } catch (e) { ads = [{ error: e.message }]; }
        adSets[id] = { ...full, ads };
      } catch (e) {
        adSets[id] = { error: e.message };
      }
    }

    let customConversions = [];
    try {
      customConversions = await listCustomConversions();
    } catch (e) {
      customConversions = [{ error: e.message }];
    }

    let pixelEvents7d = {};
    try {
      pixelEvents7d = await getPixelEventStats(PIXEL_ID, 7);
    } catch (e) {
      pixelEvents7d = { error: e.message };
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      generatedAt: new Date().toISOString(),
      pixelId: PIXEL_ID,
      adSets,
      customConversions,
      pixelEvents7d
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
