// ═══════════════════════════════════════════════════════════════
// STATE — aggregated admin-overview payload.
//
// One call, everything admin-overview.html needs to render the single
// pane of glass: today's briefing, the user's quest queue + counts,
// power level, top KPIs.
//
// GET /api/state?user_id=<uuid>     — per-user view
// GET /api/state                    — all-users view (admin/Catherine)
//
// Returns:
//   {
//     date: '2026-05-09',
//     user: { id, name, role, power_level, xp_total, xp_today, level },
//     briefing: [ { id, priority, title, body, ... } ],
//     quests: {
//       open:      [ ... ],   // active quests assigned to user (or all if no user)
//       completedToday: [ ... ],
//       counts: { open, completedToday, urgent, daily, campaign, optional }
//     },
//     kpis: [ ... ],
//     dragonChallenge: { weekStart, completedThisWeek, target, percent, bonus }
//   }
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

const DRAGON_CHALLENGE_WEEKLY_TARGET = 15;
const DRAGON_CHALLENGE_BONUS_XP = 500;

function levelFromXp(xp) {
  // Square-root progression: every level needs ~100 more XP than the last.
  // Tunable later in tenant_settings.
  return Math.max(1, Math.floor(Math.sqrt(xp / 50)) + 1);
}

function startOfWeekISO() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString();
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const userId = req.query.user_id || null;
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = startOfWeekISO();

  // Resolve user if id provided
  let user = null;
  if (userId) {
    const u = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, role')
      .eq('id', userId)
      .maybeSingle();
    if (u.data) user = { id: u.data.id, name: u.data.full_name || u.data.email, role: u.data.role };
  }

  // Briefing: today's items, optionally user-filtered (null for_user_id = all-hands)
  let briefingQ = supabaseAdmin
    .from('briefing_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('for_date', today)
    .is('dismissed_at', null)
    .order('priority', { ascending: true })   // urgent < high < normal alphabetically — close enough; UI can resort
    .order('created_at', { ascending: false })
    .limit(50);
  if (userId) briefingQ = briefingQ.or(`for_user_id.eq.${userId},for_user_id.is.null`);
  const briefing = await briefingQ;

  // Quests: open + completed-today
  let openQ = supabaseAdmin
    .from('quests')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('status', ['open', 'in_progress'])
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (userId) openQ = openQ.or(`assigned_to.eq.${userId},assigned_to.is.null`);
  const openQuests = await openQ;

  let completedQ = supabaseAdmin
    .from('quests')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'completed')
    .gte('completed_at', today + 'T00:00:00Z');
  if (userId) completedQ = completedQ.or(`completed_by.eq.${userId},assigned_to.eq.${userId}`);
  const completedQuests = await completedQ;

  // Power level + XP
  let powerLevel = null, xpTotal = 0, xpToday = 0;
  if (userId) {
    const xp = await supabaseAdmin
      .from('xp_ledger')
      .select('xp, awarded_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);
    if (xp.data) {
      xpTotal = xp.data.reduce((s, r) => s + (r.xp || 0), 0);
      xpToday = xp.data
        .filter(r => r.awarded_at && r.awarded_at.slice(0, 10) === today)
        .reduce((s, r) => s + (r.xp || 0), 0);
      powerLevel = levelFromXp(xpTotal);
    }
  }

  // KPIs (top 12 by sort_order)
  const kpis = await supabaseAdmin
    .from('kpis')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
    .limit(12);

  // Dragon's Challenge — quests completed this week (any user)
  const dc = await supabaseAdmin
    .from('quests')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'completed')
    .gte('completed_at', weekStart);
  const completedThisWeek = dc.count || 0;
  const dragonChallenge = {
    weekStart,
    completedThisWeek,
    target: DRAGON_CHALLENGE_WEEKLY_TARGET,
    percent: Math.min(100, Math.round((completedThisWeek / DRAGON_CHALLENGE_WEEKLY_TARGET) * 100)),
    bonus: DRAGON_CHALLENGE_BONUS_XP,
    achieved: completedThisWeek >= DRAGON_CHALLENGE_WEEKLY_TARGET
  };

  // Quest counts
  const open = openQuests.data || [];
  const counts = {
    open: open.length,
    completedToday: (completedQuests.data || []).length,
    urgent: open.filter(q => q.metadata?.agent_priority === 'top_priority').length,
    daily: open.filter(q => q.type === 'daily').length,
    campaign: open.filter(q => q.type === 'campaign').length,
    optional: open.filter(q => q.type === 'optional').length
  };

  return res.status(200).json({
    date: today,
    user: user ? { ...user, power_level: powerLevel, xp_total: xpTotal, xp_today: xpToday, level: powerLevel } : null,
    briefing: briefing.data || [],
    quests: {
      open,
      completedToday: completedQuests.data || [],
      counts
    },
    kpis: kpis.data || [],
    dragonChallenge
  });
}

export default requireTenant(handler);
