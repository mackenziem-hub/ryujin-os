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

export default async function handler(req, res) {
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

    const filter = (req.body?.videoIds || []).filter(Boolean);
    const targets = filter.length > 0 ? ads.filter(a => filter.includes(a.videoId)) : ads;

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
