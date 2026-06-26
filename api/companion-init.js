// Ryujin OS - Companion app bootstrap (Phase 1).
// ----------------------------------------------------------------------------
// One endpoint that resolves WHO you are (an internal session OR a subcontractor
// magic-link) and returns the role-scoped capability map companion.html paints
// from. Capabilities are advisory for the UI; every DATA endpoint still enforces
// scope server-side (this is the tab-painting gate, not the security boundary).
//
//   GET /api/companion-init                          (Authorization: Bearer <session>)  internal users
//   GET /api/companion-init?token=<magic link>       subs (lead) + a sub's crew (installer)
//
// Role mapping for magic links: a subcontractor token = the sub LEAD -> 'sub';
// a sub_crew_members token = one of the sub's people -> 'installer' (Mac's
// media-only Installer/Team tier). Reuses the proven /api/sub-auth resolver.
import { supabaseAdmin } from '../lib/supabase.js';
import { resolveSession } from '../lib/portalAuth.js';
import { getCapabilities } from '../lib/roleCapabilities.js';

async function tenantIdForSlug(slug) {
  const { data } = await supabaseAdmin.from('tenants').select('id').eq('slug', slug).eq('active', true).maybeSingle();
  return data ? data.id : null;
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Internal session (owner / admin / crew / sales / ...). Tenant + role come
  //    authoritatively from the resolved session.
  const session = await resolveSession(req).catch(() => null);
  if (session) {
    const caps = await getCapabilities(session.tenant_id, session.role);
    return res.json({
      ok: true,
      kind: 'session',
      user: { id: session.user_id, name: session.name, email: session.email },
      role: session.role,
      capabilities: caps,
      data_scope: caps.data_scope,
    });
  }

  // 2. Subcontractor / installer magic-link. Reuse /api/sub-auth (handles both a
  //    sub-lead token and a sub-crew-member token) and map its kind to a role.
  const token = String(req.query.token || '').trim();
  if (token) {
    const BASE = (process.env.RYUJIN_BASE_URL || 'https://ryujin-os.vercel.app').trim();
    const tenantSlug = String(req.query.tenant || req.headers['x-tenant-id'] || 'plus-ultra').trim();
    try {
      const r = await fetch(`${BASE}/api/sub-auth?token=${encodeURIComponent(token)}&tenant=${encodeURIComponent(tenantSlug)}`, {
        headers: { 'x-tenant-id': tenantSlug },
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const a = await r.json().catch(() => ({}));
        const auth = a.auth || {};
        const sub = a.sub || {};
        const role = auth.kind === 'crew' ? 'installer' : 'sub';
        const tid = await tenantIdForSlug(tenantSlug);
        const caps = await getCapabilities(tid, role);
        return res.json({
          ok: true,
          kind: 'sub',
          user: { id: auth.member_id || sub.id || null, name: auth.member_name || sub.name || 'Crew' },
          role,
          capabilities: caps,
          data_scope: caps.data_scope,
          branding: a.branding || null,
        });
      }
    } catch { /* fall through to 401 */ }
  }

  return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
}

export default handler;
