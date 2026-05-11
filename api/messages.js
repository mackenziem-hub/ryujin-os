// ═══════════════════════════════════════════════════════════════
// /api/messages — internal Ryujin operator messaging.
//
//   GET  /api/messages?box=inbox|sent|unread[&thread_id=X][&limit=N]
//        Returns messages for the current user (resolved via session
//        token). Inbox = where to_user_id = me. Sent = from_user_id = me.
//        Unread = inbox + read_at IS NULL. With ?thread_id, returns
//        the full thread for either party.
//
//   POST /api/messages
//        body: { to_user_id (req), body (req), subject?, reply_to?,
//                ref_estimate_id?, ref_customer_id?,
//                ref_service_ticket?, ref_workorder_id?, metadata? }
//
//   PATCH /api/messages?id=<uuid>
//        body: { read?: true, archived?: true }
//
// Auth: requires session token (Authorization: Bearer / x-ryujin-token /
// ?token / body.token) so we know who "me" is. Agent-originated posts
// can use the API key + body.from_label = '<agent name>' to write
// from_user_id = null.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function resolveCurrentUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    || req.headers['x-ryujin-token']
    || req.query?.token
    || (req.body?.token);
  if (!token) return null;
  const { data: session } = await supabaseAdmin
    .from('sessions')
    .select('user_id, tenant_id, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (!session || new Date(session.expires_at) < new Date()) return null;
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, name, email, role')
    .eq('id', session.user_id)
    .maybeSingle();
  return user ? { ...user, tenant_id: session.tenant_id } : null;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;
  const me = await resolveCurrentUser(req);

  if (req.method === 'GET') {
    if (!me) return res.status(401).json({ error: 'Sign in to read messages' });
    const box = (req.query.box || 'inbox').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const threadId = req.query.thread_id;

    // Order direction depends on view: threads display chronologically
    // (oldest → newest, replies anchor at bottom of the scrollable pane);
    // inbox/sent lists show newest first. We DON'T stack two .order calls
    // because Supabase treats the first as primary — earlier code paired
    // DESC then ASC, so thread fetches were silently returning newest-first
    // and replies appeared at the top of the pane instead of the bottom.
    let q = supabaseAdmin
      .from('messages')
      .select(`
        id, thread_id, reply_to, from_user_id, from_label, to_user_id,
        subject, body, read_at, archived_at, created_at, metadata,
        ref_estimate_id, ref_customer_id, ref_service_ticket, ref_workorder_id,
        from_user:users!messages_from_user_id_fkey(name, email, role),
        to_user:users!messages_to_user_id_fkey(name, email, role)
      `)
      .eq('tenant_id', tenantId)
      .limit(limit);

    if (threadId) {
      // Thread visible to: from_user_id, to_user_id, or originator of an
      // auto-route (metadata.source_user_id). Last clause lets Darcy see
      // the system posts his agent fired alongside any human replies.
      q = q.eq('thread_id', threadId).or(`from_user_id.eq.${me.id},to_user_id.eq.${me.id},metadata->>source_user_id.eq.${me.id}`).order('created_at', { ascending: true });
    } else if (box === 'sent') {
      // "sent" = your DMs + auto-routes your agent fired on your behalf.
      q = q.or(`from_user_id.eq.${me.id},and(from_user_id.is.null,metadata->>source_user_id.eq.${me.id})`).is('archived_at', null).order('created_at', { ascending: false });
    } else if (box === 'auto_routes') {
      // Audit-only: just the auto-routed posts originating from this user.
      q = q.is('from_user_id', null).filter('metadata->>source_user_id', 'eq', me.id).order('created_at', { ascending: false });
    } else if (box === 'unread') {
      q = q.eq('to_user_id', me.id).is('read_at', null).is('archived_at', null).order('created_at', { ascending: false });
    } else {
      q = q.eq('to_user_id', me.id).is('archived_at', null).order('created_at', { ascending: false });
    }

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const stats = {
      total: data.length,
      unread: data.filter(m => !m.read_at && m.to_user_id === me.id).length,
    };
    return res.status(200).json({ messages: data, stats, me: { id: me.id, name: me.name } });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    // Auth gate: human-sent messages MUST have a resolved session user.
    // Agent/system messages may run without a session user IFF they
    // (a) carry an explicit from_label AND (b) include metadata.source_user_id
    // (so the auto-route is auditable + visible to the originating user).
    // Without either, refuse — silent fallthrough to from_user_id=null was
    // producing orphan "system" messages with no UI affordance.
    const isAgentRoute = !!body.from_label && !!body.metadata?.source_user_id;
    if (!me && !isAgentRoute) {
      return res.status(401).json({
        error: 'Sign in to send messages',
        code: 'AUTH_REQUIRED',
        hint: 'No valid session token. Visit /login.html to sign in.'
      });
    }
    // Accept both single recipient (to_user_id) and multi-recipient (to_user_ids array).
    // Multi-recipient creates N rows sharing a single thread_id so the conversation
    // is one continuous thread visible to every participant.
    let recipients = [];
    if (Array.isArray(body.to_user_ids) && body.to_user_ids.length) {
      recipients = body.to_user_ids.filter(Boolean);
    } else if (body.to_user_id) {
      recipients = [body.to_user_id];
    } else {
      return res.status(400).json({ error: 'to_user_id or to_user_ids required' });
    }
    if (!body.body) return res.status(400).json({ error: 'body required' });

    // If reply_to is set, inherit its thread_id; else generate a new one
    // shared across all recipients.
    let sharedThreadId = body.thread_id || null;
    if (body.reply_to && !sharedThreadId) {
      const { data: parent } = await supabaseAdmin
        .from('messages').select('thread_id').eq('id', body.reply_to).eq('tenant_id', tenantId).maybeSingle();
      if (parent?.thread_id) sharedThreadId = parent.thread_id;
    }

    const baseRow = {
      tenant_id: tenantId,
      from_user_id: me?.id || null,
      from_label: body.from_label || (me?.name || null),
      subject: body.subject || null,
      body: body.body,
      reply_to: body.reply_to || null,
      ref_estimate_id: body.ref_estimate_id || null,
      ref_customer_id: body.ref_customer_id || null,
      ref_service_ticket: body.ref_service_ticket || null,
      ref_workorder_id: body.ref_workorder_id || null,
      metadata: { ...(body.metadata || {}), participant_count: recipients.length },
    };
    if (sharedThreadId) baseRow.thread_id = sharedThreadId;

    const inserts = recipients.map(uid => ({ ...baseRow, to_user_id: uid }));
    const { data, error } = await supabaseAdmin
      .from('messages').insert(inserts).select('*');
    if (error) return res.status(500).json({ error: error.message });

    // Return all rows + a thread_id so the client can pivot to thread-view immediately.
    const threadId = data[0]?.thread_id || sharedThreadId;
    return res.status(201).json({
      messages: data,
      thread_id: threadId,
      recipient_count: data.length,
    });
  }

  if (req.method === 'PATCH') {
    if (!me) return res.status(401).json({ error: 'Sign in' });
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id query param required' });
    const body = req.body || {};
    const update = {};
    if (body.read === true) update.read_at = new Date().toISOString();
    if (body.read === false) update.read_at = null;
    if (body.archived === true) update.archived_at = new Date().toISOString();
    if (body.archived === false) update.archived_at = null;
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'set read or archived' });

    // Allow PATCH from: (a) from_user_id matching me, (b) to_user_id matching me,
    // OR (c) metadata.source_user_id matching me — the last clause is what
    // makes Undo on auto-routed messages work (system posts have from_user_id=null).
    const { data, error } = await supabaseAdmin
      .from('messages')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .or(`from_user_id.eq.${me.id},to_user_id.eq.${me.id},metadata->>source_user_id.eq.${me.id}`)
      .select('*')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'not found or not yours' });
    return res.status(200).json({ message: data });
  }

  return res.status(405).json({ error: 'GET, POST, PATCH only' });
}

export default requireTenant(handler);
