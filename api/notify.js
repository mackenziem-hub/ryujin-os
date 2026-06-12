// ═══════════════════════════════════════════════════════════════
// RYUJIN NOTIFY — privileged SMS ping to Mac
// POST /api/notify { message } → SMS via the pre-built GHL/Automator path
// (same sendFallbackSMS the heartbeat dead-man uses; contact = Mac).
// Built for the Guild Hall foreman's periodic fleet digests: the foreman
// terminal has no GHL token locally, so it pings through this endpoint.
// Privileged-only: service token + x-tenant-id, or an owner/admin session.
// ═══════════════════════════════════════════════════════════════

import { requireTenant } from '../lib/tenant.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';
import { sendFallbackSMS } from './agents/_shared.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const session = await resolveSession(req).catch(() => null);
  if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  if (!isPrivileged(session)) return res.status(403).json({ error: 'admin_only', code: 'FORBIDDEN' });

  const message = String((req.body || {}).message || '').trim().slice(0, 600);
  if (!message) return res.status(400).json({ error: 'message required' });

  // Best-effort by design: sendFallbackSMS swallows transport errors and
  // returns null when muted (OWNER_SMS_MUTED) or unconfigured.
  await sendFallbackSMS(message);
  return res.status(200).json({ ok: true, length: message.length });
}

export default requireTenant(handler);
