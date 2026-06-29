// ═══════════════════════════════════════════════════════════════
// ATTRIBUTION RECONCILE — closes the last gap in ad tracking.
//
// The capture chain is already wired: the Instant Estimator / Revive
// landing pages stamp utm/fbclid onto every lead, and api/leads.js
// persists it to the `leads` table. What was missing is the JOIN: that
// ad-level attribution never reached the `customers`/`estimates` rows, so
// a signed job could not be traced to the ad that produced it.
//
// This matches each customer to its originating lead (by GHL contact id,
// then phone, then email) and copies the lead's attribution onto
// `customers.attribution` and every one of that customer's
// `estimates.attribution` — fill-if-empty, so re-runs are idempotent and a
// human-set attribution is never overwritten. With estimates.attribution
// populated, marketing-kpis (which reads ad_sourced + campaign) lights up
// with real signed-job-by-ad numbers.
//
//   GET /api/feeders/attribution-reconcile?tenant=plus-ultra
//   Authorization: Bearer <CRON_SECRET | owner session | service token>
//
// Forward-going by design: leads only exist from when tagging began, so
// jobs that closed before that can't be back-attributed (no data ever
// existed for them). Every new lead -> customer -> estimate is covered.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../../lib/supabase.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';

const PLUS_ULTRA_SLUG = 'plus-ultra';

// Last 10 digits = the stable part of a NANP number, ignoring +1 / formatting.
const normPhone = (p) => (p || '').replace(/\D/g, '').slice(-10);
const normEmail = (e) => (e || '').toLowerCase().trim();

// An attribution object is "empty" if it carries no real signal. We treat the
// presence of any of these keys as already-attributed (don't overwrite).
function hasAttribution(a) {
  if (!a || typeof a !== 'object') return false;
  return !!(a.ad_sourced || a.utm_source || a.utm_campaign || a.utm_content || a.fbclid || a.gclid || a.campaign_id);
}

// Build the canonical attribution object written onto customer + estimates,
// from a matched lead. Shape is chosen so marketing-kpis (reads ad_sourced)
// and the ad-level join (utm_content == meta_insights ad name) both work.
function buildAttribution(lead, matchedBy) {
  const a = (lead.metadata && lead.metadata.attribution) || {};
  const adSourced = !!(a.utm_source || a.utm_content || a.utm_campaign || a.fbclid || a.gclid);
  return {
    utm_source: a.utm_source || null,
    utm_medium: a.utm_medium || null,
    utm_campaign: a.utm_campaign || null,
    utm_content: a.utm_content || null,
    utm_term: a.utm_term || null,
    fbclid: a.fbclid || null,
    gclid: a.gclid || null,
    // convenience aliases used by the ad-level reports
    ad: a.utm_content || null,              // the specific creative
    campaign: a.utm_campaign || lead.campaign || null,
    channel: lead.channel || null,          // meta | google | other-paid | direct
    source: lead.source || null,
    ad_sourced: adSourced,                  // hard evidence of ad/funnel origin
    lead_id: lead.id || null,
    matched_by: matchedBy,
    reconciled_at: new Date().toISOString()
  };
}

export async function runAttributionReconcile({ tenantSlug = PLUS_ULTRA_SLUG, dryRun = false } = {}) {
  const report = {
    agent: 'attribution-reconcile', tenant: tenantSlug, dryRun,
    leadsIndexed: 0, customersScanned: 0, alreadyAttributed: 0,
    customersMatched: 0, customersWithAd: 0, customersUpdated: 0,
    estimatesUpdated: 0, byMatch: { ghl_contact_id: 0, phone: 0, email: 0 }, errors: []
  };

  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('id').eq('slug', tenantSlug).maybeSingle();
  if (!tenant) { report.errors.push(`tenant ${tenantSlug} not found`); return report; }
  const tid = tenant.id;

  // 1. Index every lead by its three possible join keys.
  const { data: leads, error: leadErr } = await supabaseAdmin
    .from('leads').select('id,source,channel,campaign,created_at,metadata')
    .eq('tenant_id', tid).limit(20000);
  if (leadErr) { report.errors.push('leads: ' + leadErr.message); return report; }

  const byGhl = new Map(), byPhone = new Map(), byEmail = new Map();
  // Newest leads last so a later .set wins (most recent touch preferred). The
  // attribution picker below still prefers a lead that actually carries an ad.
  const ordered = [...(leads || [])].sort((x, y) => (x.created_at || '').localeCompare(y.created_at || ''));
  for (const l of ordered) {
    report.leadsIndexed++;
    const m = l.metadata || {};
    const g = m.ghl_contact_id;
    const ph = normPhone(m.phone);
    const em = normEmail(m.email);
    if (g) push(byGhl, g, l);
    if (ph.length === 10) push(byPhone, ph, l);
    if (em) push(byEmail, em, l);
  }
  function push(map, key, val) { const arr = map.get(key) || []; arr.push(val); map.set(key, arr); }

  // From a set of candidate leads, prefer one that carries a real ad tag, else
  // the most recent (the array is in ascending-time order, so last = newest).
  const pick = (arr) => arr.find(l => (l.metadata?.attribution || {}).utm_content)
    || arr.find(l => hasAttribution(l.metadata?.attribution))
    || arr[arr.length - 1];

  // 2. Walk customers; match + fill.
  const { data: customers, error: custErr } = await supabaseAdmin
    .from('customers').select('id,full_name,phone,email,ghl_contact_id,attribution')
    .eq('tenant_id', tid).limit(20000);
  if (custErr) { report.errors.push('customers: ' + custErr.message); return report; }

  for (const c of customers || []) {
    report.customersScanned++;
    if (hasAttribution(c.attribution)) { report.alreadyAttributed++; continue; }

    let cand = null, matchedBy = null;
    if (c.ghl_contact_id && byGhl.has(c.ghl_contact_id)) { cand = byGhl.get(c.ghl_contact_id); matchedBy = 'ghl_contact_id'; }
    else { const ph = normPhone(c.phone); if (ph.length === 10 && byPhone.has(ph)) { cand = byPhone.get(ph); matchedBy = 'phone'; } }
    if (!cand) { const em = normEmail(c.email); if (em && byEmail.has(em)) { cand = byEmail.get(em); matchedBy = 'email'; } }
    if (!cand || !cand.length) continue;

    report.customersMatched++;
    report.byMatch[matchedBy]++;
    const attr = buildAttribution(pick(cand), matchedBy);
    if (attr.ad_sourced) report.customersWithAd++;
    if (dryRun) continue;

    // Write onto the customer.
    const { error: cuErr } = await supabaseAdmin.from('customers')
      .update({ attribution: attr }).eq('id', c.id).eq('tenant_id', tid);
    if (cuErr) { report.errors.push(`customer ${c.id}: ${cuErr.message}`); continue; }
    report.customersUpdated++;

    // Write onto that customer's estimates that are still missing attribution.
    const { data: ests } = await supabaseAdmin.from('estimates')
      .select('id,attribution').eq('tenant_id', tid).eq('customer_id', c.id).limit(500);
    for (const e of ests || []) {
      if (hasAttribution(e.attribution)) continue;
      const { error: euErr } = await supabaseAdmin.from('estimates')
        .update({ attribution: attr }).eq('id', e.id).eq('tenant_id', tid);
      if (euErr) report.errors.push(`estimate ${e.id}: ${euErr.message}`);
      else report.estimatesUpdated++;
    }
  }

  return report;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const tenantSlug = (req.query?.tenant || req.headers['x-tenant-id'] || PLUS_ULTRA_SLUG).toString();
  const dryRun = req.query?.dry === '1' || req.query?.dryRun === '1';

  try {
    const report = await runAttributionReconcile({ tenantSlug, dryRun });
    return res.status(200).json({ ok: report.errors.length === 0, ...report });
  } catch (e) {
    console.error('[attribution-reconcile]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
