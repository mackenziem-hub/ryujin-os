// ═══════════════════════════════════════════════════════════════
// META ADS API HELPER — Graph API v21.0
// Used by /api/meta-ads.js (cron) and agents for live ad data
// Requires env vars: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID
// Optional: META_APP_ID, META_APP_SECRET (for token refresh)
// ═══════════════════════════════════════════════════════════════

const GRAPH_API = 'https://graph.facebook.com/v21.0';

function getConfig() {
  const token = (process.env.META_ACCESS_TOKEN || '').trim();
  const adAccountId = (process.env.META_AD_ACCOUNT_ID || '').trim();
  if (!token) throw new Error('META_ACCESS_TOKEN not configured in Vercel env vars');
  if (!adAccountId) throw new Error('META_AD_ACCOUNT_ID not configured in Vercel env vars');
  return { token, adAccountId };
}

async function graphGet(path, params = {}) {
  const { token } = getConfig();
  const url = new URL(`${GRAPH_API}${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Meta API ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

async function graphPost(path, body = {}) {
  const { token } = getConfig();
  const resp = await fetch(`${GRAPH_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: token, ...body }),
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`Meta API POST ${resp.status}: ${errBody.slice(0, 300)}`);
  }
  return resp.json();
}

// ── Token auto-refresh ──
// Exchanges a short-lived token for a long-lived one (~60 days).
// If META_APP_ID and META_APP_SECRET are set, the daily cron will
// attempt to refresh automatically when the token is within 7 days of expiry.
export async function refreshLongLivedToken() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const currentToken = process.env.META_ACCESS_TOKEN;
  if (!appId || !appSecret || !currentToken) {
    return { refreshed: false, error: 'Missing META_APP_ID, META_APP_SECRET, or META_ACCESS_TOKEN' };
  }
  try {
    const url = new URL(`${GRAPH_API}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('fb_exchange_token', currentToken);
    const resp = await fetch(url.toString());
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return { refreshed: false, error: `Token exchange failed: ${resp.status} — ${body.slice(0, 200)}` };
    }
    const data = await resp.json();
    if (data.access_token) {
      return {
        refreshed: true,
        newToken: data.access_token,
        expiresIn: data.expires_in || null,
        note: 'New long-lived token generated. Update META_ACCESS_TOKEN in Vercel env vars with this value.'
      };
    }
    return { refreshed: false, error: 'No access_token in response' };
  } catch (e) {
    return { refreshed: false, error: e.message };
  }
}

// ── Token health check ──
export async function checkTokenHealth() {
  const { token } = getConfig();
  try {
    const data = await graphGet('/debug_token', { input_token: token });
    const info = data.data || {};
    const expiresAt = info.expires_at ? new Date(info.expires_at * 1000).toISOString() : null;
    const daysLeft = info.expires_at ? Math.floor((info.expires_at * 1000 - Date.now()) / 86400000) : null;

    // Warn if within 14 days of expiry — do NOT auto-exchange,
    // because the exchange invalidates the old token and we can't
    // write the new one back to Vercel env vars.
    let expiryWarning = null;
    if (daysLeft !== null && daysLeft < 14) {
      expiryWarning = `META_ACCESS_TOKEN expires in ${daysLeft} days (${expiresAt}). Generate a new 60-day token in Meta Business Settings and update the Vercel env var.`;
    }

    return {
      valid: info.is_valid,
      expiresAt,
      daysLeft,
      scopes: info.scopes || [],
      appId: info.app_id || null,
      expiryWarning
    };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// ── Get all campaigns with insights ──
export async function getCampaigns(datePreset = 'maximum') {
  const { adAccountId } = getConfig();

  // Pull campaigns with status
  const campaigns = await graphGet(`/${adAccountId}/campaigns`, {
    fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,updated_time',
    limit: '50'
  });

  const results = [];
  for (const campaign of (campaigns.data || [])) {
    // Pull insights for each campaign
    let insights = null;
    try {
      const insightResp = await graphGet(`/${campaign.id}/insights`, {
        fields: 'spend,impressions,reach,frequency,cpm,cpc,ctr,clicks,actions,cost_per_action_type',
        date_preset: datePreset
      });
      insights = insightResp.data?.[0] || null;
    } catch (e) {
      // Campaign may have no data for this period
    }

    // Extract lead/result actions
    let results_count = 0;
    let resultType = null;
    let cpl = null;
    if (insights?.actions) {
      // Look for lead-type actions in priority order
      const leadActions = [
        'offsite_conversion.fb_pixel_lead',
        'lead',
        'onsite_conversion.lead_grouped',
        'offsite_conversion.fb_pixel_custom',
        'landing_page_view'
      ];
      for (const actionType of leadActions) {
        const action = insights.actions.find(a => a.action_type === actionType);
        if (action && parseInt(action.value) > 0) {
          results_count = parseInt(action.value);
          resultType = actionType;
          break;
        }
      }
      // Fallback: total actions
      if (results_count === 0) {
        const totalAction = insights.actions.find(a => a.action_type === 'omni_complete_registration');
        if (totalAction) {
          results_count = parseInt(totalAction.value);
          resultType = 'omni_complete_registration';
        }
      }
    }
    if (insights?.cost_per_action_type && resultType) {
      const cpa = insights.cost_per_action_type.find(a => a.action_type === resultType);
      if (cpa) cpl = parseFloat(cpa.value);
    }

    const spend = parseFloat(insights?.spend || 0);
    const isActive = campaign.status === 'ACTIVE';

    // Alert generation
    let alert = null;
    if (isActive && results_count === 0 && spend > 50) {
      alert = `Active but ZERO results despite $${spend.toFixed(2)} spend`;
    } else if (isActive && cpl !== null && cpl > 50) {
      alert = `High CPL ($${cpl.toFixed(2)}) — above $50 threshold`;
    }

    results.push({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      active: isActive,
      objective: campaign.objective,
      dailyBudget: campaign.daily_budget ? parseFloat(campaign.daily_budget) / 100 : null,
      spend,
      impressions: parseInt(insights?.impressions || 0),
      reach: parseInt(insights?.reach || 0),
      frequency: parseFloat(insights?.frequency || 0),
      cpm: parseFloat(insights?.cpm || 0),
      cpc: parseFloat(insights?.cpc || 0),
      ctr: parseFloat(insights?.ctr || 0),
      clicks: parseInt(insights?.clicks || 0),
      results: results_count,
      resultType,
      cpl,
      alert
    });
  }

  return results;
}

// ── Get ad set breakdown for a campaign ──
export async function getAdSets(campaignId) {
  const data = await graphGet(`/${campaignId}/adsets`, {
    fields: 'id,name,status,effective_status,daily_budget,optimization_goal,billing_event,promoted_object,destination_type',
    limit: '50'
  });

  const adSets = [];
  for (const adSet of (data.data || [])) {
    let insights = null;
    try {
      const insightResp = await graphGet(`/${adSet.id}/insights`, {
        fields: 'spend,impressions,reach,clicks,actions,cost_per_action_type',
        date_preset: 'last_7d'
      });
      insights = insightResp.data?.[0] || null;
    } catch (e) { /* no data */ }

    adSets.push({
      id: adSet.id,
      name: adSet.name,
      status: adSet.status,
      effectiveStatus: adSet.effective_status || null,
      dailyBudget: adSet.daily_budget ? parseFloat(adSet.daily_budget) / 100 : null,
      optimizationGoal: adSet.optimization_goal || null,
      billingEvent: adSet.billing_event || null,
      destinationType: adSet.destination_type || null,
      promotedObject: adSet.promoted_object || null,
      customEventType: adSet.promoted_object?.custom_event_type || null,
      pixelId: adSet.promoted_object?.pixel_id || null,
      customConversionId: adSet.promoted_object?.custom_conversion_id || null,
      spend: parseFloat(insights?.spend || 0),
      impressions: parseInt(insights?.impressions || 0),
      reach: parseInt(insights?.reach || 0),
      clicks: parseInt(insights?.clicks || 0)
    });
  }
  return adSets;
}

// ── Config audit: list every ad set with its optimization config + flags ──
// Answers "are my campaigns actually optimizing for what I think they are."
// Single-call design (account-level adsets endpoint with campaign field expansion)
// to stay under Meta's per-account API rate limit (error code 17 / subcode 2446079).
// Flags any active ad set optimizing for a low-intent goal (LANDING_PAGE_VIEWS,
// LINK_CLICKS, IMPRESSIONS, REACH, THRUPLAY, POST_ENGAGEMENT) when the campaign
// objective is OUTCOME_LEADS or OUTCOME_SALES.
export async function auditAdSetConfig() {
  const { adAccountId } = getConfig();

  const data = await graphGet(`/${adAccountId}/adsets`, {
    fields: 'id,name,status,effective_status,daily_budget,optimization_goal,billing_event,destination_type,promoted_object,campaign{id,name,objective,status,effective_status}',
    limit: '200'
  });

  const LOW_INTENT_GOALS = new Set([
    'LANDING_PAGE_VIEWS', 'LINK_CLICKS', 'IMPRESSIONS', 'REACH',
    'THRUPLAY', 'POST_ENGAGEMENT', 'PAGE_LIKES', 'VIDEO_VIEWS'
  ]);
  const LEAD_OBJECTIVES = new Set([
    'OUTCOME_LEADS', 'OUTCOME_SALES', 'LEAD_GENERATION', 'CONVERSIONS'
  ]);

  const audit = (data.data || []).map(a => {
    const c = a.campaign || {};
    const adSetActive = (a.effective_status || a.status) === 'ACTIVE';
    const campaignActive = (c.effective_status || c.status) === 'ACTIVE';
    const isActive = adSetActive && campaignActive;
    const customEventType = a.promoted_object?.custom_event_type || null;
    const customConversionId = a.promoted_object?.custom_conversion_id || null;
    const pixelId = a.promoted_object?.pixel_id || null;

    const flags = [];
    if (isActive && LEAD_OBJECTIVES.has(c.objective) && LOW_INTENT_GOALS.has(a.optimization_goal)) {
      flags.push(`Optimizing for ${a.optimization_goal} but campaign objective is ${c.objective} — should be OFFSITE_CONVERSIONS or LEAD_GENERATION`);
    }
    if (isActive && LEAD_OBJECTIVES.has(c.objective) && !customEventType && !customConversionId && a.optimization_goal !== 'LEAD_GENERATION') {
      flags.push(`No conversion event set on ad set — Meta cannot optimize toward leads`);
    }

    return {
      campaignId: c.id || null,
      campaign: c.name || null,
      campaignObjective: c.objective || null,
      campaignStatus: c.effective_status || c.status || null,
      adSetId: a.id,
      adSet: a.name,
      status: a.effective_status || a.status,
      active: isActive,
      optimizationGoal: a.optimization_goal || null,
      billingEvent: a.billing_event || null,
      destinationType: a.destination_type || null,
      customEventType,
      customConversionId,
      pixelId,
      dailyBudget: a.daily_budget ? parseFloat(a.daily_budget) / 100 : null,
      flagged: flags.length > 0,
      flags
    };
  });

  const flagged = audit.filter(a => a.flagged);
  return {
    auditedAt: new Date().toISOString(),
    totalAdSets: audit.length,
    activeAdSets: audit.filter(a => a.active).length,
    flaggedCount: flagged.length,
    flagged,
    adSets: audit
  };
}

// ── Build the full metaAds snapshot section ──
export async function buildMetaAdsSnapshot() {
  const campaigns = await getCampaigns('maximum');
  const today = new Date().toISOString().slice(0, 10);

  const activeCampaigns = campaigns.filter(c => c.active);
  const inactiveCampaigns = campaigns.filter(c => !c.active);
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totalLeads = campaigns.reduce((s, c) => s + c.results, 0);

  // Top performers: lowest CPL among campaigns with 10+ leads
  const topPerformers = [...campaigns]
    .filter(c => c.cpl !== null && c.results >= 10)
    .sort((a, b) => a.cpl - b.cpl)
    .slice(0, 5)
    .map(c => ({ name: c.name, cpl: c.cpl, spend: c.spend, leads: c.results }));

  // Also pull last 7 days for active campaigns (for trend detection)
  let activeRecent = [];
  try {
    const recentCampaigns = await getCampaigns('last_7d');
    activeRecent = recentCampaigns.filter(c => c.active).map(c => ({
      name: c.name,
      spend7d: c.spend,
      leads7d: c.results,
      cpl7d: c.cpl,
      impressions7d: c.impressions
    }));
  } catch (e) { /* optional */ }

  return {
    _source: 'Live Meta Graph API v21.0',
    exportDate: today,
    enrichedAt: new Date().toISOString(),
    totalCampaigns: campaigns.length,
    activeCampaignCount: activeCampaigns.length,
    totalSpend: Math.round(totalSpend * 100) / 100,
    totalAllLeads: totalLeads,
    avgCPL: totalLeads > 0 ? Math.round((totalSpend / totalLeads) * 100) / 100 : null,
    activeCampaigns: activeCampaigns.map(c => ({
      name: c.name, id: c.id, status: c.status, spend: c.spend,
      impressions: c.impressions, reach: c.reach, frequency: c.frequency,
      cpm: c.cpm, results: c.results, resultType: c.resultType,
      cpl: c.cpl, clicks: c.clicks, dailyBudget: c.dailyBudget,
      alert: c.alert
    })),
    inactiveCampaigns: inactiveCampaigns.map(c => ({
      name: c.name, id: c.id, status: c.status, spend: c.spend,
      impressions: c.impressions, reach: c.reach, results: c.results,
      resultType: c.resultType, cpl: c.cpl, clicks: c.clicks,
      alert: c.alert
    })),
    last7d: activeRecent,
    topPerformers,
    alerts: campaigns.filter(c => c.alert).map(c => ({
      campaign: c.name, alert: c.alert, spend: c.spend, leads: c.results
    }))
  };
}

// ── Campaign Management (write operations) ──

// Update campaign status: ACTIVE or PAUSED
export async function updateCampaignStatus(campaignId, status) {
  if (!['ACTIVE', 'PAUSED'].includes(status)) {
    throw new Error(`Invalid status "${status}" — must be ACTIVE or PAUSED`);
  }
  return graphPost(`/${campaignId}`, { status });
}

// Update campaign daily budget (in dollars — API expects cents)
export async function updateCampaignBudget(campaignId, dailyBudgetDollars) {
  const cents = Math.round(dailyBudgetDollars * 100);
  return graphPost(`/${campaignId}`, { daily_budget: cents });
}

// Update ad set status: ACTIVE or PAUSED
export async function updateAdSetStatus(adSetId, status) {
  if (!['ACTIVE', 'PAUSED'].includes(status)) {
    throw new Error(`Invalid status "${status}" — must be ACTIVE or PAUSED`);
  }
  return graphPost(`/${adSetId}`, { status });
}

// Update ad set daily budget (in dollars)
export async function updateAdSetBudget(adSetId, dailyBudgetDollars) {
  const cents = Math.round(dailyBudgetDollars * 100);
  return graphPost(`/${adSetId}`, { daily_budget: cents });
}

// Update ad set's promoted_object (which conversion event it optimizes for).
// Pass an object like { pixel_id, custom_event_type } for standard events
// (LEAD, CONTACT, SCHEDULE, PURCHASE, etc.) or { pixel_id, custom_conversion_id }
// for a custom conversion. Meta requires the value as a JSON-encoded string.
export async function updateAdSetPromotedObject(adSetId, promotedObject) {
  if (!promotedObject || typeof promotedObject !== 'object') {
    throw new Error('promotedObject must be an object');
  }
  return graphPost(`/${adSetId}`, { promoted_object: JSON.stringify(promotedObject) });
}

// Get a single ad set with its full promoted_object expanded.
export async function getAdSetFull(adSetId) {
  const data = await graphGet(`/${adSetId}`, {
    fields: 'id,name,status,effective_status,daily_budget,optimization_goal,billing_event,destination_type,promoted_object,campaign{id,name,objective,status,effective_status}'
  });
  return data;
}

// Get pixel event volume over a window. Returns { eventName: count }.
// Meta's /{pixelId}/stats?aggregation=event returns one row per event with
// daily breakdowns; we sum across the window.
export async function getPixelEventStats(pixelId, days = 7) {
  const startUnix = Math.floor(Date.now() / 1000) - (days * 86400);
  const data = await graphGet(`/${pixelId}/stats`, {
    aggregation: 'event',
    start_time: String(startUnix)
  });
  const counts = {};
  for (const row of (data.data || [])) {
    const evt = row.event || row.value || 'unknown';
    const c = parseInt(row.count || 0);
    counts[evt] = (counts[evt] || 0) + c;
  }
  return counts;
}

// Convenience: pause a campaign
export async function pauseCampaign(campaignId) {
  return updateCampaignStatus(campaignId, 'PAUSED');
}

// Convenience: resume a campaign
export async function resumeCampaign(campaignId) {
  return updateCampaignStatus(campaignId, 'ACTIVE');
}

// ── Pixel Audit Functions ──

export async function listPixels() {
  const { adAccountId } = getConfig();
  const data = await graphGet(`/${adAccountId}/adspixels`, {
    fields: 'id,name,creation_time,last_fired_time,is_unavailable,enable_automatic_matching,automatic_matching_fields',
    limit: '50'
  });
  return data.data || [];
}

export async function getPixelStats(pixelId) {
  const data = await graphGet(`/${pixelId}/stats`);
  return data.data || [];
}

export async function getPixelDiagnostics(pixelId) {
  const data = await graphGet(`/${pixelId}/da_checks`);
  return data.data || [];
}

export async function listCustomConversions() {
  const { adAccountId } = getConfig();
  const data = await graphGet(`/${adAccountId}/customconversions`, {
    fields: 'id,name,custom_event_type,rule,default_conversion_value,last_fired_time,is_archived',
    limit: '50'
  });
  return data.data || [];
}

// ── Custom Audiences ──
// Lists all custom audiences on the ad account. For retarget-funnel health,
// we care about: size growing, not in delivery error, data source known.
// Meta returns approximate_count_lower/upper_bound (exact counts are hidden
// for privacy); use the midpoint as a usable estimate.
export async function listCustomAudiences() {
  const { adAccountId } = getConfig();
  const data = await graphGet(`/${adAccountId}/customaudiences`, {
    fields: 'id,name,description,subtype,approximate_count_lower_bound,approximate_count_upper_bound,data_source,retention_days,time_created,time_updated,operation_status,delivery_status',
    limit: '100'
  });
  return (data.data || []).map(a => {
    const lo = a.approximate_count_lower_bound ?? null;
    const hi = a.approximate_count_upper_bound ?? null;
    const estimatedSize = (lo !== null && hi !== null) ? Math.round((lo + hi) / 2) : null;
    return {
      id: a.id,
      name: a.name,
      description: a.description || null,
      subtype: a.subtype || null,
      sizeLow: lo,
      sizeHigh: hi,
      estimatedSize,
      retentionDays: a.retention_days || null,
      dataSourceType: a.data_source?.type || null,
      dataSourceSubtype: a.data_source?.sub_type || null,
      operationStatus: a.operation_status?.code || null,
      operationDescription: a.operation_status?.description || null,
      deliveryStatusCode: a.delivery_status?.code || null,
      deliveryStatusDescription: a.delivery_status?.description || null,
      createdAt: a.time_created ? new Date(a.time_created * 1000).toISOString() : null,
      updatedAt: a.time_updated ? new Date(a.time_updated * 1000).toISOString() : null
    };
  });
}

// ── Video View Audience Creation ──
// Pulls active video ads on the account and returns each ad's video_id + name
// so we can build retarget audiences off them.
export async function getActiveVideoAds() {
  const { adAccountId } = getConfig();
  const data = await graphGet(`/${adAccountId}/ads`, {
    fields: 'id,name,status,effective_status,creative{id,video_id,object_story_spec,thumbnail_url}',
    effective_status: '["ACTIVE"]',
    limit: '100'
  });
  const ads = (data.data || []).map(a => {
    const videoId = a.creative?.video_id
      || a.creative?.object_story_spec?.video_data?.video_id
      || null;
    return {
      adId: a.id,
      name: a.name,
      status: a.effective_status || a.status,
      videoId,
      creativeId: a.creative?.id || null
    };
  }).filter(a => a.videoId);
  // Dedupe by videoId — same video can be reused across ads
  const seen = new Set();
  return ads.filter(a => seen.has(a.videoId) ? false : (seen.add(a.videoId), true));
}

// ════════════════════════════════════════════════════════════════
// AD SWEEP - full-fidelity ad/campaign insights incl. video watch-time
// over a date window. Pure reader; backs api/meta-sweep.js and (later)
// the meta_insights feeder. The standard insights call elsewhere omits
// video + link-click + thruplay fields; this pulls everything.
// ════════════════════════════════════════════════════════════════

const SWEEP_LEAD_TYPES = [
  'offsite_conversion.fb_pixel_lead',
  'lead',
  'onsite_conversion.lead_grouped',
  'leadgen.other'
];

const SWEEP_FIELDS = [
  'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
  'spend', 'impressions', 'reach', 'frequency', 'clicks', 'inline_link_clicks',
  'ctr', 'cpc', 'cpm', 'actions', 'cost_per_action_type',
  'video_play_actions', 'video_thruplay_watched_actions',
  'video_p25_watched_actions', 'video_p50_watched_actions',
  'video_p75_watched_actions', 'video_p100_watched_actions',
  'video_avg_time_watched_actions'
].join(',');

function sweepBestLead(actions) {
  if (!Array.isArray(actions)) return 0;
  for (const t of SWEEP_LEAD_TYPES) {
    const a = actions.find(x => x.action_type === t);
    if (a && parseInt(a.value, 10) > 0) return parseInt(a.value, 10);
  }
  return 0;
}

// video_*_watched_actions come back as [{ action_type:'video_view', value }]
function sweepActionVal(arr) {
  if (!Array.isArray(arr) || !arr.length) return 0;
  return parseFloat(arr[0]?.value || 0) || 0;
}

function sweepShape(r) {
  const spend = parseFloat(r.spend || 0);
  const impressions = parseInt(r.impressions || 0, 10);
  const leads = sweepBestLead(r.actions);
  const v3s = sweepActionVal(r.video_play_actions);
  const thru = sweepActionVal(r.video_thruplay_watched_actions);
  const p25 = sweepActionVal(r.video_p25_watched_actions);
  const p50 = sweepActionVal(r.video_p50_watched_actions);
  const p75 = sweepActionVal(r.video_p75_watched_actions);
  const p100 = sweepActionVal(r.video_p100_watched_actions);
  const avgWatch = sweepActionVal(r.video_avg_time_watched_actions);
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
  return {
    adId: r.ad_id || null,
    adName: r.ad_name || null,
    adsetId: r.adset_id || null,
    adsetName: r.adset_name || null,
    campaignId: r.campaign_id || null,
    campaignName: r.campaign_name || null,
    spend: Math.round(spend * 100) / 100,
    impressions,
    reach: parseInt(r.reach || 0, 10),
    frequency: parseFloat(r.frequency || 0),
    clicks: parseInt(r.clicks || 0, 10),
    linkClicks: parseInt(r.inline_link_clicks || 0, 10),
    ctr: parseFloat(r.ctr || 0),
    cpc: parseFloat(r.cpc || 0),
    cpm: parseFloat(r.cpm || 0),
    leads,
    cpl: leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
    video: {
      plays3s: v3s, thruplays: thru, p25, p50, p75, p100,
      avgWatchSec: Math.round(avgWatch * 10) / 10,
      hookRate: pct(v3s, impressions),     // % of impressions reaching 3s
      holdRate: pct(p100, v3s),            // % of 3s-viewers who finished
      thruplayRate: pct(thru, impressions)
    }
  };
}

async function sweepPullInsights(level, since, until) {
  const { adAccountId } = getConfig();
  const rows = [];
  let after = null;
  let guard = 0;
  do {
    const params = {
      level,
      time_range: JSON.stringify({ since, until }),
      fields: SWEEP_FIELDS,
      limit: '200'
    };
    if (after) params.after = after;
    const resp = await graphGet(`/${adAccountId}/insights`, params);
    for (const r of (resp.data || [])) rows.push(r);
    after = (resp.paging?.next && resp.paging?.cursors?.after) ? resp.paging.cursors.after : null;
    guard += 1;
  } while (after && guard < 25);
  return rows;
}

export async function getMetaSweep({ days = 90 } = {}) {
  const { adAccountId } = getConfig();
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const [adRows, campRows] = await Promise.all([
    sweepPullInsights('ad', since, until),
    sweepPullInsights('campaign', since, until)
  ]);
  const ads = adRows.map(sweepShape).sort((a, b) => b.spend - a.spend);
  const campaigns = campRows.map(sweepShape).sort((a, b) => b.spend - a.spend);

  // Roster of ads created in the window (captures zero-delivery ads that
  // never show up in insights).
  let roster = [];
  try {
    const sinceEpoch = Math.floor(new Date(since).getTime() / 1000);
    const rosterResp = await graphGet(`/${adAccountId}/ads`, {
      fields: 'id,name,created_time,effective_status,campaign{id,name},creative{video_id,thumbnail_url}',
      filtering: JSON.stringify([{ field: 'created_time', operator: 'GREATER_THAN', value: sinceEpoch }]),
      limit: '300'
    });
    roster = (rosterResp.data || []).map(a => ({
      adId: a.id,
      name: a.name,
      createdTime: a.created_time,
      status: a.effective_status || null,
      campaignId: a.campaign?.id || null,
      campaignName: a.campaign?.name || null,
      videoId: a.creative?.video_id || null
    }));
  } catch (e) {
    roster = [{ error: e.message }];
  }

  const totals = ads.reduce((t, a) => ({
    spend: t.spend + a.spend,
    impressions: t.impressions + a.impressions,
    clicks: t.clicks + a.clicks,
    leads: t.leads + a.leads,
    thruplays: t.thruplays + (a.video.thruplays || 0)
  }), { spend: 0, impressions: 0, clicks: 0, leads: 0, thruplays: 0 });
  totals.spend = Math.round(totals.spend * 100) / 100;
  totals.cpl = totals.leads > 0 ? Math.round((totals.spend / totals.leads) * 100) / 100 : null;
  totals.adsDelivered = ads.length;
  totals.adsCreatedInWindow = Array.isArray(roster) ? roster.length : 0;

  return { window: { since, until, days }, adAccountId, totals, campaigns, ads, roster };
}

// Daily-granular ad-level insights for the meta_insights feeder. Same fields as
// the sweep but with time_increment=1 so each row is one ad x one day, carrying
// date_start/date_stop for trend storage.
export async function getMetaInsightsRows({ days = 90, level = 'ad' } = {}) {
  const { adAccountId } = getConfig();
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = [];
  let after = null;
  let guard = 0;
  do {
    const params = {
      level,
      time_range: JSON.stringify({ since, until }),
      time_increment: '1',
      fields: SWEEP_FIELDS + ',date_start,date_stop',
      limit: '300'
    };
    if (after) params.after = after;
    const resp = await graphGet(`/${adAccountId}/insights`, params);
    for (const r of (resp.data || [])) {
      rows.push({ ...sweepShape(r), dateStart: r.date_start, dateStop: r.date_stop });
    }
    after = (resp.paging?.next && resp.paging?.cursors?.after) ? resp.paging.cursors.after : null;
    guard += 1;
  } while (after && guard < 80);
  return { since, until, level, rows };
}

// Map each percent tier to the legacy engagement event name. This ad account does
// NOT support Meta's flexible-spec rule format (POST returns subcode 1870049 "Rule
// Format Not Available") nor the template format (1713098 "Invalid rule JSON
// format"). Its working video-view audiences use the legacy rule shape: a JSON
// array of { event_name, object_id }, where object_id is the video id. Event names
// verified against the account's live 10CM viewer audiences (2026-06-03).
const VIDEO_EVENT_BY_PCT = {
  25: 'video_view_25_percent',
  50: 'video_view_50_percent',
  75: 'video_view_75_percent',
  95: 'video_completed' // ThruPlay / completed view
};

// Create one video-view custom audience for a given video + percent threshold.
// percentThreshold: 25 | 50 | 75 | 95 (95 = completed / ThruPlay).
export async function createVideoViewAudience({ videoId, name, percentThreshold, retentionDays = 30 }) {
  const { token, adAccountId } = getConfig();

  const eventName = VIDEO_EVENT_BY_PCT[percentThreshold];
  if (!eventName) throw new Error(`Unsupported percent threshold: ${percentThreshold}`);

  const vid = String(videoId);
  if (!/^\d+$/.test(vid)) throw new Error(`Invalid videoId (non-numeric): ${videoId}`);

  // Legacy engagement rule shape (the only one this account accepts). object_id is
  // the numeric video id; built as a raw number literal so 16-digit ids past 2^53
  // are not rounded by JS Number(). Retention is set via top-level retention_days.
  // Video-view audiences are inherently retroactive within the retention window,
  // so this backfills viewers since the campaign launched.
  const rule = `[{"event_name":${JSON.stringify(eventName)},"object_id":${vid}}]`;

  const resp = await fetch(`${GRAPH_API}/${adAccountId}/customaudiences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: token,
      name,
      subtype: 'ENGAGEMENT',
      retention_days: retentionDays,
      rule,
      description: `Auto-created by Ryujin: viewers who hit ${percentThreshold}% of video ${videoId}, last ${retentionDays} days`
    })
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Create audience failed (${name}): ${resp.status} - ${body.slice(0, 300)}`);
  }
  return resp.json();
}

// Build the standard 4-tier audience set for a single video.
export async function buildStandardVideoAudienceSet({ videoId, videoLabel, retentionDays = 30 }) {
  const tiers = [25, 50, 75, 95];
  const results = [];
  for (const pct of tiers) {
    const name = `Video — ${videoLabel} — ${pct === 95 ? 'ThruPlay' : pct + '%'} / ${retentionDays}d`;
    try {
      const r = await createVideoViewAudience({ videoId, name, percentThreshold: pct, retentionDays });
      results.push({ tier: pct, name, audienceId: r.id, status: 'created' });
    } catch (e) {
      results.push({ tier: pct, name, status: 'error', error: e.message });
    }
  }
  return results;
}

// ── Custom Conversion Management ──

export async function createCustomConversion({ name, rule, eventType = 'OTHER', defaultValue = 0, pixelId = '1166833781416817' }) {
  const { token, adAccountId } = getConfig();
  const resp = await fetch(`${GRAPH_API}/${adAccountId}/customconversions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: token,
      name,
      custom_event_type: eventType,
      rule,
      event_source_id: pixelId,
      default_conversion_value: defaultValue
    })
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Create custom conversion failed: ${resp.status} — ${body.slice(0, 300)}`);
  }
  return resp.json();
}

// ── Conversions API (CAPI) ──
// Sends server-side events to Meta for deduplication + better optimization.
// Pixel ID is the active "Plus Ultra Roofing Event Data" pixel.

const PIXEL_ID = '1166833781416817';

export async function sendCAPIEvent({ eventName, eventTime, eventId, sourceUrl, userData, customData }) {
  const { token } = getConfig();

  // Hash user data fields (Meta requires SHA-256 for PII)
  // ip, userAgent, and external_id must NOT be hashed — Meta expects them as plain text
  const SKIP_HASH = new Set(['ip', 'userAgent', 'external_id', 'fbc', 'fbp']);
  const hashedUserData = {};
  if (userData) {
    for (const [key, value] of Object.entries(userData)) {
      if (SKIP_HASH.has(key)) continue;
      if (value && typeof value === 'string') {
        // Meta expects lowercase, trimmed, then SHA-256 hashed
        const normalized = value.toLowerCase().trim();
        const encoder = new TextEncoder();
        const data = encoder.encode(normalized);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        hashedUserData[key] = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      }
    }
  }

  const eventData = {
    event_name: eventName,
    event_time: eventTime || Math.floor(Date.now() / 1000),
    event_id: eventId || `ryujin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    action_source: 'website',
    event_source_url: sourceUrl || 'https://plusultraroofing.com',
    user_data: {
      ...(userData?.ip ? { client_ip_address: userData.ip } : {}),
      ...(userData?.userAgent ? { client_user_agent: userData.userAgent } : {}),
      ...(userData?.external_id ? { external_id: userData.external_id } : {}),
      ...(userData?.fbc ? { fbc: userData.fbc } : {}),
      ...(userData?.fbp ? { fbp: userData.fbp } : {}),
      ...hashedUserData
    }
  };

  if (customData) {
    eventData.custom_data = customData;
  }

  const resp = await fetch(`${GRAPH_API}/${PIXEL_ID}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: token,
      data: [eventData]
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`CAPI event failed: ${resp.status} — ${body.slice(0, 300)}`);
  }
  return resp.json();
}

// Send a batch of CAPI events at once
export async function sendCAPIEventBatch(events) {
  const { token } = getConfig();

  const resp = await fetch(`${GRAPH_API}/${PIXEL_ID}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: token,
      data: events
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`CAPI batch failed: ${resp.status} — ${body.slice(0, 300)}`);
  }
  return resp.json();
}
