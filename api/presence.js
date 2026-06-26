// Ryujin OS - live presence (what each person is doing in their app right now).
// ----------------------------------------------------------------------------
// Each app instance heartbeats its current state (view, the job/context it is on,
// the last action) every few seconds. The owner cockpit (team-live.html) reads
// them all and renders a live mirror of the team's apps. Stored in Vercel Blob
// (one tiny doc per user, overwritten in place -> no DB migration, no write race
// between users). Presence is best-effort: a failure here NEVER breaks the app.
//
//   POST /api/presence   (any session) body { view, context, action }  -> upsert mine
//   GET  /api/presence   (owner/admin)  -> everyone's live presence
import { put, list } from '@vercel/blob';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';
import { supabaseAdmin } from '../lib/supabase.js';

const FRESH_MS = 35000; // "online" if the last heartbeat was within 35s

function presenceKey(tenantId, userId) {
  return `presence/${tenantId}/${userId}.json`;
}
async function tenantIdForSlug(slug) {
  const { data } = await supabaseAdmin.from('tenants').select('id').eq('slug', slug).eq('active', true).maybeSingle();
  return data ? data.id : null;
}
// Subs + a sub's installers heartbeat with their magic-link token (no session).
// Reuse the proven /api/sub-auth resolver; map its kind to a role.
async function resolveSubActor(token, tenantSlug) {
  try {
    const BASE = (process.env.RYUJIN_BASE_URL || 'https://ryujin-os.vercel.app').trim();
    const r = await fetch(`${BASE}/api/sub-auth?token=${encodeURIComponent(token)}&tenant=${encodeURIComponent(tenantSlug)}`,
      { headers: { 'x-tenant-id': tenantSlug }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const a = await r.json().catch(() => ({}));
    const auth = a.auth || {}, sub = a.sub || {};
    const tid = await tenantIdForSlug(tenantSlug);
    if (!tid) return null;
    return {
      userId: auth.member_id || sub.id || ('sub-' + token.slice(0, 8)),
      name: auth.member_name || sub.name || 'Crew',
      role: auth.kind === 'crew' ? 'installer' : 'sub',
      tenantId: tid,
    };
  } catch { return null; }
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

async function handler(req, res) {
  // Same-origin only: the apps + cockpit all call from window.location.origin.
  // No wildcard CORS on this authed, PII-returning endpoint.
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await resolveSession(req).catch(() => null);

  if (req.method === 'POST') {
    const body = await readBody(req);
    let actor = session
      ? { userId: session.user_id, name: session.name, role: session.role, tenantId: session.tenant_id }
      : null;
    if (!actor) {
      const token = String(body.token || req.query.token || '').trim();
      if (token) actor = await resolveSubActor(token, String(req.query.tenant || req.headers['x-tenant-id'] || 'plus-ultra').trim());
    }
    if (!actor) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
    const entry = {
      userId: actor.userId,
      name: actor.name || 'Someone',
      role: actor.role || null,
      view: String(body.view || '').slice(0, 40),
      context: String(body.context || '').slice(0, 90),
      action: String(body.action || '').slice(0, 70),
      at: new Date().toISOString(),
    };
    try {
      await put(presenceKey(actor.tenantId, actor.userId), JSON.stringify(entry), {
        access: 'public', addRandomSuffix: false, contentType: 'application/json',
      });
    } catch {
      return res.status(200).json({ ok: false, error: 'store_unavailable' });
    }
    return res.json({ ok: true });
  }

  if (req.method === 'GET') {
    if (!session || !isPrivileged(session)) return res.status(403).json({ error: 'forbidden' });
    let entries = [];
    try {
      const { blobs } = await list({ prefix: `presence/${session.tenant_id}/`, limit: 200 });
      const got = await Promise.allSettled(
        (blobs || []).map(b => fetch(b.url + '?t=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(3000) }).then(r => r.json()))
      );
      entries = got.filter(g => g.status === 'fulfilled' && g.value && g.value.userId).map(g => g.value);
    } catch {
      entries = [];
    }
    const now = Date.now();
    const presence = entries
      .map(e => {
        const ms = now - new Date(e.at).getTime();
        return { ...e, online: ms < FRESH_MS, secsAgo: Math.max(0, Math.round(ms / 1000)) };
      })
      .sort((a, b) => (Number(b.online) - Number(a.online)) || (new Date(b.at) - new Date(a.at)));
    return res.json({ ok: true, generatedAt: new Date().toISOString(), presence });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handler;
