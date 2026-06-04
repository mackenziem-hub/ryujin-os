// Ryujin OS — Inbox Agent operator API
//
// The human approval surface for the inbox agent (api/agents/inbox.js).
// The agent only DRAFTS replies; nothing reaches a customer until someone
// hits send here. This endpoint backs /inbox.html.
//
// Endpoints:
//   GET    /api/inbox                       — the review queue + recently handled + last run
//   GET    /api/inbox?id=X                   — single item detail
//   PUT    /api/inbox  { id, action, body }  — action: 'send' | 'dismiss' | 'save-draft'
//   POST   /api/inbox?action=run             — manual fire of the inbox agent
//
// Auth: requirePortalSessionAndTenant. 'send' and 'run' require isPrivileged
// (owner/admin) so only Mac or Cat can send a reply to a customer or fire a
// scan; dismiss / save-draft stay open to any authenticated portal user.
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant, isPrivileged } from '../lib/portalAuth.js';
import { ghlSendMessage } from '../lib/ghl.js';

const HANDLED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const META_CHANNELS = new Set(['facebook', 'instagram']);
// Meta platform rule: a business may only message a user inside 24h of the
// user's last message. Drafts that sit unapproved past this window will be
// rejected by Facebook/Instagram on send, so the UI warns before then.
const META_WINDOW_MS = 24 * 60 * 60 * 1000;

const CHANNEL_LABELS = {
  sms: 'SMS', email: 'Email', facebook: 'Facebook', instagram: 'Instagram',
  whatsapp: 'WhatsApp', webchat: 'Web chat', gmb: 'Google', sub_portal: 'Sub portal',
};

// Strip em / en dashes from anything about to leave the building (defense in
// depth — the triage prompt already forbids them, this catches edited drafts).
function stripDashes(s) {
  return String(s == null ? '' : s).replace(/\s*[—–]\s*/g, ', ');
}

function metaWindow(channel, lastMessageAt) {
  const applies = META_CHANNELS.has(channel);
  if (!applies || !lastMessageAt) return { applies, closed: false, hours_left: null };
  const elapsed = Date.now() - new Date(lastMessageAt).getTime();
  const closed = elapsed >= META_WINDOW_MS;
  return {
    applies,
    closed,
    hours_left: closed ? 0 : Math.max(0, Math.round((META_WINDOW_MS - elapsed) / 3600000)),
  };
}

function shapeItem(row) {
  if (!row) return row;
  return {
    id: row.id,
    contact_name: row.contact_name || 'Unknown contact',
    ghl_contact_id: row.ghl_contact_id,
    ghl_conversation_id: row.ghl_conversation_id,
    channel: row.channel,
    channel_label: CHANNEL_LABELS[row.channel] || row.channel,
    summary: row.summary,
    category: row.category,
    urgency: row.urgency,
    notify: row.notify,
    notify_reason: row.notify_reason,
    needs_reply: row.needs_reply,
    draft_reply: row.draft_reply,
    last_message_body: row.last_message_body,
    last_message_at: row.last_message_at,
    status: row.status,
    sent_at: row.sent_at,
    sent_body: row.sent_body,
    error: row.error,
    created_at: row.created_at,
    window: metaWindow(row.channel, row.last_message_at),
    source: row.source || 'ghl',
    ref_table: row.ref_table || null,
    ref_id: row.ref_id || null,
    sub_id: row.sub_id || null,
  };
}

async function loadQueue(tenantId) {
  const since = new Date(Date.now() - HANDLED_WINDOW_MS).toISOString();
  const [pendingRes, handledRes, runRes] = await Promise.all([
    supabaseAdmin
      .from('inbox_items')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'needs_review')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(100),
    supabaseAdmin
      .from('inbox_items')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('status', ['sent', 'dismissed'])
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })
      .limit(30),
    supabaseAdmin
      .from('agent_runs')
      .select('started_at, completed_at, status, summary')
      .eq('tenant_id', tenantId)
      .eq('agent_slug', 'inbox')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const pending = (pendingRes.data || []).map(shapeItem);
  const handled = (handledRes.data || []).map(shapeItem);

  return {
    counts: {
      needs_review: pending.length,
      notify: pending.filter(i => i.notify).length,
      handled_last_7d: handled.length,
    },
    needs_review: pending,
    recent_handled: handled,
    last_run: runRes.data || null,
  };
}

async function loadSingle(tenantId, id) {
  const { data, error } = await supabaseAdmin
    .from('inbox_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return shapeItem(data);
}

// GHL's send-message endpoint requires subject + html for type=Email; a bare
// text send is rejected. Until that payload is built, email replies are
// review-only (the draft is still useful to copy into Gmail).
const EMAIL_REVIEW_ONLY = 'Email replies do not send from here yet. The draft is ready to copy into Gmail. SMS, Facebook, Instagram and WhatsApp replies do send from here.';

// Channels GHL can actually deliver outbound via POST /conversations/messages.
// webchat (Live_Chat) and gmb (Google) are NOT sendable there, so an approve
// would flip the claim to sending, fail at GHL, and bounce the item back with
// an error. Block them up front (review only) instead of attempting a doomed
// send. (Review fix 2026-05-29.)
const SENDABLE_CHANNELS = new Set(['sms', 'facebook', 'instagram', 'whatsapp']);
const channelReviewOnly = (ch) =>
  `${CHANNEL_LABELS[ch] || ch} replies do not send from here yet. The draft is ready to copy.`;

// Approve + send. The ONLY path that pushes a message to a customer.
async function sendReply({ tenantId, id, body }) {
  const { data: item, error } = await supabaseAdmin
    .from('inbox_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!item) return { error: 'Inbox item not found', status: 404 };
  if (item.status === 'sent') return { error: 'Already sent', status: 409 };
  if (item.status !== 'needs_review') return { error: 'Item is not awaiting review', status: 409 };
  // Sub-portal items are bridged from the internal messages table and have no
  // GHL channel to send through. Reply lives in /messages.html (keeps the thread).
  if ((item.source || 'ghl') !== 'ghl') {
    return { error: 'This is a sub portal message. Reply in /messages.html to keep the thread.', status: 422 };
  }
  if (!item.ghl_contact_id) return { error: 'No contact id on this item, cannot send', status: 422 };
  if (!SENDABLE_CHANNELS.has(item.channel)) {
    return { error: item.channel === 'email' ? EMAIL_REVIEW_ONLY : channelReviewOnly(item.channel), status: 422 };
  }

  const finalBody = stripDashes((body && String(body).trim()) || item.draft_reply || '');
  if (!finalBody) return { error: 'Nothing to send (empty reply)', status: 400 };

  // Atomic claim: flip needs_review -> sending as a compare-and-set so two
  // concurrent approves (double-click, multi-tab, retry) cannot both reach the
  // irreversible GHL send. Only the request that wins the claim proceeds.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('inbox_items')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('id', id).eq('tenant_id', tenantId).eq('status', 'needs_review')
    .select('id').maybeSingle();
  if (claimErr) return { error: claimErr.message, status: 500 };
  if (!claimed) return { error: 'Item is already being handled', status: 409 };

  let sendResult;
  try {
    sendResult = await ghlSendMessage({
      contactId: item.ghl_contact_id,
      channel: item.channel,
      message: finalBody,
    });
  } catch (e) {
    // Release the claim back to the queue so it can be retried; record why.
    await supabaseAdmin
      .from('inbox_items')
      .update({ status: 'needs_review', error: `send failed: ${e.message}`.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', tenantId);
    return { error: `GHL send failed: ${e.message}`, status: 502 };
  }

  const sentMessageId = sendResult?.messageId || sendResult?.message?.id
    || sendResult?.conversationId || null;
  const { data: updated, error: upErr } = await supabaseAdmin
    .from('inbox_items')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      sent_message_id: sentMessageId,
      sent_body: finalBody,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id).eq('tenant_id', tenantId)
    .select('*').single();
  if (upErr) return { error: upErr.message, status: 500 };
  return { item: shapeItem(updated) };
}

async function dismissItem({ tenantId, id }) {
  const { data, error } = await supabaseAdmin
    .from('inbox_items')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .eq('id', id).eq('tenant_id', tenantId)
    .eq('status', 'needs_review')   // don't clobber an already-sent item
    .select('*').maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: 'Item not found or already handled', status: 404 };
  return { item: shapeItem(data) };
}

async function saveDraft({ tenantId, id, body }) {
  const { data, error } = await supabaseAdmin
    .from('inbox_items')
    .update({ draft_reply: String(body == null ? '' : body).slice(0, 4000), updated_at: new Date().toISOString() })
    .eq('id', id).eq('tenant_id', tenantId)
    .eq('status', 'needs_review')
    .select('*').maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: 'Item not found or already handled', status: 404 };
  return { item: shapeItem(data) };
}

async function runAgent({ req }) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `https://${req.headers.host || 'ryujin-os.vercel.app'}`;
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const headers = { 'Content-Type': 'application/json' };
  if (cronSecret) headers['Authorization'] = `Bearer ${cronSecret}`;
  // Fire the scan for the CALLER's tenant (session-derived), not a hardcoded
  // slug. The agent re-checks inbox_agent_enabled per tenant so this is safe.
  const slug = encodeURIComponent(req.tenant.slug);
  try {
    const r = await fetch(`${baseUrl}/api/agents/inbox?tenant=${slug}&manual=1`, { method: 'POST', headers });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    if (!r.ok) return { error: body?.error || `agent returned ${r.status}`, status: 502 };
    return { result: body };
  } catch (e) {
    return { error: e.message, status: 500 };
  }
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;
  const session = req.session;

  if (req.method === 'GET') {
    const { id } = req.query;
    if (id) {
      const item = await loadSingle(tenantId, id);
      if (!item) return res.status(404).json({ error: 'Item not found' });
      return res.json(item);
    }
    const queue = await loadQueue(tenantId);
    return res.json(queue);
  }

  if (req.method === 'PUT') {
    const { id, action, body } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    if (action === 'send') {
      if (!isPrivileged(session)) return res.status(403).json({ error: 'Owner or admin required to send a reply' });
      const out = await sendReply({ tenantId, id, body });
      if (out.error) return res.status(out.status || 500).json({ error: out.error });
      return res.json({ sent: true, item: out.item });
    }
    if (action === 'dismiss') {
      const out = await dismissItem({ tenantId, id });
      if (out.error) return res.status(out.status || 500).json({ error: out.error });
      return res.json({ dismissed: true, item: out.item });
    }
    if (action === 'save-draft') {
      const out = await saveDraft({ tenantId, id, body });
      if (out.error) return res.status(out.status || 500).json({ error: out.error });
      return res.json({ saved: true, item: out.item });
    }
    return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  if (req.method === 'POST') {
    const { action } = req.query;
    if (action === 'run') {
      if (!isPrivileged(session)) return res.status(403).json({ error: 'Owner or admin required to fire the inbox agent' });
      const out = await runAgent({ req });
      if (out.error) return res.status(out.status || 500).json({ error: out.error });
      return res.json({ fired: true, ...out });
    }
    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requirePortalSessionAndTenant(handler);
