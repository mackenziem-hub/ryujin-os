// ═══════════════════════════════════════════════════════════════
// CRON-DAILY — runs the 6 archetypal agents and persists each report
// into the admin core tables (quests / briefing_items / kpis / agent_runs).
//
// This is what populates Mac's single-pane-of-glass admin-overview every
// morning. Sequence:
//   1. sales      (Vegeta)
//   2. marketing  (Bulma)
//   3. ops        (Piccolo)
//   4. finance    (Cashflow)
//   5. customer   (customer_scan — proposal lifecycle / follow-ups / reviews)
//   6. strategy   (strategy_scan — cross-domain rollup, runs LAST so it sees fresh runs)
//
// Coexists with the older /api/agents/daily.js (which posts to snapshot
// for the legacy briefing flow). Both run; this one feeds the new Quest
// Board UI in admin-overview.html.
//
// Schedule: 11:00 UTC daily (07:00 AT after sub-portal submissions land).
// Configured in vercel.json. Also callable manually for testing.
//
// Auth: requires CRON_SECRET in Authorization header for cron, or
// owner role for manual.
// ═══════════════════════════════════════════════════════════════

import { runSales, runOps, runMarketing, runFinance } from './_shared.js';
import { runCustomerScan } from '../../lib/agents/customer_scan.js';
import { runServiceScan } from '../../lib/agents/service_scan.js';
import { runStrategyScan } from '../../lib/agents/strategy_scan.js';
import { persistAgentRun } from '../../lib/agents/persistAgentRun.js';
import { supabaseAdmin } from '../../lib/supabase.js';

const TENANT_SLUG = 'plus-ultra';
const AGENT_TIMEOUT_MS = 25000;

// KPI extraction map per agent. `path` is dot-walked into the agent's
// returned report. Add entries as agents grow more named stats.
const KPI_MAPS = {
  sales: {
    'stats.totalOpportunities':   { key: 'sales.opportunities_total',  label: 'CRM Opportunities (total)', unit: 'count', sort_order: 10 },
    'stats.open':                 { key: 'sales.opportunities_open',   label: 'Open Opportunities',        unit: 'count', sort_order: 11 },
    'stats.totalValue':           { key: 'sales.pipeline_value',       label: 'Pipeline Value',            unit: '$',     sort_order: 12 },
    'estimatorStats.signedRevenue':{key: 'sales.signed_revenue',       label: 'Signed Revenue',            unit: '$',     sort_order: 13 },
    'estimatorStats.pendingRevenue':{key:'sales.pending_revenue',      label: 'Pending Revenue',           unit: '$',     sort_order: 14 }
  },
  marketing: {
    'plusUltra.leads.thisWeek':   { key: 'marketing.leads_this_week',  label: 'Leads This Week',           unit: 'count', sort_order: 20 },
    'plusUltra.leads.conversionRate': { key: 'marketing.conversion_rate', label: 'Conversion Rate',         unit: '%',     sort_order: 21 },
    'metaAds.totalSpend':         { key: 'marketing.meta_spend',       label: 'Meta Ad Spend',             unit: '$',     sort_order: 22 }
  },
  ops: {
    'stats.totalTickets':         { key: 'ops.tickets_total',          label: 'Crew Tickets',              unit: 'count', sort_order: 30 },
    'stats.overdueCount':         { key: 'ops.tickets_overdue',        label: 'Overdue Tickets',           unit: 'count', sort_order: 31 },
    'stats.activeToday':          { key: 'ops.tickets_active_today',   label: 'Active Today',              unit: 'count', sort_order: 32 },
    // Workload imbalance metric — Piccolo computes max-min crew load delta
    'stats.workloadImbalance':    { key: 'ops.workload_imbalance',     label: 'Workload Imbalance',        unit: 'count', sort_order: 33 },
    // Workorder + paysheet domain metrics — populate once Piccolo is extended
    'stats.workordersOpen':       { key: 'ops.workorders_open',        label: 'Workorders Open',           unit: 'count', sort_order: 34 },
    'stats.paysheetsApproval':    { key: 'ops.paysheets_pending',      label: 'Paysheet Approvals',        unit: 'count', sort_order: 35 }
  },
  finance: {
    'cashflow.last90Days.totalCollected':   { key: 'finance.collected_90d',     label: 'Collected (90d)',      unit: '$',     sort_order: 50 },
    'cashflow.last90Days.totalOutstanding': { key: 'finance.outstanding',       label: 'Outstanding',          unit: '$',     sort_order: 51 },
    'cashflow.last90Days.totalContract':    { key: 'finance.signed_90d',        label: 'Signed (90d)',         unit: '$',     sort_order: 52 },
    'cashflow.last7Days.collected':         { key: 'finance.collected_7d',      label: 'Collected (7d)',       unit: '$',     sort_order: 53 },
    'cashflow.last90Days.paymentsMatched':  { key: 'finance.payments_matched',  label: 'Payments Matched',     unit: 'count', sort_order: 54 },
    'cashflow.last90Days.paymentsReceived': { key: 'finance.payments_received', label: 'Payments Received',    unit: 'count', sort_order: 55 }
  },
  customer: {
    'stats.estimatesScanned':     { key: 'customer.estimates_scanned', label: 'Estimates Scanned',         unit: 'count', sort_order: 40 },
    'stats.followUpGaps':         { key: 'customer.followup_gaps',     label: 'Follow-up Gaps',            unit: 'count', sort_order: 41 },
    'stats.reviewAsksReady':      { key: 'customer.review_asks_ready', label: 'Review Asks Ready',         unit: 'count', sort_order: 42 },
    'stats.lifecycle.won':        { key: 'customer.signed_count',      label: 'Signed Jobs',               unit: 'count', sort_order: 43 }
  },
  service: {
    'stats.tickets_open':                  { key: 'service.tickets_open',         label: 'Tickets Open',          unit: 'count', sort_order: 60 },
    'stats.callbacks_open':                { key: 'service.callbacks_open',       label: 'Callbacks Open',        unit: 'count', sort_order: 61 },
    'stats.callbacks_aging':               { key: 'service.callbacks_aging',      label: 'Aging Callbacks',       unit: 'count', sort_order: 62 },
    'stats.tickets_overdue':               { key: 'service.tickets_overdue',      label: 'Overdue Tickets',       unit: 'count', sort_order: 63 },
    'stats.tickets_complete_12mo':         { key: 'service.tickets_complete_12mo',label: 'Completed (12mo)',      unit: 'count', sort_order: 64 },
    'stats.callback_rate_pct':             { key: 'service.callback_rate_pct',    label: 'Callback Rate',         unit: '%',     sort_order: 65 },
    'stats.warranty_claims_pending_response':{ key: 'service.warranty_pending_resp', label: 'Warranty Resp Pending', unit: 'count', sort_order: 66 }
  },
  strategy: {
    'stats.runsLast7d':           { key: 'strategy.agent_runs_7d',     label: 'Agent Runs (7d)',           unit: 'count', sort_order: 90 },
    'stats.kpiCount':             { key: 'strategy.tracked_kpis',      label: 'Tracked KPIs',              unit: 'count', sort_order: 91 }
  }
};

// Optional per-agent default assignee. Edit this map (or move to tenant_settings)
// when Catherine/Darcy onboard with their user IDs.
const DEFAULT_ASSIGNED_TO = {
  // sales:    '<darcy-user-id>',
  // customer: '<mac-user-id>',
};

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}

async function runAndPersist(slug, runFn, tenantId, trigger) {
  const t0 = Date.now();
  try {
    const report = await withTimeout(runFn(), AGENT_TIMEOUT_MS, slug);
    const persisted = await persistAgentRun(report, {
      tenantId,
      agentSlug: slug,
      trigger,
      assignedTo: DEFAULT_ASSIGNED_TO,
      kpiMap: KPI_MAPS[slug] || {}
    });
    return { slug, ok: true, durationMs: Date.now() - t0, ...persisted };
  } catch (e) {
    console.error(`[cron-daily] ${slug} failed: ${e.message}`);
    // Still record an error run for visibility in Strategy's silent-failure radar
    try {
      await supabaseAdmin.from('agent_runs').insert({
        tenant_id: tenantId,
        agent_slug: slug,
        trigger,
        status: 'error',
        error_message: e.message,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - t0
      });
    } catch { /* swallow */ }
    return { slug, ok: false, error: e.message, durationMs: Date.now() - t0 };
  }
}

export default async function handler(req, res) {
  // Auth: cron must present CRON_SECRET; manual must be authenticated owner (header injected upstream)
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const authHeader = req.headers.authorization || '';
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isManual = !!req.headers['x-owner-call'];
  if (!isCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorized — provide CRON_SECRET or owner header' });
  }
  const trigger = isCron ? 'cron_daily' : 'manual';

  // Resolve tenant
  const t = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('slug', TENANT_SLUG)
    .maybeSingle();
  if (t.error || !t.data) {
    return res.status(500).json({ error: `Tenant lookup failed: ${t.error?.message || 'not found'}` });
  }
  const tenantId = t.data.id;

  const startedAt = Date.now();
  const results = [];

  // Run the first 6 in parallel — they don't depend on each other
  const parallel = await Promise.all([
    runAndPersist('sales',     () => runSales(),                                    tenantId, trigger),
    runAndPersist('marketing', () => runMarketing(),                                tenantId, trigger),
    runAndPersist('ops',       () => runOps(),                                      tenantId, trigger),
    runAndPersist('finance',   () => runFinance(),                                  tenantId, trigger),
    runAndPersist('customer',  () => runCustomerScan({ tenantSlug: TENANT_SLUG }),  tenantId, trigger),
    runAndPersist('service',   () => runServiceScan({ tenantSlug: TENANT_SLUG }),   tenantId, trigger)
  ]);
  results.push(...parallel);

  // Strategy runs LAST so it can read fresh agent_runs from the round above
  results.push(
    await runAndPersist('strategy', () => runStrategyScan({ tenantSlug: TENANT_SLUG }), tenantId, trigger)
  );

  const totalMs = Date.now() - startedAt;
  const summary = {
    trigger,
    tenant: TENANT_SLUG,
    durationMs: totalMs,
    agentsRun: results.length,
    succeeded: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    totalQuests: results.reduce((s, r) => s + (r.emittedQuests || 0), 0),
    totalKpis: results.reduce((s, r) => s + (r.emittedKpis || 0), 0),
    totalBriefs: results.reduce((s, r) => s + (r.emittedBriefs || 0), 0),
    results
  };

  return res.status(200).json(summary);
}
