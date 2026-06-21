// ═══════════════════════════════════════════════════════════════
// GOOGLE ADS FEEDER — weekly Google Ads performance into snapshot.googleAds.
// Pulls per-campaign 30d spend/clicks/conversions + top wasted search terms
// from the Google Ads API (REST v21), flags freebie/junk terms, and POSTs the
// summary to /api/snapshot. Mirrors the Meta feeder + the marketing snapshot
// pattern. googleAds is already in api/snapshot.js preserveKeys.
//
//   GET /api/feeders/google-ads?tenant=plus-ultra   (cron)
//   Authorization: Bearer <CRON_SECRET | owner session | service token>
//
// Requires Vercel env: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
//   GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_DEVELOPER_TOKEN,
//   GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_LOGIN_CUSTOMER_ID
// ═══════════════════════════════════════════════════════════════

import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';

const V = 'v21';
const PLUS_ULTRA_SLUG = 'plus-ultra';
const JUNK = /(free roof|free roofing|senior|grant|low income|assistance|afford|no credit|99 a month|cheap|\bdiy\b|\bjobs?\b|career|salary|hiring|scholarship|ideal roofing|patch)/i;
const env = (k) => (process.env[k] || '').trim();
const micros = (v) => Math.round((Number(v || 0) / 1e6) * 100) / 100;

async function accessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_ADS_CLIENT_ID'),
      client_secret: env('GOOGLE_ADS_CLIENT_SECRET'),
      refresh_token: env('GOOGLE_ADS_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('google token refresh failed');
  return j.access_token;
}

async function gaql(query, tok) {
  const cid = env('GOOGLE_ADS_CUSTOMER_ID');
  const r = await fetch(`https://googleads.googleapis.com/${V}/customers/${cid}/googleAds:search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tok}`,
      'developer-token': env('GOOGLE_ADS_DEVELOPER_TOKEN'),
      'login-customer-id': env('GOOGLE_ADS_LOGIN_CUSTOMER_ID'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (j.error) throw new Error('GAQL: ' + JSON.stringify(j.error).slice(0, 300));
  return j.results || [];
}

export async function buildGoogleAdsSummary() {
  const tok = await accessToken();

  const camp30 = await gaql(`SELECT campaign.name, campaign.status, metrics.cost_micros,
    metrics.clicks, metrics.conversions, metrics.impressions
    FROM campaign WHERE segments.date DURING LAST_30_DAYS`, tok);
  const campaigns = camp30.map((r) => ({
    name: r.campaign.name,
    status: r.campaign.status,
    spend: micros(r.metrics?.costMicros),
    clicks: Number(r.metrics?.clicks || 0),
    conversions: Number(r.metrics?.conversions || 0),
    impressions: Number(r.metrics?.impressions || 0),
  })).filter((c) => c.spend > 0 || c.clicks > 0 || c.status === 'ENABLED')
    .sort((a, b) => b.spend - a.spend);

  const spend30 = campaigns.reduce((s, c) => s + c.spend, 0);
  const clicks30 = campaigns.reduce((s, c) => s + c.clicks, 0);
  const conv30 = campaigns.reduce((s, c) => s + c.conversions, 0);

  const terms = await gaql(`SELECT search_term_view.search_term, metrics.clicks,
    metrics.cost_micros, metrics.conversions FROM search_term_view
    WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.clicks DESC LIMIT 30`, tok);
  const wastedTerms = terms.map((r) => ({
    term: r.searchTermView?.searchTerm || '',
    clicks: Number(r.metrics?.clicks || 0),
    cost: micros(r.metrics?.costMicros),
    conversions: Number(r.metrics?.conversions || 0),
    junk: JUNK.test(r.searchTermView?.searchTerm || ''),
  }));
  const junkSpend = Math.round(wastedTerms.filter((t) => t.junk).reduce((s, t) => s + t.cost, 0) * 100) / 100;

  const alerts = [];
  if (spend30 > 0 && conv30 === 0) alerts.push(`$${spend30.toFixed(2)} spent / 0 conversions in 30d`);
  if (junkSpend > 0) alerts.push(`$${junkSpend.toFixed(2)} on freebie/junk search terms (add negatives)`);

  return {
    _source: 'Live Google Ads API v21',
    updated_at: new Date().toISOString(),
    customerId: env('GOOGLE_ADS_CUSTOMER_ID'),
    totals30d: { spend: Math.round(spend30 * 100) / 100, clicks: clicks30, conversions: conv30,
      costPerConv: conv30 ? Math.round((spend30 / conv30) * 100) / 100 : null },
    activeCampaignCount: campaigns.filter((c) => c.status === 'ENABLED').length,
    campaigns,
    wastedTerms,
    junkSpend30d: junkSpend,
    alerts,
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  try {
    if (!env('GOOGLE_ADS_REFRESH_TOKEN') || !env('GOOGLE_ADS_DEVELOPER_TOKEN')) {
      return res.status(503).json({ error: 'google ads creds not configured in env' });
    }
    const googleAds = await buildGoogleAdsSummary();

    const base = `https://${req.headers.host || 'ryujin-os.vercel.app'}`;
    const post = await fetch(`${base}/api/snapshot`, {
      method: 'POST', headers: snapshotHeaders(), body: JSON.stringify({ googleAds }),
    });
    return res.status(200).json({ ok: true, posted: post.status, totals30d: googleAds.totals30d, alerts: googleAds.alerts });
  } catch (e) {
    console.error('[google-ads feeder]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
