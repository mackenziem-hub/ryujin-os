// ═══════════════════════════════════════════════════════════════
// MARKETING KPIs — cross-system funnel in one place.
// Joins Meta ad performance (meta_insights) with the Ryujin sales
// spine (estimates + activity_log) to compute the full funnel,
// CAC, and ROAS — overall and per campaign.
//
//   GET /api/marketing-kpis?days=90
//   Gated: portal session + tenant.
//
// Attribution note: per-campaign ROAS is EXACT for estimates whose
// attribution.campaign_id was captured (Phase 2, going forward). Blended
// CAC/ROAS use ALL signed revenue in the window (which includes non-ad
// sources like Darcy/referrals), so they are an upper bound, labelled as
// blended. GHL bookings + Gmail corroboration are pending (see crossSystem).
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const days = Math.min(Math.max(parseInt(req.query?.days || '90', 10) || 90, 1), 365);
  const until = (req.query?.until || new Date().toISOString().slice(0, 10)).toString();
  const since = (req.query?.since || new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)).toString();
  const untilExclusive = new Date(new Date(until).getTime() + 86400000).toISOString().slice(0, 10);

  try {
    const [metaRes, estRes, openedRes] = await Promise.all([
      supabaseAdmin.from('meta_insights')
        .select('campaign_id,campaign_name,spend_cents,impressions,reach,clicks,link_clicks,leads,video_thruplays,video_plays_3s,video_p100')
        .eq('tenant_id', tenantId).eq('level', 'ad')
        .gte('date_start', since).lte('date_start', until).limit(10000),
      supabaseAdmin.from('estimates')
        .select('status,final_accepted_total,attribution,created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', since).lt('created_at', untilExclusive).limit(5000),
      supabaseAdmin.from('activity_log')
        .select('entity_id')
        .eq('tenant_id', tenantId).eq('action', 'proposal_opened')
        .gte('created_at', since).lt('created_at', untilExclusive).limit(20000)
    ]);

    if (metaRes.error) throw new Error('meta_insights: ' + metaRes.error.message);
    if (estRes.error) throw new Error('estimates: ' + estRes.error.message);

    // ── Meta side ──
    const metaRows = metaRes.data || [];
    const meta = { spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, leads: 0, thruplays: 0, plays3s: 0, p100: 0 };
    const campMap = new Map();
    for (const m of metaRows) {
      meta.spend += (m.spend_cents || 0) / 100;
      meta.impressions += m.impressions || 0;
      meta.clicks += m.clicks || 0;
      meta.linkClicks += m.link_clicks || 0;
      meta.leads += m.leads || 0;
      meta.thruplays += m.video_thruplays || 0;
      meta.plays3s += m.video_plays_3s || 0;
      meta.p100 += m.video_p100 || 0;
      const cid = m.campaign_id || 'unknown';
      if (!campMap.has(cid)) campMap.set(cid, { campaignId: cid, campaignName: m.campaign_name || null, spend: 0, impressions: 0, clicks: 0, leads: 0, thruplays: 0, attributedSigned: 0, attributedRevenue: 0 });
      const c = campMap.get(cid);
      c.spend += (m.spend_cents || 0) / 100;
      c.impressions += m.impressions || 0;
      c.clicks += m.clicks || 0;
      c.leads += m.leads || 0;
      c.thruplays += m.video_thruplays || 0;
    }

    // ── Ryujin sales spine ──
    const ests = estRes.data || [];
    let created = 0, sent = 0, signed = 0, signedRevenue = 0;
    let adSourcedRevenue = 0, adSourcedJobs = 0, adInfluencedRevenue = 0, adInfluencedJobs = 0;
    for (const e of ests) {
      created += 1;
      if (e.status === 'proposal_sent' || e.status === 'accepted') sent += 1;
      if (e.status === 'accepted') {
        signed += 1;
        const rev = Number(e.final_accepted_total) || 0;
        signedRevenue += rev;
        const a = e.attribution || {};
        // ad_sourced = came directly through an ad/funnel (hard evidence).
        // ad_influenced = brand-persuaded even if another touchpoint closed it.
        if (a.ad_sourced === true) { adSourcedRevenue += rev; adSourcedJobs += 1; }
        if (a.ad_influenced === true) { adInfluencedRevenue += rev; adInfluencedJobs += 1; }
        // exact per-campaign attribution (populates going forward from real capture)
        const cid = a.campaign_id;
        if (cid && campMap.has(cid)) {
          const c = campMap.get(cid);
          c.attributedSigned += 1;
          c.attributedRevenue += rev;
        }
      }
    }
    const proposalsOpened = new Set((openedRes.data || []).map(o => o.entity_id)).size;

    // ── derived ──
    const byCampaign = [...campMap.values()]
      .map(c => ({
        ...c,
        spend: r2(c.spend),
        cpl: c.leads > 0 ? r2(c.spend / c.leads) : null,
        attributedRevenue: r2(c.attributedRevenue),
        attributedRoas: c.spend > 0 && c.attributedRevenue > 0 ? r2(c.attributedRevenue / c.spend) : null
      }))
      .sort((a, b) => b.spend - a.spend);

    const totals = {
      adSpend: r2(meta.spend),
      impressions: meta.impressions,
      reach: meta.reach,
      clicks: meta.clicks,
      linkClicks: meta.linkClicks,
      ctr: pct(meta.clicks, meta.impressions),
      leads: meta.leads,
      cpl: meta.leads > 0 ? r2(meta.spend / meta.leads) : null,
      thruplays: meta.thruplays,
      hookRate: pct(meta.plays3s, meta.impressions),
      holdRate: pct(meta.p100, meta.plays3s),
      estimatesCreated: created,
      proposalsSent: sent,
      proposalsOpened,
      signed,
      signedRevenue: r2(signedRevenue),
      blendedCAC: signed > 0 ? r2(meta.spend / signed) : null,
      blendedRoas: meta.spend > 0 ? r2(signedRevenue / meta.spend) : null,
      // ad-sourced = hard evidence of ad/funnel origin (conservative).
      adSourcedJobs,
      adSourcedRevenue: r2(adSourcedRevenue),
      adSourcedRoas: meta.spend > 0 ? r2(adSourcedRevenue / meta.spend) : null,
      // ad-influenced = brand-persuaded (Mac's view); excludes only clear non-ad origins.
      adInfluencedJobs,
      adInfluencedRevenue: r2(adInfluencedRevenue),
      adInfluencedRoas: meta.spend > 0 ? r2(adInfluencedRevenue / meta.spend) : null,
      attributedSigned: byCampaign.reduce((s, c) => s + c.attributedSigned, 0),
      attributedRevenue: r2(byCampaign.reduce((s, c) => s + c.attributedRevenue, 0))
    };

    const funnel = [
      { stage: 'Impressions', value: meta.impressions },
      { stage: 'Clicks', value: meta.clicks },
      { stage: 'Leads', value: meta.leads },
      { stage: 'Estimates', value: created },
      { stage: 'Proposals sent', value: sent },
      { stage: 'Signed', value: signed }
    ];

    return res.status(200).json({
      ok: true,
      window: { since, until, days },
      totals,
      funnel,
      byCampaign,
      crossSystem: {
        meta: 'live (meta_insights)',
        ryujin: 'live (estimates + activity_log = sales spine)',
        ghl: 'pending location-scoped token (bookings)',
        gmail: 'phase 5 (booking-confirmation corroboration)'
      },
      note: 'blendedCAC/blendedRoas use ALL signed revenue in-window (includes non-ad sources); attributedRevenue/Roas are exact per-campaign and populate as new captured-attribution deals close.'
    });
  } catch (e) {
    console.error('[marketing-kpis]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

export default requirePortalSessionAndTenant(handler);
