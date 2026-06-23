// Ryujin OS, Team OS aggregator
//
// GET  /api/team                 returns the merged roster: team_coverage.people[]
//                                each enriched with a `login` sub-object (from the
//                                users table, SAFE fields only) plus unlinkedUsers[]
//                                (login accounts not on the roster) plus updatedAt.
// PUT  /api/team?action=save     owner/admin. { team_coverage, updatedAt }. Server-side
//                                optimistic-concurrency (409 on stale) then writes the
//                                whole roster blob. The ONE write path the page uses for
//                                roster field edits, so SAVE and toggle share a single
//                                concurrency gate.
// PUT  /api/team?action=toggle   owner/admin. { id, active, updatedAt }. Concurrency 409.
//                                Dual-write: if the person is linked to a users row, flip
//                                users.active first; if the blob write then fails, the
//                                login flip is rolled back so there is no partial state.
// PUT  /api/team?action=link     owner/admin. { id, linkedUserId|null, updatedAt }.
//
// The roster lives in tenant_settings.team_coverage (jsonb). This handler is the single
// place that reconciles it against the users table and performs the atomic activate or
// deactivate dual-write, so the browser never does two unguarded writes. Reuses the SAME
// SAFE field contract as api/users.js: never expose password_hash, reset_token, or
// reset_token_expires_at.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { requireOwnerOrAdmin } from '../lib/auth-server.js';
import { resolveSession } from '../lib/portalAuth.js';

const SAFE_USER_FIELDS = 'id, email, username, name, phone, role, role_id, avatar_url, active';

function firstToken(s) {
  return String(s || '').trim().toLowerCase().split(/\s+/)[0] || '';
}

// Stale if the server has a version and the caller either sent none or sent an older one.
// Treating a missing client updatedAt as stale (when the server has one) closes the
// null-updatedAt bypass where a fresh-seed / offline client could overwrite newer data.
function isStale(serverAt, clientAt) {
  if (!serverAt) return false;
  if (!clientAt) return true;
  return Date.parse(serverAt) > Date.parse(clientAt);
}

// Resolve a roster person to a users row. Only linkedUserId is authoritative; email and
// first-name matches are SUGGESTIONS the owner confirms via the edit drawer, and we only
// suggest a name match when it is unambiguous (exactly one candidate).
function resolveLogin(person, usersById, usersByEmail, usersByFirstName) {
  if (person.linkedUserId && usersById.has(person.linkedUserId)) {
    return { user: usersById.get(person.linkedUserId), by: 'linkedUserId' };
  }
  const email = (person.email || '').toLowerCase().trim();
  if (email && usersByEmail.has(email)) return { user: usersByEmail.get(email), by: 'email' };
  const fn = firstToken(person.nick) || firstToken(person.name);
  if (fn && usersByFirstName.has(fn)) {
    const candidates = usersByFirstName.get(fn);
    if (candidates.length === 1) return { user: candidates[0], by: 'name' };
  }
  return null;
}

function loginView(u) {
  return {
    userId: u.id,
    name: u.name || null,
    email: u.email || null,
    username: u.username || null,
    role: u.role || null,
    roleId: u.role_id || null,
    userActive: u.active !== false,
    avatar_url: u.avatar_url || null,
  };
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: merged roster (any signed-in session, scoped to that session's tenant)
  if (req.method === 'GET') {
    const session = await resolveSession(req);
    if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
    const tenantId = session.tenant_id;

    const [{ data: settings, error: sErr }, { data: users, error: uErr }] = await Promise.all([
      supabaseAdmin.from('tenant_settings').select('team_coverage').eq('tenant_id', tenantId).maybeSingle(),
      supabaseAdmin.from('users').select(SAFE_USER_FIELDS).eq('tenant_id', tenantId).order('name'),
    ]);
    if (sErr) return res.status(500).json({ error: sErr.message });
    if (uErr) return res.status(500).json({ error: uErr.message });

    const tc = settings?.team_coverage || { functions: [], people: [], updatedAt: null };
    const people = Array.isArray(tc.people) ? tc.people : [];
    const allUsers = users || [];

    const usersById = new Map(allUsers.map(u => [u.id, u]));
    const usersByEmail = new Map(allUsers.filter(u => u.email).map(u => [u.email.toLowerCase(), u]));
    const usersByFirstName = new Map();
    for (const u of allUsers) {
      const fn = firstToken(u.name) || firstToken(u.username);
      if (!fn) continue;
      if (!usersByFirstName.has(fn)) usersByFirstName.set(fn, []);
      usersByFirstName.get(fn).push(u);
    }

    const consumed = new Set();
    const merged = people.map(p => {
      const hit = resolveLogin(p, usersById, usersByEmail, usersByFirstName);
      if (hit) consumed.add(hit.user.id);
      return { ...p, login: hit ? loginView(hit.user) : null, linkResolvedBy: hit ? hit.by : null };
    });
    const unlinkedUsers = allUsers.filter(u => !consumed.has(u.id)).map(loginView);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      functions: tc.functions || [],
      people: merged,
      unlinkedUsers,
      updatedAt: tc.updatedAt || null,
    });
  }

  // PUT: save / toggle / link (owner/admin only)
  if (req.method === 'PUT') {
    const auth = await requireOwnerOrAdmin(req, res);
    if (!auth) return; // 401/403 already sent
    const tenantId = auth.tenant_id;
    const action = String(req.query?.action || '').toLowerCase();
    const body = req.body || {};

    // Current server roster (id needed to decide update vs insert).
    const { data: settings, error: sErr } = await supabaseAdmin
      .from('tenant_settings').select('id, team_coverage').eq('tenant_id', tenantId).maybeSingle();
    if (sErr) return res.status(500).json({ error: sErr.message });
    const serverTc = settings?.team_coverage || null;
    const serverAt = serverTc?.updatedAt || null;

    // SAVE: whole-roster write through the same concurrency gate as toggle.
    if (action === 'save') {
      const incoming = body.team_coverage;
      if (!incoming || !Array.isArray(incoming.people)) return res.status(400).json({ error: 'bad_payload' });
      if (isStale(serverAt, body.updatedAt)) return res.status(409).json({ error: 'coverage_changed', updatedAt: serverAt });
      incoming.updatedAt = new Date().toISOString();
      if (settings?.id) {
        const { error } = await supabaseAdmin
          .from('tenant_settings').update({ team_coverage: incoming, updated_at: incoming.updatedAt }).eq('tenant_id', tenantId);
        if (error) return res.status(500).json({ error: error.message });
      } else {
        const { error } = await supabaseAdmin
          .from('tenant_settings').insert({ tenant_id: tenantId, team_coverage: incoming, updated_at: incoming.updatedAt });
        if (error) return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ ok: true, updatedAt: incoming.updatedAt });
    }

    // toggle + link both need an existing roster + a target person.
    if (!serverTc || !Array.isArray(serverTc.people)) return res.status(404).json({ error: 'no_roster' });
    const personId = body.id ? String(body.id) : '';
    if (!personId) return res.status(400).json({ error: 'missing id' });
    const person = serverTc.people.find(p => p.id === personId);
    if (!person) return res.status(404).json({ error: 'person_not_found' });
    if (isStale(serverAt, body.updatedAt)) return res.status(409).json({ error: 'coverage_changed', updatedAt: serverAt });

    if (action === 'toggle') {
      const active = !!body.active;
      const prevActive = person.active !== false;
      // Linked login: flip users.active FIRST. If it fails, do not touch the blob.
      if (person.linkedUserId) {
        const { error: uErr } = await supabaseAdmin
          .from('users').update({ active }).eq('id', person.linkedUserId).eq('tenant_id', tenantId);
        if (uErr) return res.status(500).json({ error: 'user_update_failed: ' + uErr.message });
      }
      person.active = active;
      serverTc.updatedAt = new Date().toISOString();
      const { error: wErr } = await supabaseAdmin
        .from('tenant_settings').update({ team_coverage: serverTc, updated_at: serverTc.updatedAt }).eq('tenant_id', tenantId);
      if (wErr) {
        // Roll back the login flip so we never leave login-state and roster-state disagreeing.
        if (person.linkedUserId) {
          try { await supabaseAdmin.from('users').update({ active: prevActive }).eq('id', person.linkedUserId).eq('tenant_id', tenantId); } catch (e) { /* best effort */ }
        }
        return res.status(500).json({ error: wErr.message });
      }
      return res.status(200).json({ ok: true, person, updatedAt: serverTc.updatedAt });
    }

    if (action === 'link') {
      const linkedUserId = body.linkedUserId ? String(body.linkedUserId) : null;
      if (linkedUserId) {
        const { data: u, error: uErr } = await supabaseAdmin
          .from('users').select('id').eq('id', linkedUserId).eq('tenant_id', tenantId).maybeSingle();
        if (uErr) return res.status(500).json({ error: uErr.message });
        if (!u) return res.status(400).json({ error: 'user_not_found_in_tenant' });
        person.linkedUserId = linkedUserId;
      } else {
        delete person.linkedUserId;
      }
      serverTc.updatedAt = new Date().toISOString();
      const { error: wErr } = await supabaseAdmin
        .from('tenant_settings').update({ team_coverage: serverTc, updated_at: serverTc.updatedAt }).eq('tenant_id', tenantId);
      if (wErr) return res.status(500).json({ error: wErr.message });
      return res.status(200).json({ ok: true, person, updatedAt: serverTc.updatedAt });
    }

    return res.status(400).json({ error: 'unknown_action', code: 'BAD_ACTION' });
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'method_not_allowed' });
}

export default requireTenant(handler);
