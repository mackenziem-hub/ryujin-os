// ═══════════════════════════════════════════════════════════════
// SALES-STATE — bundled payload for /sales.html (panel dashboard).
//
// Mirrors marketing-state / production-state. Filters briefing items
// to source_agent='sales', KPIs prefixed 'sales.', activity from
// recent estimate updates + agent runs.
//
// GET /api/sales-state[?user_id=<uuid>]
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const userId = req.query.user_id || null;
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  // ── Briefing items filtered to sales agent ──
  let briefingQ = supabaseAdmin
    .from('briefing_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('source_agent', 'sales')
    .eq('for_date', today)
    .is('dismissed_at', null)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(40);
  if (userId) briefingQ = briefingQ.or(`for_user_id.eq.${userId},for_user_id.is.null`);
  const briefing = await briefingQ;

  // ── KPIs prefixed 'sales.' ──
  const kpis = await supabaseAdmin
    .from('kpis')
    .select('*')
    .eq('tenant_id', tenantId)
    .like('key', 'sales.%')
    .order('sort_order', { ascending: true });

  // ── Latest sales agent run ──
  const latest = await supabaseAdmin
    .from('agent_runs')
    .select('id, agent_slug, trigger, started_at, completed_at, status, summary, emitted_quests, emitted_kpis, emitted_briefs')
    .eq('tenant_id', tenantId)
    .eq('agent_slug', 'sales')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const recentRuns = await supabaseAdmin
    .from('agent_runs')
    .select('id, started_at, status, summary, emitted_quests, emitted_briefs')
    .eq('tenant_id', tenantId)
    .eq('agent_slug', 'sales')
    .order('started_at', { ascending: false })
    .limit(5);

  // ── Sales-domain stats ──
  const stats = {
    estimates_open: 0, estimates_signed_30d: 0, estimates_lost_30d: 0,
    pipeline_value: 0, signed_value_30d: 0,
    avg_deal_size: 0, conversion_rate_30d: null,
    follow_ups_due: 0
  };

  try {
    const ests = await supabaseAdmin
      .from('estimates')
      .select('id, status, state, calculated_packages, selected_package, created_at, updated_at, approved_at, closed_won_at, tags')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(500);
    if (!ests.error) {
      const list = ests.data || [];
      const sellingPrice = (e) => {
        const tier = (e.selected_package || 'gold').toLowerCase();
        const pkg = e.calculated_packages?.[tier] || {};
        // Precedence mirrors proposal.js: pkg.total is the canonical pre-tax rendered price
        // (carries negotiated/override values); summary.sellingPrice is the raw-engine-shape fallback.
        return pkg.total ?? pkg.summary?.sellingPrice ?? pkg.sellingPrice ?? 0;
      };
      const won = [], lost = [], open = [];
      for (const e of list) {
        const s = e.state || e.status || '';
        if (s === 'closed_won' || s === 'signed') won.push(e);
        else if (s === 'closed_lost' || s === 'lost') lost.push(e);
        else if (['proposal_draft','proposal_sent','approved_pending_rep_call','contract_pending','deposit_pending','financing_pending','schedule_pending','draft','active'].includes(s)) open.push(e);
      }
      stats.estimates_open = open.length;
      const won30 = won.filter(e => (e.closed_won_at || e.updated_at) >= thirtyDaysAgo);
      const lost30 = lost.filter(e => e.updated_at >= thirtyDaysAgo);
      stats.estimates_signed_30d = won30.length;
      stats.estimates_lost_30d = lost30.length;
      stats.pipeline_value = Math.round(open.reduce((s, e) => s + sellingPrice(e), 0));
      stats.signed_value_30d = Math.round(won30.reduce((s, e) => s + sellingPrice(e), 0));
      const allWon = won.map(sellingPrice).filter(v => v > 0);
      stats.avg_deal_size = allWon.length > 0 ? Math.round(allWon.reduce((a, b) => a + b, 0) / allWon.length) : 0;
      const closed30 = won30.length + lost30.length;
      stats.conversion_rate_30d = closed30 > 0 ? Math.round(won30.length / closed30 * 100) : null;

      // Follow-ups due: proposal_sent + 3+ days stale
      const now = Date.now();
      stats.follow_ups_due = open.filter(e => {
        if ((e.state || e.status) !== 'proposal_sent') return false;
        const u = e.updated_at ? new Date(e.updated_at).getTime() : 0;
        return u > 0 && (now - u) / 86400000 >= 3;
      }).length;
    }
  } catch { /* soft-fail */ }

  // ── Activity timeline ──
  const activity = [];
  for (const r of recentRuns.data || []) {
    activity.push({
      at: r.started_at,
      kind: 'agent run',
      label: r.summary || `Sales scan: ${r.emitted_briefs || 0} briefs · ${r.emitted_quests || 0} quests`,
      ref_id: r.id
    });
  }
  // Recent estimate updates (last 10)
  try {
    const eRecent = await supabaseAdmin
      .from('estimates')
      .select('id, estimate_number, state, status, updated_at, customer:customers(full_name)')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(10);
    for (const e of eRecent.data || []) {
      activity.push({
        at: e.updated_at,
        kind: 'estimate',
        label: `${e.customer?.full_name || `est ${e.estimate_number || e.id?.slice(0,8)}`} · ${e.state || e.status || '—'}`,
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
    latest_run: latest.data || null,
    last_updated_at: new Date().toISOString()
  });
}

export default requireTenant(handler);
