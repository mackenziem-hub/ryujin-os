// api/push.js — Web Push subscription management for the field crew app.
// GET  /api/push?action=config  -> { publicKey }   (client needs it to subscribe)
// POST /api/push  { subscription: { endpoint, keys:{p256dh,auth} } }  -> store/upsert
// DELETE /api/push?endpoint=... -> remove (unsubscribe)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { resolveSession } from '../lib/portalAuth.js';
import { vapidPublicKey } from '../lib/webpush.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  // Public key is not secret; the client fetches it to build a subscription.
  if (req.method === 'GET' && req.query.action === 'config') {
    return res.json({ publicKey: vapidPublicKey() || null });
  }

  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const sub = body && body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ error: 'invalid subscription' });
    }
    const row = {
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
      last_used_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert(row, { onConflict: 'endpoint' });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const ep = req.query.endpoint || (req.body && req.body.endpoint);
    if (ep) { try { await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', ep).eq('tenant_id', session.tenant_id); } catch (e) {} }
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
