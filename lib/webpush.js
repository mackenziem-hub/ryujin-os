// lib/webpush.js - Web Push sender for the field crew app.
//
// No-op (returns skipped) until VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are set in
// the environment, so every caller is safe to ship ahead of the keys. Subscriptions
// live in push_subscriptions (migration_107); dead endpoints are pruned.
import webpush from 'web-push';
import { supabaseAdmin } from './supabase.js';

let _configured = null;
function configure() {
  if (_configured !== null) return _configured;
  const pub = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const priv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || 'mailto:plusultraroofing@gmail.com').trim();
  if (!pub || !priv) { _configured = false; return false; }
  try { webpush.setVapidDetails(subject, pub, priv); _configured = true; }
  catch (e) { _configured = false; }
  return _configured;
}

export function pushConfigured() { return configure(); }
export function vapidPublicKey() { return (process.env.VAPID_PUBLIC_KEY || '').trim(); }

// SSRF guard: a push endpoint is a server-side fetch target, so only accept the
// real push services. Anything else (internal IPs, arbitrary hosts) is rejected
// at store time (api/push.js) and again here at send time.
const ALLOWED_PUSH_HOST = /(?:^|\.)(?:fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/i;
export function isAllowedPushEndpoint(endpoint) {
  try { const u = new URL(String(endpoint)); return u.protocol === 'https:' && ALLOWED_PUSH_HOST.test(u.hostname); }
  catch (e) { return false; }
}

// Dead-subscription status codes: gone (404/410), VAPID/credential mismatch (403),
// malformed/too-large (400/413). All mean "stop sending to this endpoint".
const DEAD_CODES = new Set([400, 403, 404, 410, 413]);

// Send a push to every device subscription for one user. Best-effort, fail-soft,
// bounded (per-send timeout + parallel) so it can be awaited on the request path
// without a stalled push service blocking the user's response.
export async function sendPushToUser(tenantId, userId, payload) {
  if (!configure()) return { sent: 0, pruned: 0, skipped: 'no-vapid' };
  if (!tenantId || !userId) return { sent: 0, pruned: 0 };
  let subs = [];
  try {
    const { data } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);
    subs = data || [];
  } catch (e) { return { sent: 0, pruned: 0, error: 'load' }; }
  if (!subs.length) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(payload || {});
  const dead = []; let sent = 0;
  await Promise.allSettled(subs.map(async (s) => {
    if (!isAllowedPushEndpoint(s.endpoint)) { dead.push(s.id); return; }
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { timeout: 4000 });
      sent++;
    } catch (e) {
      if (e && DEAD_CODES.has(e.statusCode)) dead.push(s.id);
    }
  }));
  if (dead.length) { try { await supabaseAdmin.from('push_subscriptions').delete().in('id', dead); } catch (e) {} }
  return { sent, pruned: dead.length };
}
