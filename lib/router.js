// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Routing engine.
//
// routeIntent({tenantId, intent, urgency, fromUserId, fromLabel,
//              refs, operatorMessage}) →
//   { ok, routed_to: [{user_id, name, reason}], message_ids: [], skipped: false|reason }
//
// Resolves recipients via lib/routingMap, posts an internal message
// per recipient (single-row inserts so each appears in their own
// inbox; thread_id shared so the conversation is one continuous
// thread visible to anyone who's in the loop). Stamps
// metadata.auto_routed = true and metadata.intent so /portal-routes
// can audit later.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from './supabase.js';
import { resolveRecipients, renderMessageBody } from './routingMap.js';
import crypto from 'node:crypto';

async function loadTenantUsers(tenantId) {
  // We approximate "user slug" from the lower-cased first name. This works
  // for Plus Ultra's small operator team (Mac / Catherine / Darcy / Diego /
  // Aj / Pavanjot / Ryan). When tenants scale, add a users.slug column.
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, name, email, role')
    .eq('tenant_id', tenantId)
    .limit(200);
  if (error) return [];
  return (data || []).map(u => ({
    ...u,
    slug: (u.name || '').toLowerCase().split(/\s+/)[0] || (u.email || '').split('@')[0].toLowerCase(),
  }));
}

export async function routeIntent({
  tenantId,
  intent,
  urgency = 'normal',
  fromUserId = null,
  fromLabel = null,
  refs = {},               // { customer_id, customer_name, estimate_id, service_ticket_id }
  operatorMessage = '',
  conversationId = null,
}) {
  if (!tenantId || !intent) return { ok: false, error: 'tenantId + intent required' };

  const users = await loadTenantUsers(tenantId);
  const fromUser = fromUserId ? users.find(u => u.id === fromUserId) : null;
  const operatorName = fromUser?.name || fromLabel || 'an operator';

  const { user_ids, reasons } = resolveRecipients(intent, urgency, users);

  // Strip the originator from recipients — never DM the sender.
  const filtered = user_ids.filter(id => id !== fromUserId);
  if (filtered.length === 0) return { ok: true, routed_to: [], message_ids: [], skipped: 'no_recipients' };

  const threadId = crypto.randomUUID();
  const body = renderMessageBody(intent, {
    operator: operatorName,
    customer: refs.customer_name || (refs.customer_id ? 'the customer' : ''),
    operator_msg: operatorMessage.slice(0, 280),
  });

  const subject = `[auto] ${intent.replace(/_/g, ' ')}`;
  const inserts = filtered.map(toUserId => ({
    tenant_id: tenantId,
    thread_id: threadId,
    from_user_id: null,                            // system / agent post
    from_label: fromLabel || `${operatorName}'s ${intent.split('_')[0]} agent`,
    to_user_id: toUserId,
    subject,
    body,
    ref_estimate_id: refs.estimate_id || null,
    ref_customer_id: refs.customer_id || null,
    ref_service_ticket: refs.service_ticket_id || null,
    metadata: {
      auto_routed: true,
      intent,
      urgency,
      reason: reasons[toUserId] || 'role',
      source_conversation_id: conversationId,
      source_user_id: fromUserId,
      operator_message: operatorMessage,
    },
  }));

  const { data, error } = await supabaseAdmin
    .from('messages')
    .insert(inserts)
    .select('id, to_user_id');
  if (error) return { ok: false, error: error.message };

  const routed_to = (data || []).map(row => {
    const u = users.find(x => x.id === row.to_user_id);
    return {
      user_id: row.to_user_id,
      name: u?.name || 'unknown',
      reason: reasons[row.to_user_id] || 'role',
    };
  });

  return { ok: true, routed_to, message_ids: data.map(r => r.id), thread_id: threadId };
}
