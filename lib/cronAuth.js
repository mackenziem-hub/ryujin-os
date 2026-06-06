// ═══════════════════════════════════════════════════════════════
// Cron + manual auth gate for /api/agents/* endpoints.
//
// Accepts either:
//   1. Authorization: Bearer $CRON_SECRET     — Vercel cron auto-injects this
//   2. A real owner/admin session             — manual triggers from admin UI.
//      The browser sends Authorization: Bearer <ryujin_token>; we resolve it
//      via resolveSession() and require role owner|admin.
//
// SECURITY: the old `x-owner-call` header bypass was forgeable by anyone
// (a constant string, no identity) and the `if (!CRON_SECRET) open` branch
// failed OPEN. Both are removed. Fail-open survives ONLY under
// NODE_ENV==='development' for local testing; prod always enforces.
//
// NOTE: this function is now ASYNC (it does a DB-backed session lookup for the
// owner path). Every caller MUST `await` it.
//
// Usage:
//   import { requireCronOrOwner } from '../../lib/cronAuth.js';
//   export default async function handler(req, res) {
//     const auth = await requireCronOrOwner(req);
//     if (!auth.ok) return res.status(401).json({ error: auth.error });
//     ...
//   }
// ═══════════════════════════════════════════════════════════════

import { resolveSession } from './portalAuth.js';

const PRIVILEGED_ROLES = new Set(['owner', 'admin']);

export async function requireCronOrOwner(req) {
  const cronSecret = (process.env.CRON_SECRET || '').trim();

  // 1. Vercel cron path — injected Bearer CRON_SECRET. Kept verbatim.
  if (cronSecret) {
    const auth = (req.headers['authorization'] || '').trim();
    if (auth === `Bearer ${cronSecret}`) return { ok: true, via: 'cron-secret' };
  }

  // 2. Manual operator path — a real owner/admin (or service token) session.
  //    resolveSession reads Authorization: Bearer <ryujin_token> (and the
  //    service-token bypass). No forgeable header shortcut.
  try {
    const session = await resolveSession(req);
    if (session && PRIVILEGED_ROLES.has(session.role)) {
      return { ok: true, via: 'owner-session', session };
    }
  } catch { /* fall through to 401 */ }

  // 3. Dev-only fail-open: explicit, never reachable in prod (NODE_ENV unset on
  //    Vercel defaults to 'production'). Local dev w/o CRON_SECRET still works.
  if (!cronSecret && process.env.NODE_ENV === 'development') {
    return { ok: true, via: 'open-dev' };
  }

  return { ok: false, error: 'Unauthorized — cron secret or owner/admin session required' };
}
