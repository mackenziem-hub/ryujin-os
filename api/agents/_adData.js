// Ad Performance Data Reader
// Reads ad data from the Ryujin snapshot (populated by live Meta API or CSV enrichment).
//
// Data sources:
//   Meta: Live Graph API via /api/meta-ads → snapshot.sections.metaAds (primary)
//         OR CSV enrichment via enrich-ads.js → snapshot.sections.metaAds (fallback)
//   Google: CSV enrichment via enrich-ads.js → snapshot.sections.googleAds
//
// Since agents run on Vercel (no filesystem), they read from the snapshot API.

const BASE_URL = 'https://ryujin-os.vercel.app';

/**
 * Fetch ad performance data from the Ryujin snapshot.
 * Returns structured Meta + Google Ads metrics.
 */
export async function fetchAdData() {
  const result = {
    meta: null,
    google: null,
    combined: null,
    errors: []
  };

  try {
    // Cache-bust to defeat Vercel edge cache (see _shared.js fetchJSON note)
    const resp = await fetch(`${BASE_URL}/api/snapshot?_t=${Date.now()}`, { cache: 'no-store' });
    if (!resp.ok) {
      result.errors.push(`Snapshot fetch failed: HTTP ${resp.status}`);
      return result;
    }
    const snapshot = await resp.json();

    // Meta Ads from enriched snapshot
    if (snapshot?.sections?.metaAds) {
      const meta = snapshot.sections.metaAds;
      const activeCampaigns = (meta.activeCampaigns || []);
      const totalActiveSpend = activeCampaigns.reduce((s, c) => s + (parseFloat(c.spend) || 0), 0);
      const totalActiveLeads = activeCampaigns.reduce((s, c) => s + (parseInt(c.leads) || 0), 0);

      result.meta = {
        source: 'Facebook Ads Export CSV (enriched in snapshot)',
        exportDate: meta.exportDate || 'unknown',
        lifetime: {
          totalCampaigns: meta.totalCampaigns || 0,
          totalSpend: meta.totalSpend || 0,
          totalLeads: meta.totalMessagingLeads || 0,
          avgCPL: meta.totalMessagingLeads > 0
            ? Math.round((meta.totalSpend / meta.totalMessagingLeads) * 100) / 100
            : null
        },
        activeCampaigns: activeCampaigns.map(c => ({
          name: c.name,
          spend: parseFloat(c.spend) || 0,
          leads: parseInt(c.leads) || 0,
          cpl: c.cpl || null,
          alert: c.alert || null
        })),
        activeSpendTotal: Math.round(totalActiveSpend * 100) / 100,
        activeLeadsTotal: totalActiveLeads,
        activeCPL: totalActiveLeads > 0
          ? Math.round((totalActiveSpend / totalActiveLeads) * 100) / 100
          : null,
        topPerformers: (meta.topPerformers || []).slice(0, 5),
        alerts: activeCampaigns.filter(c => c.alert).map(c => ({
          campaign: c.name,
          alert: c.alert,
          spend: c.spend,
          leads: c.leads
        }))
      };
    }

    // Google Ads — read from snapshot (populated by enrich-ads.js from CSV exports)
    if (snapshot?.sections?.googleAds) {
      const g = snapshot.sections.googleAds;
      result.google = {
        source: g._source || 'Google Ads Export CSV (enriched in snapshot)',
        exportDate: g.exportDate || 'unknown',
        period: g.period || null,
        campaigns: (g.campaigns || []).map(c => ({
          name: c.name,
          status: c.active ? 'Enabled' : 'Paused',
          spend: c.spend || 0,
          clicks: c.clicks || 0,
          impressions: c.impressions || 0,
          conversions: c.conversions || 0,
          ctr: c.ctr ? `${c.ctr}%` : null
        })),
        totalSpend: g.totalSpend || 0,
        totalClicks: g.totalClicks || 0,
        totalConversions: g.totalConversions || 0,
        alerts: g.alerts || [],
        note: `Last enriched: ${g.enrichedAt || 'unknown'}`
      };
    } else {
      result.google = null;
      result.errors.push('Google Ads section missing from snapshot — run enrich-ads.js with a fresh Google CSV export');
    }

    // Combined summary
    const metaSpend = result.meta?.activeSpendTotal || 0;
    const googleSpend = result.google?.totalSpend || result.google?.spend || 0;
    result.combined = {
      totalAdSpend: Math.round((metaSpend + googleSpend) * 100) / 100,
      metaSpend,
      googleSpend,
      metaLeads: result.meta?.activeLeadsTotal || 0,
      googleClicks: result.google?.totalClicks || 0,
      blendedCPL: result.meta?.activeCPL || null,
      alertCount: result.meta?.alerts?.length || 0
    };

  } catch (e) {
    result.errors.push(`Ad data fetch error: ${e.message}`);
  }

  return result;
}

/**
 * Generate ad performance findings for agent reports.
 * Returns array of finding strings + task recommendations.
 */
export function analyzeAdPerformance(adData) {
  const findings = [];
  const tasks = [];

  if (!adData || adData.errors.length > 0) {
    findings.push(`Ad data unavailable: ${(adData?.errors || ['unknown error']).join(', ')}`);
    return { findings, tasks };
  }

  // Meta findings
  if (adData.meta) {
    const m = adData.meta;
    findings.push(`Meta Ads: $${m.activeSpendTotal} active spend, ${m.activeLeadsTotal} leads (CPL: $${m.activeCPL || 'N/A'})`);
    findings.push(`Meta lifetime: $${m.lifetime.totalSpend} total spend, ${m.lifetime.totalLeads} leads across ${m.lifetime.totalCampaigns} campaigns`);

    // Flag alerts
    for (const alert of m.alerts) {
      findings.push(`META ALERT: ${alert.campaign} - ${alert.alert} ($${alert.spend} spent, ${alert.leads} leads)`);
      tasks.push({
        title: `Review Meta campaign: ${alert.campaign}`,
        description: `${alert.alert}. Spent $${alert.spend} with only ${alert.leads} leads.`,
        priority: 'high'
      });
    }

    // Flag high CPL
    if (m.activeCPL && m.activeCPL > 50) {
      findings.push(`WARNING: Active Meta CPL is $${m.activeCPL} - above $50 threshold`);
      tasks.push({
        title: 'Meta Ads CPL too high',
        description: `Current CPL is $${m.activeCPL}. Best historical CPL was ~$3.45. Review active campaigns.`,
        priority: 'high'
      });
    }
  }

  // Google findings
  if (adData.google) {
    const g = adData.google;
    findings.push(`Google Ads${g.period ? ` (${g.period})` : ''}: $${g.totalSpend} spend, ${g.totalClicks} clicks, ${g.totalConversions || 0} conversions`);

    if (g.alerts?.length > 0) {
      for (const alert of g.alerts) {
        findings.push(`GOOGLE ALERT: ${alert.campaign} — ${alert.alert}`);
        tasks.push({ title: `Review Google campaign: ${alert.campaign}`, description: alert.alert, priority: 'high' });
      }
    }
  }

  // Combined
  if (adData.combined) {
    findings.push(`Combined ad spend: $${adData.combined.totalAdSpend} (Meta: $${adData.combined.metaSpend}, Google: $${adData.combined.googleSpend})`);
  }

  return { findings, tasks };
}
