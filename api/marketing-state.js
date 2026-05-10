// ═══════════════════════════════════════════════════════════════
// MARKETING-STATE — bundled payload for /marketing.html (panel dashboard).
//
// Mirrors /api/state but scoped to the marketing domain.
// First reference implementation of the per-panel <domain>-state pattern
// (see docs/PANEL_TEMPLATE.md).
//
// GET /api/marketing-state[?user_id=<uuid>]
//
// Returns:
//   {
//     date,
//     briefing:  [ ... ]   filtered briefing_items where source_agent='marketing'
//     kpis:      [ ... ]   kpis where key starts with 'marketing.'
//     activity:  [ ... ]   last 20 marketing-domain events (agent_runs + scheduled_posts)
//     stats: {
//       brands_count,
//       scheduled_posts_ahead_7d,
//       clips_queued, clips_rendering, clips_ready,
//       campaigns_active                  // 0 until campaigns table exists
//     },
//     latest_run,           // most recent marketing agent_run
//     last_updated_at
//   }
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const userId = req.query.user_id || null;
  const today = new Date().toISOString().slice(0, 10);

  // ── Briefing items: filtered to marketing source, today, undismissed ──
  let briefingQ = supabaseAdmin
    .from('briefing_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('source_agent', 'marketing')
    .eq('for_date', today)
    .is('dismissed_at', null)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(40);
  if (userId) briefingQ = briefingQ.or(`for_user_id.eq.${userId},for_user_id.is.null`);
  const briefing = await briefingQ;

  // ── KPIs: keys prefixed with 'marketing.' ──
  const kpis = await supabaseAdmin
    .from('kpis')
    .select('*')
    .eq('tenant_id', tenantId)
    .like('key', 'marketing.%')
    .order('sort_order', { ascending: true });

  // ── Latest marketing agent run ──
  const latest = await supabaseAdmin
    .from('agent_runs')
    .select('id, agent_slug, trigger, started_at, completed_at, status, summary, emitted_quests, emitted_kpis, emitted_briefs')
    .eq('tenant_id', tenantId)
    .eq('agent_slug', 'marketing')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── Recent marketing-domain runs (last 7) for activity timeline ──
  const recentRuns = await supabaseAdmin
    .from('agent_runs')
    .select('id, started_at, status, summary, emitted_quests, emitted_briefs')
    .eq('tenant_id', tenantId)
    .eq('agent_slug', 'marketing')
    .order('started_at', { ascending: false })
    .limit(7);

  // ── Stats ──
  const stats = { brands_count: 0, scheduled_posts_ahead_7d: 0, clips_queued: 0, clips_rendering: 0, clips_ready: 0, campaigns_active: 0 };

  const brands = await supabaseAdmin
    .from('brands').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
  if (brands.count != null) stats.brands_count = brands.count;

  const sevenDays = new Date(Date.now() + 7 * 86400000).toISOString();
  const scheduled = await supabaseAdmin
    .from('scheduled_posts')
    .select('id, status, scheduled_at, brand_id, ghl_post_id, created_at, account_label, platform')
    .eq('tenant_id', tenantId)
    .gte('scheduled_at', new Date().toISOString())
    .lt('scheduled_at', sevenDays)
    .in('status', ['scheduled', 'pending'])
    .order('scheduled_at', { ascending: true });
  if (!scheduled.error) stats.scheduled_posts_ahead_7d = (scheduled.data || []).length;

  // Marketing clips by status
  const clipBuckets = await supabaseAdmin
    .from('marketing_clips')
    .select('status')
    .eq('tenant_id', tenantId)
    .in('status', ['queued', 'rendering', 'ready', 'scheduled'])
    .limit(500);
  if (!clipBuckets.error) {
    for (const c of clipBuckets.data || []) {
      if (c.status === 'queued') stats.clips_queued++;
      else if (c.status === 'rendering') stats.clips_rendering++;
      else if (c.status === 'ready' || c.status === 'scheduled') stats.clips_ready++;
    }
  }

  // Campaigns table may not exist yet (migration 043 pending) — soft-fail
  try {
    const camp = await supabaseAdmin
      .from('campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'active');
    if (camp.count != null) stats.campaigns_active = camp.count;
  } catch { /* table doesn't exist yet */ }

  // ── Activity timeline: merge agent runs + upcoming scheduled posts ──
  const activity = [];
  for (const r of recentRuns.data || []) {
    activity.push({
      at: r.started_at,
      kind: 'agent run',
      label: r.summary || `Marketing scan: ${r.emitted_briefs || 0} briefs · ${r.emitted_quests || 0} quests`,
      ref_id: r.id
    });
  }
  for (const p of (scheduled.data || []).slice(0, 8)) {
    activity.push({
      at: p.scheduled_at,
      kind: 'post scheduled',
      label: `${p.platform || 'post'} → ${p.account_label || 'account'}`,
      ref_id: p.id
    });
  }
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
