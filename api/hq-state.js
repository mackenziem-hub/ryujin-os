// ═══════════════════════════════════════════════════════════════
// HQ-STATE — bundled payload for /dashboard-v2.html (cockpit center) and
// any future HQ pillar detail view.
//
// Follows the same per-pillar pattern as /api/marketing-state etc., but
// scoped to cross-domain HQ rollup: strategy agent briefing + curated
// cross-pillar headline KPIs + activity across all domains.
//
// NOTE: dashboard-v2.html currently fetches /api/snapshot (hourly cached
// rollup). This endpoint is the LIVE per-pillar alternative — useful for
// the HQ pillar detail view where freshness matters more than speed.
//
// GET /api/hq-state[?user_id=<uuid>]
//
// Returns:
//   {
//     date,
//     briefing:  [ ... ]   today's items across all domains (urgent first)
//     kpis:      [ ... ]   curated cross-pillar headline KPIs
//     activity:  [ ... ]   last 20 agent_runs across all domains
//     stats: {
//       briefing_total, briefing_urgent,
//       pillars_with_recent_runs,
//       open_quests
//     },
//     latest_run,           // most recent strategy agent run
//     last_updated_at
//   }
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

// Curated headline KPIs surfaced on the HQ dashboard. Extend as pillar
// scanners (Phase 2) start emitting new keys.
const HQ_KPI_KEYS = [
  'sales.signed_mtd',
  'sales.pipeline_value',
  'sales.open_deals',
  'sales.leads_week',
  'sales.avg_cpl',
  'production.tickets_open',
  'production.tickets_overdue',
  'production.crew_utilization',
  'service.tickets_open',
  'customer.ltv_avg',
  'finance.ar_outstanding',
  'finance.ap_due_7d',
  'marketing.ads_active',
  'inventory.po_open',
];

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const userId = req.query.user_id || null;
  const today = new Date().toISOString().slice(0, 10);

  // ── Briefing items: cross-pillar (all sources) for today ──
  let briefingQ = supabaseAdmin
    .from('briefing_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('for_date', today)
    .is('dismissed_at', null)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(50);
  if (userId) briefingQ = briefingQ.or(`for_user_id.eq.${userId},for_user_id.is.null`);
  const briefing = await briefingQ;

  // ── KPIs: curated cross-pillar headline set ──
  const kpis = await supabaseAdmin
    .from('kpis')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('key', HQ_KPI_KEYS)
    .order('sort_order', { ascending: true });

  // ── Latest strategy run (cross-domain synthesis) ──
  const latest = await supabaseAdmin
    .from('agent_runs')
    .select('id, agent_slug, trigger, started_at, completed_at, status, summary, emitted_quests, emitted_kpis, emitted_briefs')
    .eq('tenant_id', tenantId)
    .eq('agent_slug', 'strategy')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── Recent agent runs across ALL domains (last 20) for activity timeline ──
  const recentRuns = await supabaseAdmin
    .from('agent_runs')
    .select('id, agent_slug, started_at, status, summary, emitted_briefs, emitted_quests')
    .eq('tenant_id', tenantId)
    .order('started_at', { ascending: false })
    .limit(20);

  // ── Stats: cross-pillar rollup ──
  const briefingData = briefing.data || [];
  const runsData = recentRuns.data || [];
  const stats = {
    briefing_total: briefingData.length,
    briefing_urgent: briefingData.filter(b => b.priority === 'urgent').length,
    pillars_with_recent_runs: new Set(runsData.map(r => r.agent_slug)).size,
    open_quests: 0,
  };

  const openQuests = await supabaseAdmin
    .from('quests')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('status', ['open', 'in_progress']);
  if (openQuests.count != null) stats.open_quests = openQuests.count;

  // ── Activity timeline: agent runs across all pillars ──
  const activity = runsData.map(r => ({
    at: r.started_at,
    kind: 'agent run',
    pillar: r.agent_slug,
    label: r.summary || `${r.agent_slug} scan: ${r.emitted_briefs || 0} briefs · ${r.emitted_quests || 0} quests`,
    ref_id: r.id,
  }));

  return res.status(200).json({
    date: today,
    briefing: briefingData,
    kpis: kpis.data || [],
    activity,
    stats,
    latest_run: latest.data || null,
    last_updated_at: new Date().toISOString(),
  });
}

export default requireTenant(handler);
