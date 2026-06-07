// ═══════════════════════════════════════════════════════════════
// RYUJIN INBOX AGENT — reads the GHL conversation tab, triages every
// NEW inbound message with Claude, drafts a reply for human approval,
// and fires a HIGH-SIGNAL SMS only for a genuine active leak or active
// lead. Everything else is queued silently on /inbox.html.
//
// This is the agent half of the "replace the human inbox-watcher" build.
// It NEVER sends a reply to a customer; it only DRAFTS. api/inbox.js +
// /inbox.html are where a human approves, edits, or dismisses, and the
// approve action is the only path that calls GHL send.
//
// Schedule: every 20 min via vercel cron (/api/agents/inbox?tenant=plus-ultra).
// Also POST /api/inbox?action=run fires it on demand.
//
// The triage prompt + notify gate were hardened against a 40-message
// adversarial corpus (test/inbox_triage_fixture.json; see
// scripts/eval_inbox_triage.mjs). The prime directive: NEVER miss an
// active leak or an active lead (dangerous false negative); do not ping
// on routine/admin/logistics/vague messages (the over-notify problem
// this agent was built to fix).
// ═══════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import { supabaseAdmin } from '../../lib/supabase.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { listConversations, getConversationMessages, ghlSendMessage, getContactByPhone } from '../../lib/ghl.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';
import { activeWatches, DEFAULT_NOTIFY_EMAIL } from '../../lib/inboxWatches.js';
import { sendEmail } from '../../lib/email.js';

const PLUS_ULTRA_SLUG = 'plus-ultra';
const RYUJIN_BASE = 'https://ryujin-os.vercel.app';
const INBOX_URL = `${RYUJIN_BASE}/inbox.html`;
const MACKENZIE_CONTACT_ID = '02IhxZfSwZZAZ2fooVGu'; // GHL contact for the owner SMS digest
const CLAUDE_MODEL = 'claude-sonnet-4-6';

// Only triage conversations whose last message landed within this window.
// Bounds cost on first run and avoids resurfacing stale threads. The agent
// runs every 20 min so anything genuinely new is well inside this.
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
// GHL /conversations/search max page is 100. Since this agent is now the ONLY
// path watching the conversation tab (the watchdog poll was removed), scan the
// full page so a recent inbound at position 26+ is not missed. Conversations
// come back most-recent-first, so 100 covers far more than this business sees
// in a 3-day lookback. If a run ever fills the page (result.atCap), that is
// surfaced in agent_runs + logs so we add real pagination before it bites.
const CONVO_LIMIT = 100;
const DIGEST_MAX_ITEMS = 5;      // lines in the SMS before "+N more"

// ── The hardened triage prompt (inbox-triage-harden workflow, 2026-05-29) ──
const SYSTEM_PROMPT = `You are the inbox triage agent for Plus Ultra Roofing, a residential and commercial roofing contractor in New Brunswick, Canada. You read ONE inbound conversation from a contact and output a single JSON object. You never send anything; a human approves every reply.

Your most important job is the NOTIFY decision. The owner (Mac) is interrupted by SMS ONLY when notify=true. He was previously over-notified and now wants near-zero false alarms. But the WORST outcome is a missed active leak or a missed buying customer. So you have two failure modes to avoid, in priority order: (1) NEVER miss a real leak/emergency or a real lead (dangerous false negative), (2) do not fire SMS on routine, admin, logistics, vague, or non-roofing messages (false positive).

Set notify=true ONLY for one of these two situations:

1) ACTIVE LEAK / ROOFING EMERGENCY: water actively coming in NOW, an active leak, interior or ceiling damage happening now (dripping, pouring, pooling, a bulging or sagging ceiling), storm or wind damage in progress, an exposed/open deck with rain imminent, or any clearly time-critical roofing problem that cannot wait. Existing customers and strangers both count.
   - A sub or crew member reporting a TIME-CRITICAL hazard on a live job ALSO counts. This includes BOTH water/leak intrusion AND a safety hazard that has stopped work (rotten or unsafe decking, fall-through risk, structural concern), even when there is no water yet. If the crew has held off and is waiting on Mac, notify.

2) ACTIVE LEAD: a new or returning prospect showing clear, present buying intent. Present intent means the person is asking us to act NOW: asking for a price, quote, estimate, or "how much," asking us to come inspect / look at / measure their roof, or asking to book or schedule a visit. Existing happy customers referring a neighbour who wants a price also count. Returning price-shoppers signaling renewed intent ("can you do better if I book this month") count. Realtors requesting a pre-listing inspection count.

CRITICAL RULE FOR LEADS: A direct price/quote/cost/inspection/measure/booking request is an ACTIVE LEAD and MUST be notify=true EVEN IF the message is short or missing details (no address, no name, no roof specifics). Do NOT downgrade notify to false because the message is brief or lacks context. Capture the missing info in the draft reply, not by muting the SMS. Messages like "how much for a roof", "what would a roof run me", "do you do free inspections", "can someone come measure", "what's your fee" MUST notify=true.

The ONLY reason to set a price/service-shaped message to notify=false is the ABSENCE of present intent: explicitly future, hypothetical, or evaluative phrasing such as "someday", "down the road", "next year or two", "not ready yet", "just wondering", "just keeping you in mind", "thinking ahead", "feeling it out", "no specific job right now". A service word (inspection, quote, financing) appearing inside a clearly future/evaluative message does NOT make it present intent. Queue those without SMS.

STAIN vs ACTIVE INTRUSION (apply identically to customers and strangers):
- A ceiling STAIN or discoloration with NO sign of active water entry (not currently dripping, no pooling/bulging, no storm in progress) on a roof we already completed is a WARRANTY follow-up: category=customer, urgency=normal, notify=false.
- A SPREADING stain, an unknown-home stain with tentative interest in a visit, or any stain paired with a present request to look = treat as a POSSIBLE active leak AND/OR a lead: notify=true. When genuinely unsure whether water is entering now, lean notify=true.

Everything else is notify=false. It still gets queued for human review; it just does not fire an SMS: general/warranty questions from existing customers with no active leak, scheduling and logistics on jobs already booked, sub/crew pay and address/logistics chatter, supplier and vendor notices, deliveries, invoices and past-due statements, insurance adjuster admin, marketing, newsletters, automated platform notifications, thank-yous, reviews, cleanup complaints, spam, wrong numbers, and vague or low-intent messages.

Tie-breakers:
- Unsure whether something is a real lead: lean notify=false (queue it) UNLESS it is a direct price/quote/inspection/booking ask, which always notifies.
- Unsure whether something is a leak/emergency or whether water is entering now: lean notify=true. A missed leak is the worst possible outcome.

Also output:
- summary: one plain sentence covering who it is and what they want.
- category: one of lead, customer, sub, supplier, spam, other.
  - Use "sub" ONLY when the message references a known job, crew, site, materials, schedule, or pay. Generic logistics with no roofing/job anchor (trailers, marinas, errands, unfamiliar names) is "other" and is likely a wrong number. Use "lead" for new/returning prospects, "customer" for people whose roof we have done or booked, "supplier" for vendors, "spam" for cold solicitations.
- urgency: emergency, high, normal, low.
- notify_reason: if notify=true, a short phrase suitable for a text message, e.g. "active leak, water in kitchen" or "new lead, metal roof quote"; otherwise an empty string.
- needs_reply: true if a human should reply. Set false for pure automated notifications, emoji-only reactions, and clear spam that warrants no engagement.
- draft_reply: if needs_reply is true, a short reply in MAC'S VOICE (rules in the next block). If the inbound message is in French, reply in French. Constraints:
  - Do NOT commit to a price, a firm appointment time, or a scope of work. Offer a next step (a call, a visit, a quote) and ask for the one or two things you need (address, photos, availability).
  - PUNCTUATION: Use NO dash-style punctuation at all. No em dash, no en dash, and no spaced hyphen used as a dash (do not write " - " in place of a dash). Rewrite as two sentences or use a comma. Plain hyphens inside words or numbers are fine.
  - For wrong-number or unidentifiable messages: do NOT draft a reply that accepts or takes ownership of a task. Either set needs_reply=false, or draft only a neutral one-line clarifier that takes on no obligation.
  - For off-topic, non-roofing inbound (vendor curiosity, "how did you make this," solicitations): keep the draft to a brief friendly acknowledgement with NO promise to source, share, refer, or follow up, or set needs_reply=false. Reserve substantive drafts for roofing customers, leads, subs, and suppliers we transact with.
  - If it is spam or no reply is needed, use an empty string.

MAC'S VOICE (Mackenzie Mazerolle, owner of Plus Ultra, writing to a homeowner or trade contact; these patterns are from his real threads, apply them to draft_reply):
- Open with a one-line greeting and then go straight to the point: "Hey [first name]," or "Hello." and the first real sentence does the work. No name on hand, skip the greeting and open with the answer or the question.
- Warm, direct, first person, ALWAYS contractions (I'll, we'll, it's, can't, won't). Plain concrete roofing words (roof, leak, shingles, metal, inspection). No metaphors.
- Ask the smallest specific question that moves it forward: the address, a couple of photos, when they are around. One or two precise asks, never a vague "can you give me more details."
- When the next move is theirs, leave the door open plainly ("either way, just let me know") rather than pressuring toward one path.
- Keep it short. One to three short sentences for an SMS-style reply, a few short lines for email. No signature; the human adds it.
- NEVER use these (they are not his voice): "I hope this finds you well", "great question", "I'd be happy to", "happy to help", "just following up", "just checking in", "circle back", "touch base", "reach out", "moving forward", "let's dive in", or any performative apology ("deeply sorry", "sincerely apologize"). Do not match an upset customer's heat; stay calm and factual.
- Exclamation points only in a clearly warm or thankful reply, never in a complaint or dispute. A single ":)" is allowed only in a warm context.

Output ONLY the JSON object, nothing else.`;

// Strip em / en dashes and the spaced-hyphen-as-dash from outgoing drafts
// (belt and suspenders — the prompt forbids them, this normalizes anyway).
function stripDashes(s) {
  return String(s == null ? '' : s)
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/ - /g, ', ');
}

function clampStr(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n) : s;
}

// ── Owner NOTIFY allow-list (inbox_config: notify_allowlist + watches[].match) ──
// A list of watched contacts whose inbound ALWAYS pings the owner, layered ON
// TOP of the leak/lead triage gate (it only ever turns notify ON, never off).
// Built for "I'm waiting on a vendor for pricing, text me when they reply"
// without re-tuning the triage prompt. Each entry is either a bare string or
// { match, note }. `match` is tested as a case-insensitive WHOLE WORD against
// the GHL contact name, so "ben" hits "Ben Carter" but not "Bensen Roofing".
// Returns the matched entry (normalized to an object) or null. Exported so a
// unit test can pin the matching behaviour.
export function matchAllowlist(contactName, allowlist) {
  if (!Array.isArray(allowlist) || !allowlist.length) return null;
  const name = String(contactName == null ? '' : contactName).trim();
  if (!name) return null;
  for (const raw of allowlist) {
    const entry = (raw && typeof raw === 'object') ? raw : { match: raw };
    const token = String(entry.match == null ? '' : entry.match).trim();
    if (!token) continue;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Unicode-aware whole-word match. JS \b is ASCII-only, so it would miss
    // accented names (Eric->Éric, Jose->José) that are common in bilingual NB.
    // Lookarounds on \p{L}/\p{N} (with the u flag) give a real word boundary
    // across Unicode letters/digits, so "ben" still won't hit "Bensen".
    let re;
    try { re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu'); } catch { continue; }
    if (re.test(name)) return { match: token, note: entry.note ? String(entry.note) : '' };
  }
  return null;
}

// Render a conversation thread (oldest first) for the triage prompt.
function renderThread({ contactName, channel, messages }) {
  const head = `Contact: ${contactName || 'Unknown'}\nChannel: ${channel || 'sms'}\nConversation (most recent last):`;
  const lines = (messages || []).map(m => {
    const dir = (m.direction || 'inbound') === 'outbound' ? 'us' : 'them';
    return `[${dir}] ${clampStr(m.body, 1000)}`;
  });
  return `${head}\n${lines.join('\n')}`;
}

// ── Core triage: one Claude call -> normalized triage object. Exported so
// scripts/eval_inbox_triage.mjs can score it against the fixture. ──
export async function triageMessage({ contactName, channel, messages }) {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');

  const rendered = renderThread({ contactName, channel, messages });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let data;
  const reqBody = JSON.stringify({
    model: CLAUDE_MODEL,
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `${rendered}\n\nTriage this conversation. Output only the JSON object.` }],
  });
  try {
    // One synchronous retry on a transient 429 / 5xx (await a short backoff,
    // NOT a fire-and-forget setTimeout) before throwing. Stays inside the 30s
    // AbortController budget shared by both attempts.
    let r;
    let lastErrText = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 1200));
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: reqBody,
      });
      if (r.ok) break;
      lastErrText = await r.text();
      const retryable = r.status === 429 || r.status >= 500;
      if (!retryable || attempt === 1) {
        throw new Error(`Claude ${r.status}: ${lastErrText.slice(0, 200)}`);
      }
    }
    data = await r.json();
  } finally {
    clearTimeout(timer);
  }

  let text = (data?.content?.[0]?.text || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('triage: model did not return parseable JSON');
  }

  // Normalize + harden the model output.
  const notify = parsed.notify === true;
  const needsReply = parsed.needs_reply === true;
  return {
    summary: clampStr(parsed.summary, 500),
    category: clampStr(parsed.category || 'other', 40),
    urgency: clampStr(parsed.urgency || 'normal', 20),
    notify,
    notify_reason: notify ? clampStr(parsed.notify_reason, 160) : '',
    needs_reply: needsReply,
    draft_reply: needsReply ? stripDashes(clampStr(parsed.draft_reply, 4000)) : '',
  };
}

// ── SMS digest to the owner (high-signal: notify=true items only) ──
// ownerContactId is resolved by the handler (config id, or phone->contact, or
// the legacy constant as a last resort). Passed in so the send target is not
// a hardcoded id that can go stale.
async function sendOwnerDigest(items, ownerContactId, notifyEmail) {
  if (!items.length) return { sent: false };
  const result = { sent: false };

  // ── SMS leg (gated by OWNER_SMS_MUTED, unchanged behavior) ──
  if (process.env.OWNER_SMS_MUTED === '1') {
    console.log('[Inbox] SMS muted via OWNER_SMS_MUTED');
    result.smsMuted = true;
  } else {
    const contactId = ownerContactId || MACKENZIE_CONTACT_ID;
    const lines = ['RYUJIN INBOX'];
    lines.push(`${items.length} need${items.length > 1 ? '' : 's'} you now:`);
    for (const it of items.slice(0, DIGEST_MAX_ITEMS)) {
      const who = it.contact_name && it.contact_name !== 'Unknown contact' ? it.contact_name : it.channel;
      const reason = it.notify_reason || it.summary || 'new message';
      lines.push(`- ${stripDashes(reason)} (${who})`);
    }
    if (items.length > DIGEST_MAX_ITEMS) lines.push(`+${items.length - DIGEST_MAX_ITEMS} more`);
    lines.push(`Review: ${INBOX_URL}`);
    try {
      await ghlSendMessage({ contactId, type: 'SMS', message: lines.join('\n') });
      result.sent = true;
      result.contactId = contactId;
    } catch (e) {
      console.error('[Inbox] digest SMS failed:', e.message);
      result.error = e.message;
    }
  }

  // ── Email leg (mirrors the SMS, with the full draft_reply for each item) ──
  // Best-effort and separate from the SMS so a failed Gmail send never blocks
  // the SMS path and vice versa. The email carries more than the SMS: each
  // item's suggested draft_reply, so Mac can act straight from his inbox.
  const to = String(notifyEmail || '').trim() || DEFAULT_NOTIFY_EMAIL;
  try {
    const subject = `Ryujin inbox · ${items.length} need${items.length > 1 ? '' : 's'} you`;
    const blocks = [`${items.length} item${items.length > 1 ? 's' : ''} need your attention.`, ''];
    for (const it of items) {
      const who = it.contact_name && it.contact_name !== 'Unknown contact' ? it.contact_name : it.channel;
      const reason = stripDashes(it.notify_reason || it.summary || 'new message');
      blocks.push(`${who}: ${reason}`);
      if (it.draft_reply && String(it.draft_reply).trim()) {
        blocks.push(`  Suggested reply: ${stripDashes(String(it.draft_reply).trim())}`);
      }
      blocks.push('');
    }
    blocks.push(`Review and approve: ${INBOX_URL}`);
    blocks.push('');
    blocks.push('Ryujin OS');
    const emailRes = await sendEmail({ to, subject, body: blocks.join('\n') });
    result.emailSent = !!emailRes?.ok;
    if (!emailRes?.ok) result.emailError = emailRes?.error || 'unknown';
  } catch (e) {
    console.error('[Inbox] digest email failed:', e.message);
    result.emailError = e.message;
  }

  // Treat the digest as delivered if EITHER channel landed, so notified_at is
  // stamped and the item is not re-pinged forever when SMS is muted but email
  // succeeded.
  if (result.emailSent) result.sent = true;
  return result;
}

// ── Bridge: sub-portal questions -> inbox queue ──
// Subs (Ryan) send topic-routed questions from the sub portal that land only in
// the `messages` table (one row per recipient, shared thread_id). They fire a
// Gmail alert but never reached /inbox.html. Mirror each un-bridged thread into
// inbox_items (source='sub_portal') so the inbox is the single review pane,
// GHL or not. notify stays false: the Gmail alert already pinged. Idempotent via
// the partial unique index on (tenant_id, ref_table, ref_id).
async function bridgeSubPortalMessages({ tenantId, runId }) {
  const out = { bridged: 0, skipped: 0, errors: [] };

  // Recent sub-portal messages. The unique index is the real dedup backstop, so
  // re-scanning already-bridged threads each tick is harmless.
  const { data: msgs, error } = await supabaseAdmin
    .from('messages')
    .select('id, thread_id, from_label, subject, body, created_at, ref_workorder_id, metadata')
    .eq('tenant_id', tenantId)
    .eq('metadata->>source', 'sub_portal')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) { out.errors.push(`messages: ${error.message}`); return out; }
  if (!msgs?.length) return out;

  // One logical inbox item per thread (recipients share a thread_id). Keep the
  // newest row per thread for the display fields.
  const byThread = new Map();
  for (const m of msgs) {
    if (m.thread_id && !byThread.has(m.thread_id)) byThread.set(m.thread_id, m);
  }
  const threadIds = [...byThread.keys()];
  if (!threadIds.length) return out;

  // Skip threads already bridged (fast path; the unique index still guards races).
  const { data: existing } = await supabaseAdmin
    .from('inbox_items')
    .select('ref_id')
    .eq('tenant_id', tenantId)
    .eq('ref_table', 'message_thread')
    .in('ref_id', threadIds);
  const already = new Set((existing || []).map(r => r.ref_id));

  for (const [threadId, m] of byThread) {
    if (already.has(threadId)) { out.skipped++; continue; }
    const row = {
      tenant_id: tenantId,
      source: 'sub_portal',
      ghl_conversation_id: null,
      ghl_contact_id: null,
      contact_name: m.from_label || 'Sub (sub portal)',
      channel: 'sub_portal',
      last_message_body: clampStr(m.body, 4000),
      last_message_at: m.created_at || null,
      last_message_id: m.id || null,
      state_hash: threadId,                       // NOT NULL; the thread is the state key
      summary: clampStr(m.subject || m.body, 300),
      category: 'sub',
      urgency: 'normal',
      notify: false,                              // Gmail already alerted; queue-only
      notify_reason: null,
      needs_reply: true,
      draft_reply: '',
      status: 'needs_review',
      ref_table: 'message_thread',
      ref_id: threadId,
      sub_id: m.metadata?.sub_id || null,
      agent_run_id: runId,
    };
    const { error: insErr } = await supabaseAdmin.from('inbox_items').insert(row);
    if (insErr) {
      if (insErr.code === '23505') { out.skipped++; continue; } // raced another run
      out.errors.push(`insert thread ${threadId}: ${insErr.message}`);
      continue;
    }
    out.bridged++;
  }
  return out;
}

// ── Main scan for one tenant ──
async function runInbox({ tenantId, runId, startTime, allowlist = [], notifyCustomers = false, notifyAllLeads = false, ownerContactId = null, notifyEmail = null, budget = null }) {
  const result = { scanned: 0, triaged: 0, inserted: 0, notify: 0, allowlisted: 0, customerNotify: 0, leadNotify: 0, bridged: 0, skipped: 0, errors: [] };

  let convos = [];
  try {
    convos = await listConversations({ limit: CONVO_LIMIT });
  } catch (e) {
    // Do not return here: the GHL scan failed but the sub-portal bridge below
    // is GHL-independent and should still run this tick.
    result.errors.push(`listConversations: ${e.message}`);
  }
  result.scanned = convos.length;
  if (convos.length >= CONVO_LIMIT) {
    // Page is full: there may be recent inbound beyond it. Surface loudly
    // rather than silently miss a leak/lead at position 100+.
    result.atCap = true;
    console.warn(`[Inbox] conversation scan hit the ${CONVO_LIMIT} cap — add pagination`);
  }

  const cutoff = Date.now() - LOOKBACK_MS;

  for (const c of convos) {
    // Wall-clock guard: leave headroom under the 120s function cap so the
    // agent_runs close + the digest send always run. A killed mid-loop run
    // would otherwise strand a notify item with notified_at=null; the digest
    // is re-derived from the DB below so the next tick still pings it.
    if (startTime && Date.now() - startTime > 95000) { result.timedOut = true; break; }
    try {
      const lastAt = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0;
      if (!lastAt || lastAt < cutoff) { result.skipped++; continue; }

      // Cheap skip: if the conversation's latest message is ours (outbound),
      // there is nothing to reply to. Use the list-level direction to avoid a
      // thread fetch entirely; the post-fetch check below is the backstop for
      // when GHL omits lastMessageDirection.
      if (c.lastMessageDirection === 'outbound') { result.skipped++; continue; }

      // State key from the list fields (no thread fetch needed to dedup).
      const stateHash = createHash('sha1')
        .update(`${c.lastMessageAt}|${c.lastMessageBody || ''}`)
        .digest('hex').slice(0, 16);

      // Idempotency: already triaged this exact conversation state?
      const { data: existing } = await supabaseAdmin
        .from('inbox_items')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('ghl_conversation_id', c.id)
        .eq('state_hash', stateHash)
        .maybeSingle();
      if (existing) { result.skipped++; continue; }

      // Pull the thread; only triage if the latest message is from THEM
      // (an outbound-latest conversation means we already replied).
      let messages = [];
      try {
        messages = await getConversationMessages(c.id, { limit: 15 });
      } catch (e) {
        result.errors.push(`messages ${c.id}: ${e.message}`);
        continue;
      }
      messages.sort((a, b) => new Date(a.dateAdded || 0) - new Date(b.dateAdded || 0));
      const latest = messages[messages.length - 1];
      if (latest && latest.direction === 'outbound') { result.skipped++; continue; }
      if (!messages.length && !c.lastMessageBody) { result.skipped++; continue; }
      if (!messages.length) {
        // Fall back to the single last-message body from the list.
        messages = [{ direction: 'inbound', body: c.lastMessageBody, dateAdded: c.lastMessageAt }];
      }

      // Per-day spend cap (fail-open safety net): once the tenant's daily triage
      // budget is spent, stop calling Claude so a nightly inbound burst can't drain
      // the shared ANTHROPIC key and take down chat/captions (the recurring overnight
      // cap trip). Normal days run far under the cap, so behavior is unchanged. Rows
      // already inserted/deduped are unaffected; un-triaged convos re-evaluate next day.
      if (budget && budget.count >= budget.cap) { result.throttled = true; break; }
      // Triage with Claude.
      const triage = await triageMessage({ contactName: c.contactName, channel: c.channel, messages });
      if (budget) budget.count++;
      result.triaged++;

      // Owner notify overrides, layered ON TOP of the leak/lead triage gate.
      // They only ever turn notify ON, so a real leak/lead notify is never lost.
      //  (1) allow-list: a watched contact (e.g. a vendor we are waiting on for
      //      pricing) ALWAYS pings.
      //  (2) existing/booked customers: when notify_customers is on, any inbound
      //      the model classified category='customer' (a roof we have done OR
      //      booked, per the triage prompt) ALWAYS pings.
      const allowHit = matchAllowlist(c.contactName, allowlist);
      const customerHit = notifyCustomers && triage.category === 'customer';
      //  (3) notify_all_leads: every inbound the model classified category='lead'
      //      ALWAYS pings, not only the present-intent ones the triage gate
      //      already catches. Captures low-intent leads that would otherwise sit
      //      silently in the queue. Default ON for Plus Ultra.
      const leadHit = notifyAllLeads && triage.category === 'lead';
      if (!triage.notify && (allowHit || customerHit || leadHit)) {
        triage.notify = true;
        const reason = allowHit
          ? `watching ${c.contactName}${allowHit.note ? ` (${allowHit.note})` : ''}`
          : customerHit
            ? `existing/booked customer: ${c.contactName}`
            : `new lead: ${c.contactName}`;
        triage.notify_reason = clampStr(triage.notify_reason || reason, 160);
        if (allowHit) result.allowlisted++;
        else if (customerHit) result.customerNotify++;
        else result.leadNotify++;
      }

      // Insert the new state row first (so a later supersede can't orphan it).
      const insertRow = {
        tenant_id: tenantId,
        ghl_conversation_id: c.id,
        ghl_contact_id: c.contactId || null,
        contact_name: c.contactName || null,
        channel: c.channel || 'sms',
        last_message_body: clampStr(c.lastMessageBody, 4000),
        last_message_at: c.lastMessageAt || null,
        last_message_id: latest?.id || null,
        state_hash: stateHash,
        summary: triage.summary,
        category: triage.category,
        urgency: triage.urgency,
        notify: triage.notify,
        notify_reason: triage.notify_reason,
        needs_reply: triage.needs_reply,
        draft_reply: triage.draft_reply,
        status: 'needs_review',
        agent_run_id: runId,
      };
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('inbox_items')
        .insert(insertRow)
        .select('*')
        .single();
      if (insErr) {
        if (insErr.code === '23505') { result.skipped++; continue; } // raced another run
        result.errors.push(`insert ${c.id}: ${insErr.message}`);
        continue;
      }
      result.inserted++;

      // Supersede any older still-pending rows for this conversation so the
      // queue only shows the latest unanswered state. NEVER supersede an
      // un-pinged notify=true row (its SMS digest may not have fired yet) or it
      // would be silently dropped from the digest query. Only collapse the
      // non-alert pending rows. (Review fix 2026-05-29.)
      await supabaseAdmin
        .from('inbox_items')
        .update({ status: 'superseded', updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('ghl_conversation_id', c.id)
        .eq('status', 'needs_review')
        .eq('notify', false)
        .neq('id', inserted.id);

      if (triage.notify) result.notify++;
    } catch (e) {
      result.errors.push(`convo ${c.id}: ${e.message}`);
    }
  }

  // Build the SMS digest from the DB (not just this run's inserts) so a run
  // killed after inserting a notify item but before it could ping self-heals:
  // the next tick re-finds any notify=true row still unpinged. notified_at is
  // the real gate here, backed by idx_inbox_items_notify.
  try {
    const { data: toNotify } = await supabaseAdmin
      .from('inbox_items')
      .select('id, contact_name, channel, notify_reason, summary')
      .eq('tenant_id', tenantId)
      .eq('notify', true)
      .is('notified_at', null)
      .eq('status', 'needs_review')
      // Oldest-first so the longest-waiting leak/lead alerts first under a backlog.
      .order('last_message_at', { ascending: true })
      .limit(20);

    if (toNotify && toNotify.length) {
      const digest = await sendOwnerDigest(toNotify, ownerContactId, notifyEmail);
      if (digest.sent) {
        await supabaseAdmin
          .from('inbox_items')
          .update({ notified_at: new Date().toISOString() })
          .in('id', toNotify.map(r => r.id));
      }
      result.digest = digest;
      result.digested = toNotify.length;
    }
  } catch (e) {
    result.errors.push(`digest: ${e.message}`);
  }

  // Bridge sub-portal questions (e.g. Ryan's topic-routed messages) into the
  // same review queue. GHL-independent; idempotent via the partial unique index
  // on (tenant_id, ref_table, ref_id). notify=false so it never adds a second
  // SMS (the sub portal already fires a Gmail alert on send); this is queue
  // visibility so the inbox is the single pane for "someone needs you".
  try {
    const bridge = await bridgeSubPortalMessages({ tenantId, runId });
    result.bridged = bridge.bridged;
    if (bridge.errors.length) result.errors.push(...bridge.errors);
  } catch (e) {
    result.errors.push(`bridge: ${e.message}`);
  }

  return result;
}

// ── HANDLER (cron + on-demand) ──
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const startTime = Date.now();
  const slug = (req.query.tenant || PLUS_ULTRA_SLUG).toString().trim();

  // Resolve tenant + opt-in flag.
  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('id, slug').eq('slug', slug).maybeSingle();
  if (!tenant) return res.status(404).json({ error: `tenant '${slug}' not found` });

  const { data: settings } = await supabaseAdmin
    .from('tenant_settings').select('inbox_agent_enabled, inbox_config').eq('tenant_id', tenant.id).maybeSingle();
  if (!settings?.inbox_agent_enabled) {
    return res.json({ agent: 'inbox', skipped: 'inbox_agent_enabled is false for this tenant', tenant: slug });
  }

  // Owner-tunable NOTIFY config (tenant_settings.inbox_config).
  const cfg = settings?.inbox_config || {};
  //  - watched contacts that always ping: legacy notify_allowlist + the
  //    unified watches list (lib/inboxWatches.js; entries with a name `match`).
  const allowlist = (Array.isArray(cfg.notify_allowlist) ? cfg.notify_allowlist : [])
    .concat(activeWatches(cfg).filter(w => w.match));
  //  - notify_customers: any existing/booked customer (triage category) pings.
  const notifyCustomers = cfg.notify_customers === true;
  //  - notify_all_leads: every lead-category inbound pings, not just the
  //    present-intent ones. Default ON (true) unless explicitly disabled, so
  //    Plus Ultra catches low-intent leads without a migration to flip a flag.
  const notifyAllLeads = cfg.notify_all_leads !== false;
  //  - notify_email: owner email destination for the digest email leg.
  const notifyEmail = String(cfg.notify_email || '').trim() || DEFAULT_NOTIFY_EMAIL;

  // Per-day Claude-triage budget (fail-open). Prevents a nightly inbound burst from
  // draining the shared ANTHROPIC key (the recurring overnight cap trip that also kills
  // chat + captions). Cap is owner-tunable via inbox_config.triage_daily_cap (default 150,
  // well above a normal day's volume so it only ever catches a runaway).
  const TODAY = new Date().toISOString().slice(0, 10);
  const triageCap = Number.isFinite(cfg.triage_daily_cap) ? cfg.triage_daily_cap : 150;
  const priorCount = (cfg.triage_budget && cfg.triage_budget.date === TODAY) ? (cfg.triage_budget.count || 0) : 0;
  const budget = { count: priorCount, cap: triageCap, throttled: false };
  //  - owner SMS target: explicit contact id, else resolve the owner cell to a
  //    GHL contact id at runtime, else the legacy constant. (The hardcoded id
  //    went stale once -> GHL 400 "Contact not found".)
  let ownerContactId = cfg.owner_sms_contact_id || null;
  if (!ownerContactId && cfg.owner_sms_phone) {
    try {
      const oc = await getContactByPhone(cfg.owner_sms_phone);
      if (oc?.id) ownerContactId = oc.id;
    } catch (e) {
      console.warn('[Inbox] owner contact resolve by phone failed:', e.message);
    }
  }

  // Open an agent_runs row so inbox_items can FK to it; close it at the end.
  const trigger = req.query.manual ? 'manual' : (auth.via === 'cron-secret' ? 'cron_daily' : 'manual');
  let runId = null;
  try {
    const { data: run } = await supabaseAdmin
      .from('agent_runs')
      .insert({ tenant_id: tenant.id, agent_slug: 'inbox', trigger, status: 'running' })
      .select('id').single();
    runId = run?.id || null;
  } catch (e) {
    console.warn('[Inbox] agent_runs open failed (continuing):', e.message);
  }

  // Track whether the run row was already stamped closed on the happy/caught
  // paths so the finally only stamps a STILL-OPEN row. A hard timeout that
  // unwinds past both try and catch cannot then strand a zombie running row.
  let runClosed = false;
  try {
    const result = await runInbox({ tenantId: tenant.id, runId, startTime, allowlist, notifyCustomers, notifyAllLeads, ownerContactId, notifyEmail, budget });

    // Persist the day's triage spend (fail-open: a write failure just under-counts).
    try {
      await supabaseAdmin.from('tenant_settings')
        .update({ inbox_config: { ...cfg, triage_budget: { date: TODAY, count: budget.count } } })
        .eq('tenant_id', tenant.id);
    } catch (e) { console.warn('[Inbox] triage budget writeback failed:', e.message); }

    const durationMs = Date.now() - startTime;
    const status = result.errors.length ? 'partial' : 'success';
    const overrideBits = [
      result.allowlisted ? `${result.allowlisted} allow-listed` : null,
      result.customerNotify ? `${result.customerNotify} customer` : null,
    ].filter(Boolean).join(', ');
    const summary = `Scanned ${result.scanned}, triaged ${result.triaged}, queued ${result.inserted}, bridged ${result.bridged || 0}, notified ${result.notify}${overrideBits ? ` (${overrideBits})` : ''}${result.throttled ? ` [THROTTLED: daily triage cap ${budget.cap} reached]` : ''}`;

    if (runId) {
      await supabaseAdmin.from('agent_runs').update({
        status,
        completed_at: new Date().toISOString(),
        summary,
        output: result,
        emitted_quests: result.inserted,
        duration_ms: durationMs,
        error_message: result.errors.length ? result.errors.slice(0, 5).join(' | ').slice(0, 500) : null,
      }).eq('id', runId);
      runClosed = true;
    }

    // Real backlog for the cockpit: this-tick inserts (insertedThisRun) measure
    // only what THIS run added, but the cockpit needs the full open queue. Count
    // the live needs_review rows (and notify rows still unpinged) so the snapshot
    // reflects the true backlog even when a run inserted nothing. Filters match
    // the queue in api/inbox.js (status=needs_review) and the digest gate.
    let needsReviewCount = result.inserted;
    let notifyPendingCount = result.notify;
    try {
      const [{ count: nrCount }, { count: npCount }] = await Promise.all([
        supabaseAdmin
          .from('inbox_items')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('status', 'needs_review'),
        supabaseAdmin
          .from('inbox_items')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('notify', true)
          .is('notified_at', null),
      ]);
      if (typeof nrCount === 'number') needsReviewCount = nrCount;
      if (typeof npCount === 'number') notifyPendingCount = npCount;
    } catch (e) {
      console.warn('[Inbox] backlog count failed (using this-run counters):', e.message);
    }

    // Surface counts on the snapshot for the cockpit (preserveKeys includes 'inbox').
    try {
      await fetch(`${RYUJIN_BASE}/api/snapshot`, {
        method: 'POST',
        headers: snapshotHeaders(),
        body: JSON.stringify({
          inbox: {
            lastRun: new Date().toISOString(),
            needsReview: needsReviewCount,
            notifyPending: notifyPendingCount,
            insertedThisRun: result.inserted,
            notifiedThisRun: result.notify,
            scanned: result.scanned,
          },
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      console.warn('[Inbox] snapshot push failed:', e.message);
    }

    return res.json({ agent: 'inbox', tenant: slug, status, summary, durationMs, ...result });
  } catch (e) {
    console.error('[Inbox] FAILED:', e.message);
    if (runId) {
      await supabaseAdmin.from('agent_runs').update({
        status: 'error',
        completed_at: new Date().toISOString(),
        error_message: e.message.slice(0, 500),
        duration_ms: Date.now() - startTime,
      }).eq('id', runId);
      runClosed = true;
    }
    return res.status(500).json({ agent: 'inbox', error: e.message });
  } finally {
    // Backstop: if neither the success nor the catch path closed the row (a
    // throw inside the catch, or an unwind we did not anticipate), stamp it
    // partial with completed_at so no run is ever left stuck status=running.
    if (runId && !runClosed) {
      try {
        await supabaseAdmin.from('agent_runs').update({
          status: 'partial',
          completed_at: new Date().toISOString(),
          error_message: 'run did not close cleanly (forced finally close)',
          duration_ms: Date.now() - startTime,
        }).eq('id', runId).eq('status', 'running');
      } catch (e) {
        console.warn('[Inbox] forced run close failed:', e.message);
      }
    }
  }
}
