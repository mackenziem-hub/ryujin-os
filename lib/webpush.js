// lib/webpush.js — Web Push sender for the field crew app.
//
// No-op (returns skipped) until VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are set in
// the environment, so every caller is safe to ship ahead of the keys. Subscriptions
// live in push_subscriptions (migration_107); dead endpoints (404/410) are pruned.
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

// Send a push to every device subscription for one user. Best-effort, fail-soft.
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
  let sent = 0; const dead = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
      sent++;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) dead.push(s.id);
    }
  }
  if (dead.length) { try { await supabaseAdmin.from('push_subscriptions').delete().in('id', dead); } catch (e) {} }
  return { sent, pruned: dead.length };
}
