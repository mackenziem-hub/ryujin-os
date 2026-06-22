// ═══════════════════════════════════════════════════════════════
// GMAIL WATCH FEEDER -- surfaces watched email into the Ryujin agent inbox
// so mail Mac is waiting on can never sit unseen in Gmail again. Born from a
// real miss: a Stripe reserve email (25% of payouts held) sat unread because
// Gmail does not flow through the GHL conversation tab the inbox agent
// watches. (Formerly gmail-stripe.js; generalized 2026-06-11.)
//
// Two kinds of watch:
//   1. KEYWORD-GATED DOMAINS (hardcoded below) -- money-critical senders like
//      Stripe. Of their mail it surfaces ONLY support / review / account-
//      status messages (SURFACE_KEYWORDS) -- reserves, disputes, reviews,
//      appeals, verification, payout problems -- and skips routine receipts
//      so the inbox stays high-signal. EXTEND the list for bank/insurer/CRA.
//   2. ADDRESS WATCHES (tenant_settings.inbox_config.watches[].email, managed
//      from the Watches panel on /inbox.html) -- "ping me when this person
//      replies". EVERY email from the exact address is surfaced, no keyword
//      gate: a vendor's "yes we can get those, 3 weeks" must not be filtered.
//      Exact address only -- a domain watch would drown in marketing blasts
//      (e.g. noreply@qxo.com newsletters vs the rep you are waiting on).
//      Watches expire (see lib/inboxWatches.js).
//   3. CONTENT KEYWORDS (tenant_settings.inbox_config.keywords[]) -- "ping me
//      on any email that mentions this word", regardless of sender. Built for
//      high-signal roofing terms like "leak": a customer reporting a leak is an
//      urgent callback no matter who they are or whether they are on the address
//      list. Matched on subject + snippet with a word-start stem ("leak"
//      catches leak/leaks/leaking/leaked, not "bleak"). Our own outbound (PU
//      domains) is excluded and bulk categories are negated so it stays signal.
//
// It reuses the inbox_items surface: each surfaced email is inserted as a
// channel='email', notify=true row, so it shows on /inbox.html AND gets
// picked up by the inbox agent's SMS digest (channel-agnostic, runs every
// 20 min). The operator API treats email items as review-only, so nothing
// tries to auto-reply from here.
//
// Gated by tenant_settings.inbox_agent_enabled (same opt-in as the inbox
// agent it feeds), so no new flag / migration is required.
//
// Schedule: cron entry in vercel.json (every 20 min). Manual / smoke test
// needs an owner/admin session (Authorization: Bearer <ryujin_token>) or the
// cron secret (Authorization: Bearer $CRON_SECRET):
//   GET /api/feeders/gmail-watch?tenant=plus-ultra
//   optional ?days=N widens the Gmail lookback for backfill/testing (cap 30).
// ═══════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import { supabaseAdmin } from '../../lib/supabase.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { gmailSearch } from '../../lib/google.js';
import { activeWatches } from '../../lib/inboxWatches.js';

const PLUS_ULTRA_SLUG = 'plus-ultra';

// Keyword-gated domain senders (kind 1 above). Matched against the From
// address on a domain boundary, so evilstripe.com cannot ride along.
const KEYWORD_GATED_DOMAINS = ['stripe.com'];

// Of the domain-sender mail, surface ONLY support / review / account-status
// messages. Matched against subject + snippet. This is the high-signal gate:
// reserves, disputes, reviews, appeals, verification, payout problems, account
// restrictions get through; routine receipts and successful-payout notices do
// not. EXTEND this regex to catch more. (Address watches skip this gate.)
const SURFACE_KEYWORDS = /reserve|dispute|chargeback|\breview\b|appeal|verif|account (update|review|information|restrict|on hold|status)|additional (information|details|document)|under review|on hold|withheld|restrict|frozen|freeze|suspend|deactivat|action (required|needed)|request(ed)? (for )?(information|document|details)|further review|payout (failed|paused|delayed|on hold|withheld)|unable to (process|pay)|we need|inquiry|\bcase\b|funds on hold/i;

const DEFAULT_LOOKBACK_DAYS = 2;   // cron runs every 20 min, so 2d is heavy overlap (idempotent re-scan)
const MAX_LOOKBACK_DAYS = 30;      // cap on the ?days= manual override
// Per-QUERY page size. Each watch address gets its own Gmail query (review
// P2 2026-06-11): with one combined query, a heavy Stripe-receipt window
// could fill the single newest-first page and silently starve a watched
// vendor reply off it -- a missed ping, the exact failure this feeder exists
// to prevent.
const MAX_RESULTS = 25;

// Urgency hint only (domain-sender mail already passed the keyword gate and
// pings). Lets the inbox sort the scary ones up. Open text, no schema.
function classifyUrgency(text) {
  const s = (text || '').toLowerCase();
  if (/reserve|dispute|chargeback|review|verification|verify|payout (failed|on hold)|on hold|restricted|frozen|suspend|action required|deactivat|cannot (process|pay)/.test(s)) {
    return 'high';
  }
  return 'normal';
}

function safeIso(dateStr) {
  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

// "Azeem Faizal <azeem.faizal@qxo.com>" -> { name, email } (email lowercased).
function parseFrom(from) {
  const s = String(from || '');
  const m = s.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: s.trim().toLowerCase() };
}

function onWatchedDomain(email) {
  return KEYWORD_GATED_DOMAINS.some(d => email.endsWith('@' + d) || email.endsWith('.' + d));
}

// Our own outbound -- never ping on a leak we mention in a reply, or on our
// own internal notifications (warranty-claim relays, form auto-mails, etc.).
const SELF_DOMAINS = ['plusultraroofing.com'];
const SELF_ADDRESSES = ['plusultraroofing@gmail.com', 'plusultraroofinginfo@gmail.com'];
// Catch-all for any Plus Ultra Gmail alias (plusultraroofing@, ...info@, ...)
const SELF_GMAIL_RE = /^plusultraroofing[^@]*@gmail\.com$/;
function isSelf(email) {
  return SELF_ADDRESSES.includes(email)
    || SELF_GMAIL_RE.test(email)
    || SELF_DOMAINS.some(d => email.endsWith('@' + d));
}

export async function runGmailWatchFeeder({ tenantSlug = PLUS_ULTRA_SLUG, lookbackDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  const report = {
    feeder: 'gmail-watch', tenant: tenantSlug, lookbackDays,
    watched_addresses: 0, scanned: 0, inserted: 0, skipped: 0, errors: [],
  };

  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('id').eq('slug', tenantSlug).maybeSingle();
  if (!tenant) { report.errors.push(`tenant ${tenantSlug} not found`); return report; }

  // Opt-in: reuse the inbox feature gate (this feeder feeds that inbox).
  const { data: settings } = await supabaseAdmin
    .from('tenant_settings').select('inbox_agent_enabled, inbox_config').eq('tenant_id', tenant.id).maybeSingle();
  if (!settings?.inbox_agent_enabled) {
    report.skipped_disabled = true;
    return report;
  }

  // Owner-managed address watches (exact email, no keyword gate, expirable).
  const addressWatches = activeWatches(settings.inbox_config)
    .filter(w => w.email)
    .map(w => ({ ...w, email: String(w.email).toLowerCase().trim() }));
  report.watched_addresses = addressWatches.length;

  // Owner-managed content keywords (kind 3): surface ANY inbound mentioning
  // these words, from any sender (e.g. "leak"). Stored as plain strings.
  const keywords = (Array.isArray(settings.inbox_config?.keywords)
    ? settings.inbox_config.keywords : [])
    .map(k => String(k || '').trim().toLowerCase()).filter(Boolean);
  report.keywords = keywords.length;
  // Word-start stem match so "leak" catches leak/leaks/leaking/leaked, not "bleak".
  const keywordRe = keywords.length
    ? new RegExp(`\\b(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\w*`, 'i')
    : null;

  // One query for the gated domains + one per watch address, so senders never
  // compete for the same result page. A failed query logs and moves on rather
  // than killing the whole run.
  const queries = [];
  if (KEYWORD_GATED_DOMAINS.length) {
    queries.push(`(${KEYWORD_GATED_DOMAINS.map(s => `from:${s}`).join(' OR ')}) newer_than:${lookbackDays}d`);
  }
  for (const w of addressWatches) {
    queries.push(`from:${w.email} newer_than:${lookbackDays}d`);
  }
  // Content-keyword lane: one combined query across all senders, excluding our
  // own outbound and bulk categories so it stays high-signal.
  if (keywords.length) {
    const kwOr = keywords.map(k => `"${k}"`).join(' OR ');
    const selfNeg = [...SELF_DOMAINS, ...SELF_ADDRESSES].map(s => `-from:${s}`).join(' ');
    // -in:sent kills our own outbound regardless of which alias sent it.
    // promotions/social negated (clear bulk); updates is NOT negated -- a
    // web-form / portal "roof is leaking" notice often lands there and a leak
    // must never be filtered out.
    queries.push(`(${kwOr}) ${selfNeg} -in:sent -category:promotions -category:social newer_than:${lookbackDays}d`);
  }

  const messages = [];
  const seenIds = new Set();
  for (const q of queries) {
    try {
      const batch = await gmailSearch(q, MAX_RESULTS);
      for (const m of batch) {
        if (m.id && seenIds.has(m.id)) continue;   // same message can match two queries
        if (m.id) seenIds.add(m.id);
        messages.push(m);
      }
    } catch (e) {
      report.errors.push(`gmailSearch(${q}): ${e.message}`);
    }
  }
  report.scanned = messages.length;

  for (const m of messages) {
    try {
      // Route the message: exact address watch first, else keyword-gated
      // domain. Gmail's from: operator can match loosely, so both checks
      // re-verify against the parsed From header.
      const { name: fromName, email: fromEmail } = parseFrom(m.from);
      const watchHit = addressWatches.find(w => w.email === fromEmail);
      let kind = null;
      if (watchHit) {
        kind = 'watch';
      } else if (onWatchedDomain(fromEmail)) {
        // Keyword gate: only support / review / account-status mail gets
        // surfaced (skips routine receipts + successful-payout notices).
        if (!SURFACE_KEYWORDS.test(`${m.subject || ''} ${m.snippet || ''}`)) { report.skipped++; continue; }
        kind = 'domain';
      } else if (keywordRe && !isSelf(fromEmail) && keywordRe.test(`${m.subject || ''} ${m.snippet || ''}`)) {
        // Re-verify against subject + snippet (Gmail matched full body; snippet
        // is a body preview, so a keyword buried deep in a long body can be
        // missed here -- accepted to avoid mis-attributing non-keyword mail).
        kind = 'keyword';
      } else {
        report.skipped++; continue;
      }

      const convoKey = `gmail:${m.threadId}`;
      // Per-message state hash (the Gmail message id is already unique; hash to
      // keep it short and consistent with the inbox agent's state_hash style).
      const stateHash = createHash('sha1').update(m.id).digest('hex').slice(0, 16);

      // Idempotent: skip if this exact message was already surfaced.
      const { data: existing } = await supabaseAdmin
        .from('inbox_items').select('id')
        .eq('tenant_id', tenant.id)
        .eq('ghl_conversation_id', convoKey)
        .eq('state_hash', stateHash)
        .maybeSingle();
      if (existing) { report.skipped++; continue; }

      const subject = (m.subject || '(no subject)').trim();
      // A keyword hit (e.g. "leak") is an urgent callback by definition.
      const urgency = kind === 'keyword' ? 'high' : classifyUrgency(`${subject} ${m.snippet || ''}`);
      const kwMatch = kind === 'keyword'
        ? (keywordRe.exec(`${subject} ${m.snippet || ''}`)?.[0] || keywords[0])
        : null;
      const contactName = kind === 'watch'
        ? (fromName || watchHit.match || watchHit.email)
        : kind === 'keyword'
          ? (fromName || fromEmail)
          : (fromName || 'Stripe');
      const notifyReason = kind === 'watch'
        ? `watching ${contactName}${watchHit.note ? ` (${watchHit.note})` : ''}`
        : kind === 'keyword'
          ? `"${kwMatch}" mention from ${contactName}: ${subject}`
          : `${contactName}: ${subject}`;

      const insertRow = {
        tenant_id: tenant.id,
        ghl_conversation_id: convoKey,
        ghl_contact_id: null,
        contact_name: contactName,
        channel: 'email',
        last_message_body: `${subject}\n\n${(m.snippet || '').slice(0, 1000)}`.slice(0, 4000),
        last_message_at: safeIso(m.date),
        last_message_id: m.id,
        state_hash: stateHash,
        summary: `${kind === 'watch' ? 'Watched email' : kind === 'keyword' ? 'Keyword email' : 'Stripe email'} from ${contactName}: ${subject}`.slice(0, 500),
        category: kind === 'domain' ? 'finance' : 'other',
        urgency,
        notify: true,                         // surfaced = watched -> ping
        notify_reason: notifyReason.slice(0, 160),
        needs_reply: false,                   // email is review-only; Mac replies from Gmail
        draft_reply: '',
        status: 'needs_review',
        agent_run_id: null,
      };

      const { error: insErr } = await supabaseAdmin.from('inbox_items').insert(insertRow);
      if (insErr) {
        if (insErr.code === '23505') { report.skipped++; continue; } // raced another run
        report.errors.push(`insert ${m.id}: ${insErr.message}`);
        continue;
      }
      report.inserted++;
    } catch (e) {
      report.errors.push(`msg ${m.id}: ${e.message}`);
    }
  }

  return report;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const tenantSlug = (req.query?.tenant || req.headers['x-tenant-id'] || PLUS_ULTRA_SLUG).toString();
  const reqDays = parseInt(req.query?.days, 10);
  const lookbackDays = Number.isFinite(reqDays) && reqDays > 0
    ? Math.min(reqDays, MAX_LOOKBACK_DAYS)
    : DEFAULT_LOOKBACK_DAYS;

  try {
    const report = await runGmailWatchFeeder({ tenantSlug, lookbackDays });
    return res.json({ feeder: 'gmail-watch', invocation: req.method === 'GET' ? 'on-demand' : 'cron', data: report });
  } catch (e) {
    console.error('[GmailWatchFeeder] FAILED:', e.message);
    return res.status(500).json({ feeder: 'gmail-watch', error: e.message });
  }
}
