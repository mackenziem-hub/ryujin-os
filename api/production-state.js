// ═══════════════════════════════════════════════════════════════
// PRODUCTION-STATE — bundled payload for /production.html (panel dashboard).
//
// Mirrors /api/marketing-state but scoped to the ops/production domain.
// Second reference implementation of the per-panel <domain>-state pattern
// (see docs/PANEL_TEMPLATE.md).
//
// GET /api/production-state[?user_id=<uuid>]
//
// Returns:
//   {
//     date,
//     briefing:  [...]   filtered briefing_items where source_agent='ops'
//     kpis:      [...]   kpis where key starts with 'ops.'
//     activity:  [...]   last 20 production-domain events
//                        (workorder status changes + paysheet events + agent runs)
//     stats: {
//       workorders_open, workorders_in_progress, workorders_complete_30d,
//       tickets_total, tickets_overdue, tickets_unassigned,
//       paysheets_pending_approval, paysheets_paid_30d,
//       jobs_active, jobs_complete_30d
//     },
//     latest_run,
//     last_updated_at
//   }
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const userId = req.query.user_id || null;
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  // ── Briefing items filtered to ops agent ──
  let briefingQ = supabaseAdmin
    .from('briefing_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('source_agent', 'ops')
    .eq('for_date', today)
    .is('dismissed_at', null)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(40);
  if (userId) briefingQ = briefingQ.or(`for_user_id.eq.${userId},for_user_id.is.null`);
  const briefing = await briefingQ;

  // ── KPIs prefixed 'ops.' ──
  const kpis = await supabaseAdmin
    .from('kpis')
    .select('*')
    .eq('tenant_id', tenantId)
    .like('key', 'ops.%')
    .order('sort_order', { ascending: true });

  // ── Latest ops agent run ──
  const latest = await supabaseAdmin
    .from('agent_runs')
    .select('id, agent_slug, trigger, started_at, completed_at, status, summary, emitted_quests, emitted_kpis, emitted_briefs')
    .eq('tenant_id', tenantId)
    .eq('agent_slug', 'ops')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── Recent ops runs for activity ──
  const recentRuns = await supabaseAdmin
    .from('agent_runs')
    .select('id, started_at, status, summary, emitted_quests, emitted_briefs')
    .eq('tenant_id', tenantId)
    .eq('agent_slug', 'ops')
    .order('started_at', { ascending: false })
    .limit(5);

  // ── Production-domain stats ──
  const stats = {
    workorders_open: 0, workorders_in_progress: 0, workorders_complete_30d: 0,
    tickets_total: 0, tickets_overdue: 0, tickets_unassigned: 0,
    paysheets_pending_approval: 0, paysheets_paid_30d: 0,
    jobs_active: 0, jobs_complete_30d: 0
  };

  // Workorder buckets
  try {
    const wos = await supabaseAdmin
      .from('workorders')
      .select('id, status, state, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(500);
    if (!wos.error) {
      for (const w of wos.data || []) {
        const s = (w.state || w.status || '').toLowerCase();
        if (s === 'draft' || s === 'pending_approval' || s === 'issued') stats.workorders_open++;
        else if (s === 'in_progress' || s === 'active') stats.workorders_in_progress++;
        else if (s === 'complete' || s === 'completed' || s === 'closed') {
          if (w.updated_at >= thirtyDaysAgo) stats.workorders_complete_30d++;
        }
      }
    }
  } catch { /* table mismatch — soft-fail */ }

  // Ticket buckets
  try {
    const ts = await supabaseAdmin
      .from('tickets')
      .select('id, status, assigned_to, due_date')
      .eq('tenant_id', tenantId)
      .limit(500);
    if (!ts.error) {
      const now = Date.now();
      for (const t of ts.data || []) {
        stats.tickets_total++;
        if (!t.assigned_to) stats.tickets_unassigned++;
        if (t.due_date && new Date(t.due_date).getTime() < now &&
            !['done', 'closed', 'cancelled'].includes((t.status || '').toLowerCase())) {
          stats.tickets_overdue++;
        }
      }
    }
  } catch { /* soft-fail */ }

  // Paysheet buckets
  try {
    const ps = await supabaseAdmin
      .from('paysheets')
      .select('id, status, state, paid_at, updated_at')
      .eq('tenant_id', tenantId)
      .limit(500);
    if (!ps.error) {
      for (const p of ps.data || []) {
        const s = (p.state || p.status || '').toLowerCase();
        if (s === 'pending_approval' || s === 'submitted') stats.paysheets_pending_approval++;
        if ((s === 'paid' || s === 'closed') && p.paid_at && p.paid_at >= thirtyDaysAgo) stats.paysheets_paid_30d++;
      }
    }
  } catch { /* soft-fail */ }

  // ── Activity timeline ──
  const activity = [];
  for (const r of recentRuns.data || []) {
    activity.push({
      at: r.started_at,
      kind: 'agent run',
      label: r.summary || `Ops scan: ${r.emitted_briefs || 0} briefs · ${r.emitted_quests || 0} quests`,
      ref_id: r.id
    });
  }
  // Recent workorder updates (last 10)
  try {
    const woRecent = await supabaseAdmin
      .from('workorders')
      .select('id, customer_name, address, status, state, updated_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(10);
    for (const w of woRecent.data || []) {
      activity.push({
        at: w.updated_at,
        kind: 'workorder',
        label: `${w.customer_name || w.address || w.id.slice(0,8)} · ${w.state || w.status || '—'}`,
        ref_id: w.id
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
    latest_run: latest.data || null,
    last_updated_at: new Date().toISOString()
  });
}

export default requirePortalSessionAndTenant(handler);
