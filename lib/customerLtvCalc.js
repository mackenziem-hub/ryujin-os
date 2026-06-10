// ═══════════════════════════════════════════════════════════════
// CUSTOMER LTV CALC - one canonical estimate-value + lifetime-value
// computation for every customer surface.
//
// Why this exists: the 2026-06-09 pillar review found customer-list.html
// ranking customers by (pkg.sellingPrice || pkg.total) while
// api/customer-state.js used (pkg.total ?? pkg.summary?.sellingPrice ??
// pkg.sellingPrice) - same customers, two different LTVs, two different
// rankings. This module is the single source. The API computes, pages
// render; no page-side money math.
//
// Precedence (mirrors lib/metricsContract.js estimateValue):
//   1. final_accepted_total                    - the signed contract number
//   2. selected tier pkg.total                 - canonical pre-tax rendered
//                                                price (carries overrides)
//   3. selected tier pkg.summary.sellingPrice  - raw-engine shape
//   4. selected tier pkg.sellingPrice          - legacy flat shape
//   5. best tier across calculated_packages    - same per-tier precedence
//
// metricsContract.js keeps a private twin of estimateValue (it predates
// this module); if the precedence ever changes, change BOTH or refactor
// metricsContract to import from here.
// ═══════════════════════════════════════════════════════════════

export function estimateValue(est) {
  if (!est) return 0;
  if (est.final_accepted_total != null) return Number(est.final_accepted_total) || 0;
  const pkgs = est.calculated_packages || {};
  const tierVal = (t) => {
    const p = pkgs[String(t).toLowerCase()] || pkgs[t];
    if (!p) return null;
    const v = p.total ?? p.summary?.sellingPrice ?? p.sellingPrice;
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

// Canonical "won" predicate, aligned with lib/metricsContract.js
// SOLD_STATUSES (ratified by Mac 2026-06-09: signing = acceptance):
// status accepted/scheduled/in_progress/complete, plus the state-machine
// closed_won and legacy status='signed' rows. Verified against prod
// 2026-06-09: live won rows carry status='accepted' (none have
// state='closed_won' or status='signed'), so the narrower predicate the
// pages used before rendered $0 LTV for every customer.
const WON_STATUSES = ['signed', 'accepted', 'scheduled', 'in_progress', 'complete'];

export function isWonEstimate(est) {
  if (!est) return false;
  return est.state === 'closed_won' || WON_STATUSES.includes(est.status);
}

// When did the customer buy? closed_won_at when the state machine stamped it,
// accepted_at for status-vocabulary rows, updated_at as the legacy fallback.
export function wonAt(est) {
  if (!est) return null;
  return est.closed_won_at || est.accepted_at || est.updated_at || null;
}

// Roll a list of estimates up into per-customer lifetime aggregates.
// Returns { [customer_id]: { lifetime_value, job_count, last_job_at } }.
// Only won estimates count; rows without customer_id are skipped.
export function aggregateCustomerValues(estimates) {
  const byCustomer = {};
  for (const e of estimates || []) {
    if (!e || !e.customer_id || !isWonEstimate(e)) continue;
    const v = estimateValue(e);
    if (!byCustomer[e.customer_id]) {
      byCustomer[e.customer_id] = { lifetime_value: 0, job_count: 0, last_job_at: null };
    }
    const agg = byCustomer[e.customer_id];
    agg.lifetime_value += v;
    agg.job_count += 1;
    const ts = wonAt(e);
    if (ts && (!agg.last_job_at || ts > agg.last_job_at)) agg.last_job_at = ts;
  }
  return byCustomer;
}
