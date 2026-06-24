// ═══════════════════════════════════════════════════════════════
// CREATE VIDEO AUDIENCES — Builds the standard 4-tier video-view
// custom audience set (25/50/75/ThruPlay @ 30d) for every active
// video ad on the account.
//
// GET /api/create-video-audiences           → dry run, lists what would be created
// POST /api/create-video-audiences          → actually creates them
// POST with { videoIds: ["123","456"] }     → only build for those video IDs
// ═══════════════════════════════════════════════════════════════

import { getActiveVideoAds, buildStandardVideoAudienceSet } from '../lib/meta.js';
import { requireCronOrOwner } from '../lib/cronAuth.js';

export default async function handler(req, res) {
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const startTime = Date.now();
  try {
    const ads = await getActiveVideoAds();

    if (req.method === 'GET') {
      return res.json({
        mode: 'dry_run',
        message: 'POST to actually create audiences',
        activeVideoAds: ads,
        wouldCreate: ads.length * 4,
        duration: `${Date.now() - startTime}ms`
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

    // No filter: build for every active video ad. Explicit videoIds: build for
    // exactly those, even if the ad is not delivering yet (just-activated / in
    // review). Video-view audiences are retroactive within the retention window,
    // so they backfill viewers once delivery starts.
    const filter = (req.body?.videoIds || []).filter(Boolean);
    let targets;
    if (filter.length > 0) {
      const byId = Object.fromEntries(ads.map(a => [a.videoId, a]));
      targets = filter.map(vid => byId[vid] || { videoId: vid, adId: null, name: `Video ${vid}` });
    } else {
      targets = ads;
    }

    const results = [];
    for (const ad of targets) {
      const label = ad.name || `Video ${ad.videoId}`;
      const set = await buildStandardVideoAudienceSet({ videoId: ad.videoId, videoLabel: label });
      results.push({ adId: ad.adId, adName: ad.name, videoId: ad.videoId, audiences: set });
    }

    const created = results.flatMap(r => r.audiences).filter(a => a.status === 'created').length;
    const errors = results.flatMap(r => r.audiences).filter(a => a.status === 'error');

    res.json({
      status: 'ok',
      videosProcessed: results.length,
      audiencesCreated: created,
      errors,
      results,
      duration: `${Date.now() - startTime}ms`
    });
  } catch (e) {
    res.status(500).json({ error: e.message, duration: `${Date.now() - startTime}ms` });
  }
}
