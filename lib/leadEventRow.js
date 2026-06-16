// ═══════════════════════════════════════════════════════════════
// LEAD EVENT ROW. Pure builder for the inbox_items row a lead-lifecycle
// event inserts. No IO, no DB, no deps beyond node's crypto, so the row
// shape, the idempotency keys, and the draft-reply wiring are unit-testable
// in isolation (lib/leadNotify.js imports this; the test imports it directly
// without pulling in the Supabase client).
// ═══════════════════════════════════════════════════════════════

import { createHash } from 'crypto';

// Map an event to the inbox_items category so the queue + filters read true.
export const EVENT_CATEGORY = {
  lead: 'lead',
  question: 'lead',
  cold_lead: 'lead',
  won: 'customer',
};

/**
 * Build the inbox_items row for a lead-lifecycle event.
 * A non-empty draftReply lands in draft_reply and flips needs_reply true, so
 * the row renders as a one-tap-ready draft on /inbox.html. It is never sent.
 */
export function buildLeadEventRow({
  tenantId, event, key, subject, body = '', contactName = null,
  ghlContactId = null, urgency = 'normal', draftReply = '',
}) {
  // Deterministic, non-null. Repeat of the same (event, key) collides on the
  // unique (tenant_id, ghl_conversation_id, state_hash) constraint (mig 078).
  const convoKey = `lead-event:${event}:${key}`.slice(0, 240);
  const stateHash = createHash('sha1').update(`${event}:${key}`).digest('hex').slice(0, 32);
  const draft = String(draftReply == null ? '' : draftReply).slice(0, 4000);
  const hasDraft = !!draft.trim();
  const subj = String(subject == null ? '' : subject);
  return {
    tenant_id: tenantId,
    source: 'lead_event',
    ghl_conversation_id: convoKey,
    ghl_contact_id: ghlContactId || null,
    contact_name: contactName || null,
    channel: 'email',
    last_message_body: String(body || subj).slice(0, 4000),
    last_message_at: new Date().toISOString(),
    last_message_id: null,
    state_hash: stateHash,
    summary: subj.slice(0, 500),
    category: EVENT_CATEGORY[event] || 'lead',
    urgency: String(urgency || 'normal').slice(0, 20),
    notify: true,
    notify_reason: subj.slice(0, 160),
    // A drafted first-touch makes the event actionable (tap to edit + send);
    // with no draft it stays a quiet ping, the prior behaviour.
    needs_reply: hasDraft,
    draft_reply: draft,
    status: 'needs_review',
    agent_run_id: null,
  };
}
