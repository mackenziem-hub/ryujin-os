// ═══════════════════════════════════════════════════════════════
// AGENT-RUNS — read history + trigger manual runs of the 6 archetypal agents.
//
// GET  /api/agent-runs                       — latest run per agent (overview)
// GET  /api/agent-runs?agent=sales&limit=10  — run history for one agent
// GET  /api/agent-runs?id=<uuid>             — single run with full output
// POST /api/agent-runs?agent=sales           — manually trigger + persist
//
// Manual trigger reuses the same code path as cron-daily.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { runSales, runOps, runMarketing, runFinance } from './agents/_shared.js';
import { runCustomerScan } from '../lib/agents/customer_scan.js';
import { runStrategyScan } from '../lib/agents/strategy_scan.js';
import { persistAgentRun } from '../lib/agents/persistAgentRun.js';

const TENANT_SLUG = 'plus-ultra';
const ARCHETYPAL_AGENTS = ['sales', 'marketing', 'ops', 'finance', 'customer', 'strategy'];
const RUNNERS = {
  sales:     () => runSales(),
  marketing: () => runMarketing(),
  ops:       () => runOps(),
  finance:   () => runFinance(),
  customer:  () => runCustomerScan({ tenantSlug: TENANT_SLUG }),
  strategy:  () => runStrategyScan({ tenantSlug: TENANT_SLUG })
};

// Reuse KPI maps from cron-daily structure (kept in sync — minor lift)
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
    // totalOpen reuses the legacy active_today key so the existing kpis row
    // updates in place (api/kpis has no DELETE; the old activeToday field died
    // with the retired Replit board and had frozen this tile).
    'stats.totalOpen':            { key: 'ops.tickets_active_today',   label: 'Open Tickets',              unit: 'count', sort_order: 32 },
    'stats.workloadImbalance':    { key: 'ops.workload_imbalance',     label: 'Workload Imbalance',        unit: 'count', sort_order: 33 },
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
    'stats.reviewAsksReady':      { key: 'customer.review_asks_ready', label: 'Review Asks Ready',         unit: 'count', sort_order: 42 }
  },
  strategy: {
    'stats.runsLast7d':           { key: 'strategy.agent_runs_7d',     label: 'Agent Runs (7d)',           unit: 'count', sort_order: 90 },
    'stats.kpiCount':             { key: 'strategy.tracked_kpis',      label: 'Tracked KPIs',              unit: 'count', sort_order: 91 }
  }
};

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { agent, id, limit } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('agent_runs')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'run not found' });
      return res.status(200).json({ run: data });
    }

    if (agent) {
      const { data, error } = await supabaseAdmin
        .from('agent_runs')
        .select('id, agent_slug, trigger, started_at, completed_at, status, summary, emitted_quests, emitted_kpis, emitted_briefs, error_message, duration_ms')
        .eq('tenant_id', tenantId)
        .eq('agent_slug', agent)
        .order('started_at', { ascending: false })
        .limit(parseInt(limit) || 20);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ runs: data || [] });
    }

    // Default: latest run per archetypal agent
    const { data, error } = await supabaseAdmin
      .from('agent_runs')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('agent_slug', ARCHETYPAL_AGENTS)
      .order('started_at', { ascending: false })
      .limit(60);
    if (error) return res.status(500).json({ error: error.message });

    // Pick the freshest run per agent
    const latest = {};
    for (const r of data || []) {
      if (!latest[r.agent_slug]) latest[r.agent_slug] = r;
    }
    // Fill in nulls for agents that have never run
    const result = ARCHETYPAL_AGENTS.map(slug => latest[slug] || { agent_slug: slug, status: 'never_run' });
    return res.status(200).json({ agents: result });
  }

  if (req.method === 'POST') {
    const agent = req.query.agent;
    if (!agent || !RUNNERS[agent]) {
      return res.status(400).json({ error: `agent must be one of: ${ARCHETYPAL_AGENTS.join(', ')}` });
    }
    try {
      const t0 = Date.now();
      const report = await RUNNERS[agent]();
      const persisted = await persistAgentRun(report, {
        tenantId,
        agentSlug: agent,
        trigger: 'manual',
        kpiMap: KPI_MAPS[agent] || {}
      });
      return res.status(200).json({
        ok: true,
        agent,
        durationMs: Date.now() - t0,
        ...persisted,
        report
      });
    } catch (e) {
      // Record an error run for visibility
      await supabaseAdmin.from('agent_runs').insert({
        tenant_id: tenantId,
        agent_slug: agent,
        trigger: 'manual',
        status: 'error',
        error_message: e.message,
        completed_at: new Date().toISOString()
      });
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireTenant(handler);
