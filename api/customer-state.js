// ═══════════════════════════════════════════════════════════════
// CUSTOMER-STATE — bundled payload for /customer.html (panel dashboard).
//
// Lifetime value, history, referrals, reviews. Reads existing customers
// table + estimates + GHL contacts. No new schema beyond optional
// customer_config in tenant_settings.
//
// GET /api/customer-state[?user_id=<uuid>]
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { attachSession } from '../lib/portalAuth.js';
import { aggregateCustomerValues, wonAt } from '../lib/customerLtvCalc.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const userId = req.query.user_id || null;
  const today = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString();

  // Briefing items (customer agent already covered by lib/agents/customer_scan.js)
  let briefingQ = supabaseAdmin
    .from('briefing_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('source_agent', 'customer')
    .eq('for_date', today)
    .is('dismissed_at', null)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(40);
  if (userId) briefingQ = briefingQ.or(`for_user_id.eq.${userId},for_user_id.is.null`);
  const briefing = await briefingQ;

  // KPIs prefixed 'customer.'
  const kpis = await supabaseAdmin
    .from('kpis')
    .select('*')
    .eq('tenant_id', tenantId)
    .like('key', 'customer.%')
    .order('sort_order', { ascending: true });

  const stats = {
    customers_total: 0, customers_active_12mo: 0,
    avg_ltv: 0, top_customer_value: 0,
    review_asks_pending: 0, signed_no_review: 0,
    repeat_customers: 0,
    // Years-since-last-job histogram for churn-risk sim on customer-advanced.html.
    // Keyed by integer years (0,1,2,...,30). Only counts customers with ≥1 closed_won.
    customer_age_histogram: {}
  };

  // Per-customer lifetime aggregates ({ id, lifetime_value, job_count,
  // last_job_at }) - consumed by customer-list.html so the page renders
  // API-computed values instead of doing its own (divergent) money math.
  let customerValues = [];

  // Pull customers + their estimates for LTV calc
  try {
    const customers = await supabaseAdmin
      .from('customers')
      .select('id, full_name, created_at')
      .eq('tenant_id', tenantId)
      .limit(2000);
    if (!customers.error) stats.customers_total = (customers.data || []).length;

    // Review-ask dedupe stamps (migration 098). Queried separately and
    // soft-failed: if the column is not applied yet this errors on its own
    // and we degrade to no-dedupe instead of zeroing every stat below.
    const reviewSentByCustomer = {};
    const stamps = await supabaseAdmin
      .from('customers')
      .select('id, review_request_sent_at')
      .eq('tenant_id', tenantId)
      .not('review_request_sent_at', 'is', null)
      .limit(2000);
    if (!stamps.error) {
      for (const c of stamps.data || []) reviewSentByCustomer[c.id] = c.review_request_sent_at;
    }

    // Pull all won estimates - group by customer. Won predicate + value
    // precedence live in lib/customerLtvCalc.js (final_accepted_total >>
    // pkg.total >> summary.sellingPrice >> legacy). The filter mirrors
    // metricsContract SOLD_STATUSES: prod won rows carry status='accepted',
    // not state='closed_won' (the old narrower filter returned 0 rows live).
    const ests = await supabaseAdmin
      .from('estimates')
      .select('id, customer_id, status, state, calculated_packages, selected_package, final_accepted_total, closed_won_at, accepted_at, updated_at')
      .eq('tenant_id', tenantId)
      .or('state.eq.closed_won,status.in.(signed,accepted,scheduled,in_progress,complete)')
      .limit(1000);
    if (!ests.error) {
      const wonByCustomer = aggregateCustomerValues(ests.data || []);
      customerValues = Object.entries(wonByCustomer).map(([id, v]) => ({ id, ...v }));
      const totals = customerValues.map(c => c.lifetime_value).filter(v => v > 0);
      stats.avg_ltv = totals.length > 0 ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0;
      stats.top_customer_value = totals.length > 0 ? Math.max(...totals) : 0;
      stats.repeat_customers = customerValues.filter(c => c.job_count > 1).length;
      stats.customers_active_12mo = customerValues.filter(c => c.last_job_at && c.last_job_at >= oneYearAgo).length;

      // Build years-since-last-job histogram for churn-risk simulator.
      // Cap at 30 years to bound payload + match plausible roof-life range.
      const now = Date.now();
      for (const c of customerValues) {
        if (!c.last_job_at) continue;
        const dtMs = now - new Date(c.last_job_at).getTime();
        const years = Math.min(30, Math.max(0, Math.floor(dtMs / (365 * 86400000))));
        stats.customer_age_histogram[years] = (stats.customer_age_histogram[years] || 0) + 1;
      }

      // Won jobs ≥14d old → review-ask candidates. Dedupe against the
      // migration-098 stamp: pending excludes customers asked in the last
      // 90 days; signed_no_review excludes anyone ever asked.
      // Eligibility keys on wonAt() (closed_won_at || accepted_at ||
      // updated_at), NOT closed_won_at alone: verified against prod
      // 2026-06-09, no live row has closed_won_at set (won rows carry
      // status='accepted'), so the closed_won_at-only filter was 0 forever.
      // The rows here already passed the widened won predicate in the query.
      const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
      const eligibleForReview = (ests.data || []).filter(e => {
        const ts = wonAt(e);
        return ts && ts <= fourteenDaysAgo && ts >= ninetyDaysAgo;
      });
      stats.signed_no_review = eligibleForReview.filter(e =>
        !e.customer_id || !reviewSentByCustomer[e.customer_id]
      ).length;
      stats.review_asks_pending = eligibleForReview.filter(e => {
        const sentAt = e.customer_id ? reviewSentByCustomer[e.customer_id] : null;
        return !sentAt || sentAt < ninetyDaysAgo;
      }).length;
    }
  } catch { /* soft-fail */ }

  // Activity timeline — recent customer-related events
  const activity = [];
  try {
    const recentEsts = await supabaseAdmin
      .from('estimates')
      .select('id, customer_id, state, status, updated_at, customer:customers(full_name)')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(15);
    for (const e of recentEsts.data || []) {
      activity.push({
        at: e.updated_at,
        kind: 'estimate',
        label: `${e.customer?.full_name || 'unknown'} · ${e.state || e.status || '—'}`,
        ref_id: e.id
      });
    }
  } catch { /* soft-fail */ }

  activity.sort((a, b) => new Date(b.at) - new Date(a.at));

  return res.status(200).json({
    date: today,
    briefing: briefing.data || [],
    kpis: kpis.data || [],
    activity: activity.slice(0, 20),
    stats,
    // Per-customer LTV aggregates - ids + money. Per the security doctrine
    // (client x-tenant-id != identity) per-customer revenue never leaves an
    // unauthenticated surface: only included when the caller carries a valid
    // session for THIS tenant (customer-list.html sends RyujinAuth headers).
    // Aggregate stats above stay available to the legacy tenant-header flow.
    customer_values: (req.session && req.session.tenant_id === tenantId) ? customerValues : [],
    last_updated_at: new Date().toISOString()
  });
}

export default requireTenant(attachSession(handler));
