// ═══════════════════════════════════════════════════════════════
// Cron + manual auth gate for /api/agents/* endpoints.
//
// Accepts either:
//   1. Authorization: Bearer $CRON_SECRET     — Vercel cron auto-injects this
//   2. x-owner-call: <any value>              — manual triggers from admin UI
//                                               (admin-cron-health.html etc.)
//
// Dev fallback: if CRON_SECRET is unset, the gate is open. Production Vercel
// deployments MUST have CRON_SECRET set in env — without it the gate provides
// no protection.
//
// Mirrors the inline pattern in api/agents/cron-daily.js (the canonical
// reference). Consolidated here so the 8 other agent crons can share one
// source of truth.
//
// Usage:
//   import { requireCronOrOwner } from '../../lib/cronAuth.js';
//   export default async function handler(req, res) {
//     const auth = requireCronOrOwner(req);
//     if (!auth.ok) return res.status(401).json({ error: auth.error });
//     ...
//   }
// ═══════════════════════════════════════════════════════════════

export function requireCronOrOwner(req) {
  const cronSecret = (process.env.CRON_SECRET || '').trim();

  // Dev convenience: no secret configured → open (matches marketing-publish.js).
  if (!cronSecret) return { ok: true, via: 'open-dev' };

  const auth = (req.headers['authorization'] || '').trim();
  if (auth === `Bearer ${cronSecret}`) return { ok: true, via: 'cron-secret' };

  if (req.headers['x-owner-call']) return { ok: true, via: 'owner-manual' };

  return { ok: false, error: 'Unauthorized — provide CRON_SECRET or x-owner-call header' };
}
