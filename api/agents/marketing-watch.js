// ═══════════════════════════════════════════════════════════════
// MARKETING WATCH — daily anomaly monitor for the ad pipeline.
// Reads meta_insights (last 7d vs prior 7d) + Meta token health and
// surfaces anomalies into inbox_items so they actually get attention:
//   - Meta token expiring (<14 days)
//   - CPL spike (recent vs prior > 50%)
//   - Leads down while spend up
//   - Spend with zero leads (last 7d)
// Idempotent: one alert per type per day (state_hash). Uses the existing
// 'marketing' agent slug (already in the agent_runs CHECK).
//
//   GET /api/agents/marketing-watch?tenant=plus-ultra   (cron/owner gated)
// ═══════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../../lib/supabase.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { checkTokenHealth } from '../../lib/meta.js';

const PLUS_ULTRA_SLUG = 'plus-ultra';
const dollars = (cents) => '$' + Math.round((cents || 0) / 100).toLocaleString('en-US');

async function surface(tenantId, { type, urgency, summary, body, runId }) {
  const today = new Date().toISOString().slice(0, 10);
  const convo = `marketing-watch:${type}`;
  const stateHash = createHash('sha1').update(`${convo}:${today}`).digest('hex').slice(0, 16);

  const { data: existing } = await supabaseAdmin.from('inbox_items')
    .select('id').eq('tenant_id', tenantId).eq('ghl_conversation_id', convo).eq('state_hash', stateHash).maybeSingle();
  if (existing) return false;

  const { error } = await supabaseAdmin.from('inbox_items').insert({
    tenant_id: tenantId,
    ghl_conversation_id: convo,
    ghl_contact_id: null,
    contact_name: 'Marketing Watch',
    channel: 'system',
    last_message_body: body.slice(0, 4000),
    last_message_at: new Date().toISOString(),
    last_message_id: `mw_${type}_${today}`,
    state_hash: stateHash,
    summary: summary.slice(0, 500),
    category: 'marketing',
    urgency,
    notify: true,
    notify_reason: summary.slice(0, 160),
    needs_reply: false,
    draft_reply: '',
    status: 'needs_review',
    agent_run_id: runId || null
  });
  return !error;
}

export async function runMarketingWatch({ tenantSlug = PLUS_ULTRA_SLUG } = {}) {
  const report = { agent: 'marketing-watch', tenant: tenantSlug, alerts: [], errors: [] };
  const { data: tenant } = await supabaseAdmin.from('tenants').select('id').eq('slug', tenantSlug).maybeSingle();
  if (!tenant) { report.errors.push(`tenant ${tenantSlug} not found`); return report; }
  const tid = tenant.id;

  // agent_runs row (slug 'marketing' is in the CHECK)
  let runId = null;
  try {
    const { data: run } = await supabaseAdmin.from('agent_runs')
      .insert({ tenant_id: tid, agent_slug: 'marketing', status: 'running' }).select('id').single();
    runId = run?.id || null;
  } catch { /* non-fatal */ }

  const fire = async (a) => { if (await surface(tid, { ...a, runId })) report.alerts.push(a.type); };

  // 1. token health
  try {
    const th = await checkTokenHealth();
    if (th && th.daysLeft != null && th.daysLeft < 14) {
      await fire({ type: 'token-expiring', urgency: th.daysLeft < 4 ? 'high' : 'normal',
        summary: `Meta token expires in ${th.daysLeft} days`,
        body: `The Meta access token (META_ACCESS_TOKEN) expires in ${th.daysLeft} days (${th.expiresAt}). Generate a new 60-day token in Meta Business Settings and update the Vercel env var, or ad ingestion + the marketing dashboard go dark.` });
    } else if (th && th.valid === false) {
      await fire({ type: 'token-invalid', urgency: 'high', summary: 'Meta token invalid',
        body: `Meta token check failed: ${th.error || 'invalid'}. Rotate META_ACCESS_TOKEN in Vercel.` });
    }
  } catch (e) { report.errors.push('token: ' + e.message); }

  // 2. meta_insights last 14d -> recent(0-7) vs prior(7-14)
  try {
    const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const mid = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const { data: rows, error } = await supabaseAdmin.from('meta_insights')
      .select('date_start,spend_cents,leads,object_name')
      .eq('tenant_id', tid).eq('level', 'ad').gte('date_start', since).limit(10000);
    if (error) throw new Error(error.message);

    const agg = (pred) => (rows || []).filter(pred).reduce((a, r) => ({ spend: a.spend + (r.spend_cents || 0), leads: a.leads + (r.leads || 0) }), { spend: 0, leads: 0 });
    const recent = agg(r => r.date_start >= mid);
    const prior = agg(r => r.date_start < mid);
    const cpl = (p) => p.leads > 0 ? p.spend / p.leads : null;
    const rCpl = cpl(recent), pCpl = cpl(prior);

    if (rCpl != null && pCpl != null && rCpl > pCpl * 1.5 && recent.spend > 10000) {
      await fire({ type: 'cpl-spike', urgency: 'normal',
        summary: `CPL up ${Math.round((rCpl / pCpl - 1) * 100)}% week-over-week`,
        body: `Cost per lead rose from ${dollars(pCpl)} to ${dollars(rCpl)} in the last 7 days (spend ${dollars(recent.spend)}, ${recent.leads} leads). Review the lead-intent campaigns.` });
    }
    if (recent.spend > prior.spend && recent.leads < prior.leads && prior.leads > 0) {
      await fire({ type: 'leads-down-spend-up', urgency: 'high',
        summary: `Leads down (${prior.leads} -> ${recent.leads}) while spend up`,
        body: `Last 7d: spend ${dollars(recent.spend)} (up from ${dollars(prior.spend)}) but leads fell from ${prior.leads} to ${recent.leads}. Something in the funnel or creative is leaking.` });
    }
    if (recent.spend > 20000 && recent.leads === 0) {
      await fire({ type: 'spend-zero-leads', urgency: 'high',
        summary: `${dollars(recent.spend)} spent, 0 leads (7d)`,
        body: `Last 7 days spent ${dollars(recent.spend)} with zero leads recorded. Check pixel firing + lead-form delivery (some of this may be awareness/video).` });
    }
  } catch (e) { report.errors.push('insights: ' + e.message); }

  if (runId) {
    try {
      await supabaseAdmin.from('agent_runs').update({
        status: report.errors.length ? 'partial' : 'success',
        completed_at: new Date().toISOString(),
        summary: `${report.alerts.length} alerts: ${report.alerts.join(', ') || 'none'}`
      }).eq('id', runId);
    } catch { /* non-fatal */ }
  }
  return report;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  const tenantSlug = (req.query?.tenant || req.headers['x-tenant-id'] || PLUS_ULTRA_SLUG).toString();
  try {
    const report = await runMarketingWatch({ tenantSlug });
    return res.status(200).json({ ok: report.errors.length === 0, ...report });
  } catch (e) {
    console.error('[marketing-watch]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
