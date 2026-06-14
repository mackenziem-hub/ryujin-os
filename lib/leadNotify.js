// ═══════════════════════════════════════════════════════════════
// LEAD NOTIFY. One delivery spine for the four lead-lifecycle events
// (new lead, inbound question, cold lead, signed/won).
//
// Every event does two things through this one call:
//   1. Insert a durable inbox_items row (notify=true) so the event lands
//      on /inbox.html and rides the inbox agent's SMS digest.
//   2. Send a notification email to the owner's tunable destination
//      (tenant_settings.inbox_config.notify_email).
//
// The signed/won event additionally fires a direct owner SMS via the
// pre-built Automator GHL contact, so a close buzzes Mac's phone now
// rather than waiting on the 20-min digest.
//
// IDEMPOTENCY: the inbox_items insert reuses the existing
//   unique (tenant_id, ghl_conversation_id, state_hash)
// constraint (migration 078). We set a deterministic non-null synthetic
// ghl_conversation_id ('lead-event:<event>:<dedupeKey>') and a
// deterministic state_hash (sha1 of 'event:dedupeKey'), so a repeat of
// the SAME event collides on the constraint and the insert is skipped
// (Postgres error 23505). NULLs are treated as distinct in a UNIQUE, so
// the synthetic id MUST be non-null for the collision to hold; it always
// is here. The ref_table/ref_id partial index is NOT used because ref_id
// is a uuid column and these dedupe keys are arbitrary text.
//
// ORDER: insert the inbox row FIRST, send the email SECOND. A failed
// email then still leaves a durable ping that the next digest tick can
// surface. Everything is best-effort and wrapped so a notify failure can
// never throw into the caller (lead capture, proposal accept, cron scan).
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from './supabase.js';
import { sendEmail } from './email.js';
import { ghlSendMessage } from './ghl.js';
import { buildLeadEventRow } from './leadEventRow.js';

const DEFAULT_NOTIFY_EMAIL = 'mackenzie.m@plusultraroofing.com';
// Pre-built Automator owner-alert GHL contact (same id sendOwnerDigest and
// sendFallbackSMS use). Sends through the GHL conversations path, not Twilio.
const OWNER_SMS_CONTACT_ID = '02IhxZfSwZZAZ2fooVGu';
const PLUS_ULTRA_SLUG = 'plus-ultra';

// The inbox_items row builder + event/category map live in ./leadEventRow.js
// (pure, dep-free) so the row shape and draft wiring are testable without the
// Supabase client. buildLeadEventRow is imported above.

// Resolve { tenantId, cfg } from either a tenant uuid or the plus-ultra slug.
// cfg is tenant_settings.inbox_config (the owner-tunable notify config).
async function resolveTenant({ tenantId }) {
  let id = tenantId || null;
  // No id given: fall back to the plus-ultra tenant (the only deployed tenant).
  if (!id) {
    try {
      const { data } = await supabaseAdmin
        .from('tenants').select('id').eq('slug', PLUS_ULTRA_SLUG).maybeSingle();
      id = data?.id || null;
    } catch { /* leave id null; caller still gets a status object */ }
  }
  let cfg = {};
  if (id) {
    try {
      const { data } = await supabaseAdmin
        .from('tenant_settings').select('inbox_config').eq('tenant_id', id).maybeSingle();
      cfg = data?.inbox_config || {};
    } catch { /* default cfg */ }
  }
  return { tenantId: id, cfg };
}

// Owner email destination: explicit config, else the Plus Ultra default.
function resolveNotifyEmail(cfg) {
  const v = String(cfg?.notify_email || '').trim();
  return v || DEFAULT_NOTIFY_EMAIL;
}

/**
 * Fire a unified lead-lifecycle notification (inbox row + email + optional SMS).
 *
 * @param {object} args
 * @param {string} [args.tenantId]      Tenant uuid. Omitted = resolve plus-ultra.
 * @param {string} args.event           'lead' | 'question' | 'cold_lead' | 'won'
 * @param {string} args.title           Email subject + inbox notify_reason source.
 * @param {string} [args.body]          Email + inbox body text.
 * @param {string} [args.contactName]   Who the event is about (inbox display).
 * @param {string} [args.ghlContactId]  GHL contact id, when known.
 * @param {string} [args.urgency]       inbox urgency (default 'normal').
 * @param {string} args.dedupeKey       Stable key; repeat of (event, key) is skipped.
 * @param {boolean} [args.sms=false]    Also fire a direct owner SMS (won only).
 * @param {string} [args.draftReply='']  Pre-drafted customer first-touch reply. When
 *                                       non-empty it lands in the inbox row's draft_reply
 *                                       and flips needs_reply on, so it surfaces as a
 *                                       one-tap-ready draft. NEVER auto-sent (Mac signs off).
 * @returns {Promise<{event,inboxInserted,inboxSkipped,emailOk,smsOk,errors}>}
 */
export async function notifyLeadEvent({
  tenantId,
  event,
  title,
  body = '',
  contactName = null,
  ghlContactId = null,
  urgency = 'normal',
  dedupeKey,
  sms = false,
  draftReply = '',
} = {}) {
  const status = {
    event,
    inboxInserted: false,
    inboxSkipped: false,
    emailOk: false,
    smsOk: false,
    errors: [],
  };

  try {
    if (!event) { status.errors.push('event required'); return status; }
    const key = String(dedupeKey == null ? '' : dedupeKey).trim() || `${event}-${Date.now()}`;
    const subject = String(title || `Ryujin lead event: ${event}`).slice(0, 240);

    const { tenantId: resolvedTenantId, cfg } = await resolveTenant({ tenantId });
    const notifyEmail = resolveNotifyEmail(cfg);

    // ── 1. Insert the durable inbox ping FIRST (idempotent) ──
    if (resolvedTenantId) {
      const row = buildLeadEventRow({
        tenantId: resolvedTenantId, event, key, subject, body,
        contactName, ghlContactId, urgency, draftReply,
      });
      try {
        const { error } = await supabaseAdmin.from('inbox_items').insert(row);
        if (error) {
          if (error.code === '23505') {
            status.inboxSkipped = true; // already pinged this exact event; no-op
          } else {
            status.errors.push(`inbox insert: ${error.message}`);
          }
        } else {
          status.inboxInserted = true;
        }
      } catch (e) {
        status.errors.push(`inbox insert: ${e.message}`);
      }
    } else {
      status.errors.push('no tenant resolved; inbox ping skipped');
    }

    // A dedup skip means this exact event was already delivered on a prior run
    // (the inbox row exists). Do NOT re-send the email or SMS, or a daily cron
    // scan (cold-lead / won stage scan) would re-spam Mac every day for the
    // same deal. The skip path is the idempotency gate for the outbound legs.
    if (status.inboxSkipped) return status;

    // ── 2. Send the notification email SECOND ──
    try {
      const res = await sendEmail({ to: notifyEmail, subject, body: body || subject });
      status.emailOk = !!res?.ok;
      if (!res?.ok) status.errors.push(`email: ${res?.error || 'unknown'}`);
    } catch (e) {
      status.errors.push(`email: ${e.message}`);
    }

    // ── 3. Optional direct owner SMS (won) via the Automator GHL contact ──
    if (sms === true) {
      if (process.env.OWNER_SMS_MUTED === '1') {
        status.errors.push('sms muted via OWNER_SMS_MUTED');
      } else {
        try {
          const smsBody = subject.length > 300 ? subject.slice(0, 297) + '...' : subject;
          await ghlSendMessage({ contactId: OWNER_SMS_CONTACT_ID, type: 'SMS', message: smsBody });
          status.smsOk = true;
        } catch (e) {
          status.errors.push(`sms: ${e.message}`);
        }
      }
    }
  } catch (e) {
    // Absolute backstop: notify must never throw into the caller.
    status.errors.push(`notifyLeadEvent: ${e.message}`);
  }

  return status;
}
