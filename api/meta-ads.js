// ═══════════════════════════════════════════════════════════════
// META ADS LIVE REFRESH — Pulls live data from Meta Graph API
// and pushes to /api/snapshot, replacing the CSV export pipeline.
//
// Schedule: Called by daily.js before agents run, or manually via
//   GET /api/meta-ads
//   GET /api/meta-ads?detail=campaign_id (ad set breakdown)
//
// Requires env vars: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID
// ═══════════════════════════════════════════════════════════════

import { buildMetaAdsSnapshot, getAdSets, checkTokenHealth, listCustomAudiences } from '../lib/meta.js';

const SHENRON_BASE = 'https://ryujin-os.vercel.app';

export default async function handler(req, res) {
  const startTime = Date.now();
  const { detail, action } = req.query || {};

  // Audience list mode — retarget funnel health check
  if (action === 'audiences') {
    try {
      const audiences = await listCustomAudiences();
      return res.json({ audiences, count: audiences.length, duration: `${Date.now() - startTime}ms` });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Ad set detail mode — return breakdown for a specific campaign
  if (detail) {
    try {
      const adSets = await getAdSets(detail);
      return res.json({ campaignId: detail, adSets, duration: `${Date.now() - startTime}ms` });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Main mode — full refresh
  console.log('[Meta Ads] Starting live refresh...');

  // Check token health first
  const tokenHealth = await checkTokenHealth();
  if (!tokenHealth.valid) {
    console.error('[Meta Ads] Token invalid:', tokenHealth.error);
    return res.status(401).json({
      error: 'Meta API token is invalid or expired',
      detail: tokenHealth.error,
      fix: 'Generate a new token in Meta Graph API Explorer and update META_ACCESS_TOKEN in Vercel env vars'
    });
  }

  try {
    const metaAds = await buildMetaAdsSnapshot();

    // Push to snapshot
    const pushResp = await fetch(`${SHENRON_BASE}/api/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metaAds })
    });

    if (!pushResp.ok) {
      const body = await pushResp.text().catch(() => '');
      throw new Error(`Snapshot push failed: HTTP ${pushResp.status} — ${body.slice(0, 200)}`);
    }

    const duration = Date.now() - startTime;
    console.log(`[Meta Ads] Refreshed in ${duration}ms — ${metaAds.activeCampaignCount} active campaigns, $${metaAds.totalSpend} total spend, ${metaAds.alerts.length} alerts`);

    res.json({
      status: 'ok',
      duration: `${duration}ms`,
      tokenHealth: {
        valid: tokenHealth.valid,
        expiresAt: tokenHealth.expiresAt,
        scopes: tokenHealth.scopes
      },
      summary: {
        activeCampaigns: metaAds.activeCampaignCount,
        totalCampaigns: metaAds.totalCampaigns,
        totalSpend: metaAds.totalSpend,
        totalLeads: metaAds.totalAllLeads,
        avgCPL: metaAds.avgCPL,
        alerts: metaAds.alerts
      },
      pushedToSnapshot: true
    });

  } catch (e) {
    console.error(`[Meta Ads] Error: ${e.message}`);
    res.status(500).json({ error: e.message, duration: `${Date.now() - startTime}ms` });
  }
}
