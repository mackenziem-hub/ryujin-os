// ═══════════════════════════════════════════════════════════════
// META INSIGHTS FEEDER — daily ad-level performance into meta_insights.
// Pulls per-ad, per-day insights (spend, clicks, leads, full video
// watch-time) from the Meta Graph API and upserts them. Cron re-pulls a
// short trailing window (Meta finalizes data for a couple of days);
// ?days=90 does the initial backfill.
//
//   GET /api/feeders/meta-insights?tenant=plus-ultra        (cron, days=7)
//   GET /api/feeders/meta-insights?tenant=plus-ultra&days=90 (backfill)
//   Authorization: Bearer <CRON_SECRET | owner session | service token>
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../../lib/supabase.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { getMetaInsightsRows } from '../../lib/meta.js';

const PLUS_ULTRA_SLUG = 'plus-ultra';
const toCents = (n) => Math.round((Number(n) || 0) * 100);

export async function runMetaInsightsFeeder({ tenantSlug = PLUS_ULTRA_SLUG, days = 7 } = {}) {
  const report = { feeder: 'meta-insights', tenant: tenantSlug, days, rows_upserted: 0, errors: [] };

  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('id').eq('slug', tenantSlug).maybeSingle();
  if (!tenant) { report.errors.push(`tenant ${tenantSlug} not found`); return report; }

  const { since, until, rows } = await getMetaInsightsRows({ days, level: 'ad' });
  report.window = { since, until };
  if (!rows.length) { report.note = 'no rows returned from Meta for window'; return report; }

  const nowIso = new Date().toISOString();
  const records = rows
    .filter(r => r.adId && r.dateStart)
    .map(r => ({
      tenant_id: tenant.id,
      level: 'ad',
      object_id: r.adId,
      object_name: r.adName,
      campaign_id: r.campaignId,
      campaign_name: r.campaignName,
      adset_id: r.adsetId,
      adset_name: r.adsetName,
      date_start: r.dateStart,
      date_end: r.dateStop || r.dateStart,
      impressions: r.impressions,
      reach: r.reach,
      frequency: r.frequency,
      spend_cents: toCents(r.spend),
      cpm_cents: toCents(r.cpm),
      clicks: r.clicks,
      link_clicks: r.linkClicks,
      ctr: r.ctr,
      cpc_cents: toCents(r.cpc),
      leads: r.leads,
      cost_per_lead_cents: r.cpl != null ? toCents(r.cpl) : null,
      video_plays_3s: r.video.plays3s,
      video_thruplays: r.video.thruplays,
      video_p25: r.video.p25,
      video_p50: r.video.p50,
      video_p75: r.video.p75,
      video_p100: r.video.p100,
      video_avg_watch_sec: r.video.avgWatchSec,
      synced_at: nowIso,
      updated_at: nowIso
    }));

  for (let i = 0; i < records.length; i += 200) {
    const chunk = records.slice(i, i + 200);
    const { error } = await supabaseAdmin
      .from('meta_insights')
      .upsert(chunk, { onConflict: 'tenant_id,level,object_id,date_start' });
    if (error) report.errors.push(error.message);
    else report.rows_upserted += chunk.length;
  }
  return report;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const tenantSlug = (req.query?.tenant || req.headers['x-tenant-id'] || PLUS_ULTRA_SLUG).toString();
  const days = Math.min(Math.max(parseInt(req.query?.days || '7', 10) || 7, 1), 365);

  try {
    const report = await runMetaInsightsFeeder({ tenantSlug, days });
    return res.status(200).json({ ok: report.errors.length === 0, ...report });
  } catch (e) {
    console.error('[meta-insights feeder]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
