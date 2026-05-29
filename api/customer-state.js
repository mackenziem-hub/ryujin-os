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

  // Pull customers + their estimates for LTV calc
  try {
    const customers = await supabaseAdmin
      .from('customers')
      .select('id, full_name, created_at')
      .eq('tenant_id', tenantId)
      .limit(2000);
    if (!customers.error) stats.customers_total = (customers.data || []).length;

    // Pull all closed_won / signed estimates in last year — group by customer
    const ests = await supabaseAdmin
      .from('estimates')
      .select('id, customer_id, status, state, calculated_packages, selected_package, closed_won_at, updated_at')
      .eq('tenant_id', tenantId)
      .in('state', ['closed_won']).limit(1000);
    const wonByCustomer = {};
    if (!ests.error) {
      const sellingPrice = (e) => {
        const tier = (e.selected_package || 'gold').toLowerCase();
        const pkg = e.calculated_packages?.[tier] || {};
        // Precedence mirrors proposal.js: pkg.total is the canonical pre-tax rendered price
        // (carries negotiated/override values); summary.sellingPrice is the raw-engine-shape fallback.
        return pkg.total ?? pkg.summary?.sellingPrice ?? pkg.sellingPrice ?? 0;
      };
      for (const e of ests.data || []) {
        if (!e.customer_id) continue;
        const v = sellingPrice(e);
        if (!wonByCustomer[e.customer_id]) wonByCustomer[e.customer_id] = { count: 0, total: 0, latest: null };
        wonByCustomer[e.customer_id].count++;
        wonByCustomer[e.customer_id].total += v;
        const ts = e.closed_won_at || e.updated_at;
        if (!wonByCustomer[e.customer_id].latest || ts > wonByCustomer[e.customer_id].latest) {
          wonByCustomer[e.customer_id].latest = ts;
        }
      }
      const customerValues = Object.values(wonByCustomer);
      const totals = customerValues.map(c => c.total).filter(v => v > 0);
      stats.avg_ltv = totals.length > 0 ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0;
      stats.top_customer_value = totals.length > 0 ? Math.max(...totals) : 0;
      stats.repeat_customers = customerValues.filter(c => c.count > 1).length;
      stats.customers_active_12mo = customerValues.filter(c => c.latest && c.latest >= oneYearAgo).length;

      // Build years-since-last-job histogram for churn-risk simulator.
      // Cap at 30 years to bound payload + match plausible roof-life range.
      const now = Date.now();
      for (const c of customerValues) {
        if (!c.latest) continue;
        const dtMs = now - new Date(c.latest).getTime();
        const years = Math.min(30, Math.max(0, Math.floor(dtMs / (365 * 86400000))));
        stats.customer_age_histogram[years] = (stats.customer_age_histogram[years] || 0) + 1;
      }

      // Signed jobs ≥14d old without a review request → review_asks_pending heuristic
      const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
      const eligibleForReview = (ests.data || []).filter(e =>
        (e.closed_won_at && e.closed_won_at <= fourteenDaysAgo && e.closed_won_at >= ninetyDaysAgo)
      );
      stats.signed_no_review = eligibleForReview.length;
      stats.review_asks_pending = eligibleForReview.length; // Same count for now (no review_request_sent_at column yet)
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
    last_updated_at: new Date().toISOString()
  });
}

export default requireTenant(handler);
