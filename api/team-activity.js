// Ryujin OS - Team activity feed (owner cockpit live feed).
// ----------------------------------------------------------------------------
// A unified, per-person stream of what the team is actually doing, so Mac can
// monitor the portals live. Unions the high-signal activity sources that already
// exist (no new tables): clock punches, photo/video uploads, task completions,
// team messages, and the generic event log. Owner/admin only. Distinct from
// /api/activity (the raw activity_log viewer); this is the rolled-up feed.
//
//   GET /api/team-activity?days=14&limit=120
//     -> { ok, generatedAt, feed:[{at,userId,user,role,kind,label,sub}],
//          byUser:[{userId,name,role,last24h,last7d,lastActive,breakdown}],
//          online:[{userId,name,since}] }
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant, isPrivileged } from '../lib/portalAuth.js';

const KIND_LABEL = {
  clock_in: 'clocked in', clock_out: 'clocked out',
  photo: 'added a photo', video: 'added footage', file: 'uploaded a file',
  task_done: 'completed a task', task_claim: 'working a task',
  message: 'sent a message', job: 'updated a record',
};

function fileKind(mime) {
  const m = String(mime || '');
  if (m.startsWith('video')) return 'video';
  if (m.startsWith('image')) return 'photo';
  return 'file';
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isPrivileged(req.session)) return res.status(403).json({ error: 'forbidden' });

  const tenantId = req.tenant.id;
  const days = Math.min(60, Math.max(1, parseInt(req.query.days) || 14));
  const limit = Math.min(300, Math.max(20, parseInt(req.query.limit) || 120));
  const sinceISO = new Date(Date.now() - days * 86400000).toISOString();
  const cap = 60; // per-source row cap

  const { data: users } = await supabaseAdmin
    .from('users').select('id, name, role').eq('tenant_id', tenantId);
  const U = new Map((users || []).map(u => [u.id, u]));
  const nameOf = (id) => (U.get(id)?.name) || 'Someone';
  const roleOf = (id) => (U.get(id)?.role) || null;

  const feed = [];
  const push = (at, userId, kind, label, sub) => {
    if (!at) return;
    feed.push({ at, userId: userId || null, user: userId ? nameOf(userId) : 'System', role: userId ? roleOf(userId) : null, kind, label, sub: sub || null });
  };

  const results = await Promise.allSettled([
    supabaseAdmin.from('time_entries')
      .select('user_id, clock_in, clock_out, total_hours, date')
      .eq('tenant_id', tenantId).gte('date', sinceISO.slice(0, 10))
      .order('date', { ascending: false }).limit(cap),
    supabaseAdmin.from('project_files')
      .select('uploaded_by, uploaded_by_name, mime_type, uploaded_at, project:projects(address, name)')
      .eq('tenant_id', tenantId).gte('uploaded_at', sinceISO)
      .order('uploaded_at', { ascending: false }).limit(cap),
    supabaseAdmin.from('tickets')
      .select('assigned_to, title, status, completed_at, updated_at')
      .eq('tenant_id', tenantId).not('assigned_to', 'is', null).gte('updated_at', sinceISO)
      .order('updated_at', { ascending: false }).limit(cap),
    supabaseAdmin.from('messages')
      .select('from_user_id, body, created_at')
      .eq('tenant_id', tenantId).not('from_user_id', 'is', null).gte('created_at', sinceISO)
      .order('created_at', { ascending: false }).limit(cap),
    supabaseAdmin.from('activity_log')
      .select('user_id, entity_type, action, details, created_at')
      .eq('tenant_id', tenantId).not('user_id', 'is', null).gte('created_at', sinceISO)
      .order('created_at', { ascending: false }).limit(cap),
  ]);
  const [te, pf, tk, ms, al] = results.map(r => (r.status === 'fulfilled' ? (r.value.data || []) : []));

  for (const r of te) {
    if (r.clock_in) push(r.clock_in, r.user_id, 'clock_in', KIND_LABEL.clock_in);
    if (r.clock_out) push(r.clock_out, r.user_id, 'clock_out', `${KIND_LABEL.clock_out}${r.total_hours ? ` (${r.total_hours}h)` : ''}`);
  }
  for (const r of pf) {
    const k = fileKind(r.mime_type);
    const where = r.project ? (r.project.address || r.project.name || '') : '';
    const uid = r.uploaded_by;
    if (uid || r.uploaded_by_name) {
      feed.push({ at: r.uploaded_at, userId: uid || null, user: uid ? nameOf(uid) : (r.uploaded_by_name || 'Crew'), role: uid ? roleOf(uid) : 'sub', kind: k, label: KIND_LABEL[k], sub: where || null });
    }
  }
  for (const r of tk) {
    if (r.completed_at && r.status === 'done') push(r.completed_at, r.assigned_to, 'task_done', `completed: ${r.title || 'a task'}`);
    else if (r.status === 'active') push(r.updated_at, r.assigned_to, 'task_claim', `working: ${r.title || 'a task'}`);
  }
  for (const r of ms) {
    const prev = String(r.body || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    push(r.created_at, r.from_user_id, 'message', 'sent a message', prev);
  }
  for (const r of al) {
    const d = r.details || {};
    const who = d.name || d.customer || d.title;
    push(r.created_at, r.user_id, 'job', `${r.action} ${r.entity_type}`, who ? String(who).slice(0, 60) : null);
  }

  feed.sort((a, b) => new Date(b.at) - new Date(a.at));
  const trimmed = feed.slice(0, limit);

  const now = Date.now();
  const D1 = now - 86400000, D7 = now - 7 * 86400000;
  const byUserMap = new Map();
  for (const e of feed) {
    if (!e.userId) continue;
    let b = byUserMap.get(e.userId);
    if (!b) { b = { userId: e.userId, name: e.user, role: e.role, last24h: 0, last7d: 0, lastActive: null, breakdown: {} }; byUserMap.set(e.userId, b); }
    const t = new Date(e.at).getTime();
    if (t >= D7) b.last7d += 1;
    if (t >= D1) b.last24h += 1;
    if (!b.lastActive || t > new Date(b.lastActive).getTime()) b.lastActive = e.at;
    b.breakdown[e.kind] = (b.breakdown[e.kind] || 0) + 1;
  }
  const byUser = Array.from(byUserMap.values()).sort((a, b) => b.last7d - a.last7d);

  const today = new Date().toISOString().slice(0, 10);
  const { data: openShifts } = await supabaseAdmin
    .from('time_entries').select('user_id, clock_in')
    .eq('tenant_id', tenantId).eq('date', today).is('clock_out', null).not('clock_in', 'is', null);
  const online = (openShifts || []).map(s => ({ userId: s.user_id, name: nameOf(s.user_id), since: s.clock_in }));

  return res.json({ ok: true, generatedAt: new Date().toISOString(), days, feed: trimmed, byUser, online });
}

export default requirePortalSessionAndTenant(handler);
