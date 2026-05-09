// ═══════════════════════════════════════════════════════════════
// POWER — XP / Power Level / Achievements payload for admin-power page.
//
// GET /api/power?user_id=<uuid>   — per-user power detail
// GET /api/power                  — aggregate (all users) for "Hall of Power"
//
// Returns:
//   {
//     user: { id, name, role } | null,
//     power: { level, xp_total, xp_today, xp_this_week, xp_in_level, xp_for_next_level, percent_to_next },
//     awards: [ { id, source_type, source_id, xp, note, awarded_at } ]   // last 50
//     achievements: [ { key, label, description, unlocked_at | null, progress, target } ]
//     stats: {
//       quests_completed_total,
//       quests_completed_today,
//       quests_completed_this_week,
//       streak_days,                    // consecutive days with at least 1 completion
//       dragon_challenges_won           // weeks with >= 15 completions
//     }
//   }
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

const DRAGON_TARGET = 15;

function levelFromXp(xp) { return Math.max(1, Math.floor(Math.sqrt(xp / 50)) + 1); }
function xpForLevel(lvl) { return Math.floor((lvl - 1) * (lvl - 1) * 50); }

function levelLabel(lvl) {
  if (lvl >= 50) return 'Dragon Master';
  if (lvl >= 30) return 'Sage';
  if (lvl >= 15) return 'Sensei';
  if (lvl >= 8)  return 'Adept';
  if (lvl >= 3)  return 'Apprentice';
  return 'Genin Roofer';
}

function startOfDayISO() {
  const d = new Date(); d.setHours(0,0,0,0); return d.toISOString();
}
function startOfWeekISO() {
  const d = new Date(); const day = d.getDay() || 7;
  d.setDate(d.getDate() - (day - 1)); d.setHours(0,0,0,0); return d.toISOString();
}

// Achievement definitions (computed, not stored — first cut). Easy to migrate
// to an `achievements` table later when we want owner-tunable definitions.
const ACHIEVEMENTS = [
  { key: 'first_steps',       label: 'First Steps',        description: 'Complete your first quest.',                       target: 1,   metric: 'quests_completed_total' },
  { key: 'on_a_roll',         label: 'On a Roll',          description: 'Complete 10 quests.',                              target: 10,  metric: 'quests_completed_total' },
  { key: 'centurion',         label: 'Centurion',          description: 'Complete 100 quests.',                             target: 100, metric: 'quests_completed_total' },
  { key: 'apprentice',        label: 'Apprentice',         description: 'Reach Power Level 3.',                             target: 3,   metric: 'level' },
  { key: 'adept',             label: 'Adept',              description: 'Reach Power Level 8.',                             target: 8,   metric: 'level' },
  { key: 'sensei',            label: 'Sensei',             description: 'Reach Power Level 15.',                            target: 15,  metric: 'level' },
  { key: 'sage',              label: 'Sage',               description: 'Reach Power Level 30.',                            target: 30,  metric: 'level' },
  { key: 'dragon_master',     label: 'Dragon Master',      description: 'Reach Power Level 50.',                            target: 50,  metric: 'level' },
  { key: 'dragon_slayer',     label: 'Dragon Slayer',      description: 'Win the Dragon\'s Challenge (15 quests in a week).', target: 1, metric: 'dragon_challenges_won' },
  { key: 'streak_7',          label: 'Lucky Seven',        description: 'Complete a quest 7 days in a row.',                target: 7,   metric: 'streak_days' },
  { key: 'streak_30',         label: 'Iron Will',          description: '30-day quest streak.',                              target: 30,  metric: 'streak_days' }
];

function computeAchievements(stats) {
  return ACHIEVEMENTS.map(a => {
    const cur = stats[a.metric] || 0;
    const unlocked = cur >= a.target;
    return {
      key: a.key,
      label: a.label,
      description: a.description,
      target: a.target,
      progress: Math.min(cur, a.target),
      unlocked,
      // We don't have an unlock-timestamp store yet — first-time unlock UX can
      // be added later via an achievements table if we want.
      unlocked_at: null
    };
  });
}

function streakDays(awardedAtList) {
  // awardedAtList: ISO strings, sorted DESC. Walk back day-by-day.
  if (!awardedAtList || awardedAtList.length === 0) return 0;
  const days = new Set(awardedAtList.map(s => s.slice(0, 10)));
  let n = 0;
  const cursor = new Date();
  while (true) {
    const k = cursor.toISOString().slice(0, 10);
    if (!days.has(k)) break;
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

function countDragonWeeks(completedAtList) {
  // completedAtList: ISO strings of all completed-quest timestamps
  if (!completedAtList || completedAtList.length === 0) return 0;
  const byWeek = {};
  for (const iso of completedAtList) {
    const d = new Date(iso);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - (day - 1));
    d.setHours(0,0,0,0);
    const k = d.toISOString().slice(0,10);
    byWeek[k] = (byWeek[k] || 0) + 1;
  }
  return Object.values(byWeek).filter(n => n >= DRAGON_TARGET).length;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const userId = req.query.user_id || null;
  const todayStart = startOfDayISO();
  const weekStart = startOfWeekISO();

  let user = null;
  if (userId) {
    const u = await supabaseAdmin.from('users').select('id, full_name, email, role').eq('id', userId).maybeSingle();
    if (u.data) user = { id: u.data.id, name: u.data.full_name || u.data.email, role: u.data.role };
  }

  // XP ledger
  let xpQ = supabaseAdmin
    .from('xp_ledger')
    .select('id, source_type, source_id, xp, note, awarded_at')
    .eq('tenant_id', tenantId)
    .order('awarded_at', { ascending: false })
    .limit(500);
  if (userId) xpQ = xpQ.eq('user_id', userId);
  const xp = await xpQ;

  const xpTotal = (xp.data || []).reduce((s, r) => s + (r.xp || 0), 0);
  const xpToday = (xp.data || []).filter(r => r.awarded_at >= todayStart).reduce((s, r) => s + (r.xp || 0), 0);
  const xpThisWeek = (xp.data || []).filter(r => r.awarded_at >= weekStart).reduce((s, r) => s + (r.xp || 0), 0);
  const level = levelFromXp(xpTotal);
  const xpInLevel = xpTotal - xpForLevel(level);
  const xpForNext = Math.max(1, xpForLevel(level + 1) - xpForLevel(level));
  const percent = Math.min(100, Math.round((xpInLevel / xpForNext) * 100));

  // Quest stats
  let qQ = supabaseAdmin
    .from('quests')
    .select('id, status, completed_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(2000);
  if (userId) qQ = qQ.or(`assigned_to.eq.${userId},completed_by.eq.${userId}`);
  const quests = await qQ;
  const completedAt = (quests.data || []).map(q => q.completed_at).filter(Boolean);

  const stats = {
    quests_completed_total:    completedAt.length,
    quests_completed_today:    completedAt.filter(t => t >= todayStart).length,
    quests_completed_this_week:completedAt.filter(t => t >= weekStart).length,
    streak_days:               streakDays((xp.data || []).map(r => r.awarded_at)),
    dragon_challenges_won:     countDragonWeeks(completedAt),
    level
  };

  return res.status(200).json({
    user,
    power: {
      level,
      level_label: levelLabel(level),
      xp_total: xpTotal,
      xp_today: xpToday,
      xp_this_week: xpThisWeek,
      xp_in_level: xpInLevel,
      xp_for_next_level: xpForNext,
      percent_to_next: percent
    },
    awards: (xp.data || []).slice(0, 50),
    achievements: computeAchievements(stats),
    stats
  });
}

export default requireTenant(handler);
