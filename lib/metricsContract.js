// ═══════════════════════════════════════════════════════════════
// METRICS CONTRACT v1 — single source of truth for cross-page KPIs.
//
// Why this exists: the 2026-06-09 review found the same KPI rendering
// three different values on three pages (open pipeline $0 vs $296K vs
// $452K) because each page did its own math against a different source,
// filter, or window. The fix is structural: every metric ships as
// { value, label, window, source } computed in exactly one place, and
// pages render the label verbatim. No page-side math, no page-side labels.
//
// Consumers:
//   - api/metrics.js          (live, gated)
//   - api/snapshot.js rebuild (writes sections.metrics hourly; fully
//     rebuilt each cycle so it needs NO preserveKeys entry)
//
// Definitions (ratified by Mac 2026-06-09):
//   signed.mtd / signed.ytd  accepted estimates in window, pre-HST
//   pipeline.proposalsOut    deals still winnable (draft/calculated/sent/viewed)
//   pipeline.signedBacklog   sold but not complete: accepted/scheduled/in_progress
//                            AND no completed workorder (workorders.completed_at
//                            is the authoritative closeout stamp; estimate
//                            status is the fallback when no WO exists)
//   collected.d7/d30/d90     payments table, cleared in window
//   ads.cpl30d               meta_insights campaign-level, trailing 30d
// ═══════════════════════════════════════════════════════════════

// calculated_packages dual shape: tier.total (pre-tax) on new rows,
// tier.summary.sellingPrice on older ones. final_accepted_total wins when set.
function estimateValue(est) {
  if (est.final_accepted_total != null) return Number(est.final_accepted_total) || 0;
  const pkgs = est.calculated_packages || {};
  const tierVal = (t) => {
    const p = pkgs[t];
    if (!p) return null;
    const v = p.total ?? p.summary?.sellingPrice;
    return v != null ? Number(v) || 0 : null;
  };
  if (est.selected_package) {
    const v = tierVal(est.selected_package);
    if (v != null) return v;
  }
  let best = 0;
  for (const t of Object.keys(pkgs)) {
    const v = tierVal(t);
    if (v != null && v > best) best = v;
  }
  return best;
}

const OPEN_STATUSES = ['draft', 'calculated', 'proposal_sent', 'viewed'];
const SOLD_STATUSES = ['accepted', 'scheduled', 'in_progress'];

const metric = (value, label, window, source, extra = {}) =>
  ({ value, label, window, source, ...extra });

export async function computeMetrics(supabaseAdmin, tenantId) {
  const now = new Date();
  const asOf = now.toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();

  const [estRes, woRes, payRes, adsRes] = await Promise.all([
    supabaseAdmin
      .from('estimates')
      .select('id, status, accepted_at, created_at, updated_at, final_accepted_total, calculated_packages, selected_package')
      .eq('tenant_id', tenantId)
      .not('status', 'in', '(cancelled,declined)'),
    supabaseAdmin
      .from('workorders')
      .select('linked_estimate_id, completed_at')
      .eq('tenant_id', tenantId)
      .not('linked_estimate_id', 'is', null),
    supabaseAdmin
      .from('payments')
      .select('amount, payment_date')
      .eq('tenant_id', tenantId)
      .gte('payment_date', daysAgo(90)),
    supabaseAdmin
      .from('meta_insights')
      .select('spend_cents, leads, date_start')
      .eq('tenant_id', tenantId)
      // sync writes ad-level rows only (campaign-level count is 0 in prod);
      // daily ad rows roll up to the same spend/lead totals
      .eq('level', 'ad')
      .gte('date_start', daysAgo(30).slice(0, 10)),
  ]);

  for (const [name, r] of [['estimates', estRes], ['workorders', woRes], ['payments', payRes], ['meta_insights', adsRes]]) {
    if (r.error) throw new Error(`metricsContract ${name} query failed: ${r.error.message}`);
  }
  const estimates = estRes.data || [];
  const workorders = woRes.data || [];
  const payments = payRes.data || [];
  const ads = adsRes.data || [];

  // ── signed (window by accepted_at; created_at fallback for imported rows
  //    that never got an acceptance stamp) ──
  const acceptedDate = (e) => e.accepted_at || e.created_at;
  const sold = estimates.filter((e) => SOLD_STATUSES.includes(e.status) || e.status === 'complete');
  const sumIn = (rows, since) => rows
    .filter((e) => acceptedDate(e) >= since)
    .reduce((s, e) => s + estimateValue(e), 0);
  const countIn = (rows, since) => rows.filter((e) => acceptedDate(e) >= since).length;

  // ── pipeline ──
  // Headline = open estimates touched in the last 30 days. Without the
  // recency bound every stale draft since system start inflates the number
  // (the same trust failure as GHL's all-opportunities $452K). All-time
  // figures ride along as extras for anyone who wants the full book.
  const openAll = estimates.filter((e) => OPEN_STATUSES.includes(e.status));
  const open = openAll.filter((e) => (e.updated_at || e.created_at) >= daysAgo(30));
  const completedEstimateIds = new Set(
    workorders.filter((w) => w.completed_at).map((w) => w.linked_estimate_id)
  );
  const backlog = estimates.filter(
    (e) => SOLD_STATUSES.includes(e.status) && !completedEstimateIds.has(e.id)
  );

  // ── collected ──
  const collectedSince = (since) => payments
    .filter((p) => p.payment_date >= since)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  // ── ads ──
  const spend30 = ads.reduce((s, r) => s + (Number(r.spend_cents) || 0), 0) / 100;
  const leads30 = ads.reduce((s, r) => s + (Number(r.leads) || 0), 0);

  const round = (n) => Math.round(n);

  return {
    contract: 'v1',
    asOf,
    signed: {
      mtd: metric(round(sumIn(sold, monthStart)), 'Signed (month to date)', 'mtd',
        'estimates accepted in window, pre-HST', { count: countIn(sold, monthStart) }),
      ytd: metric(round(sumIn(sold, yearStart)), 'Signed (year to date)', 'ytd',
        'estimates accepted in window, pre-HST', { count: countIn(sold, yearStart) }),
    },
    pipeline: {
      proposalsOut: metric(round(open.reduce((s, e) => s + estimateValue(e), 0)),
        'Proposals out (active, touched <30d)', '30d',
        'estimates in draft/calculated/proposal_sent/viewed, touched in window', {
          count: open.length,
          allTimeValue: round(openAll.reduce((s, e) => s + estimateValue(e), 0)),
          allTimeCount: openAll.length,
        }),
      signedBacklog: metric(round(backlog.reduce((s, e) => s + estimateValue(e), 0)),
        'Signed backlog (sold, not complete)', 'current',
        'accepted/scheduled/in_progress estimates without a completed workorder',
        { count: backlog.length }),
    },
    collected: {
      d7: metric(round(collectedSince(daysAgo(7))), 'Collected (7 days)', '7d', 'payments table'),
      d30: metric(round(collectedSince(daysAgo(30))), 'Collected (30 days)', '30d', 'payments table'),
      d90: metric(round(collectedSince(daysAgo(90))), 'Collected (90 days)', '90d', 'payments table'),
    },
    ads: {
      cpl30d: metric(leads30 > 0 ? Math.round((spend30 / leads30) * 100) / 100 : null,
        'CPL (Meta-reported, last 30 days)', '30d',
        'meta_insights campaign-level daily rows',
        { leads: leads30, spend: round(spend30) }),
    },
  };
}
