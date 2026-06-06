// ═══════════════════════════════════════════════════════════════
// GMAIL STRIPE FEEDER -- surfaces Stripe (and any other watched-sender)
// emails into the Ryujin agent inbox so money-critical mail can never sit
// unseen in Gmail again. Born from a real miss: a Stripe reserve email
// (25% of payouts held) sat unread because Gmail does not flow through the
// GHL conversation tab the inbox agent watches.
//
// It reuses the inbox_items surface: each matching email is inserted as a
// channel='email', notify=true row, so it shows on /inbox.html AND gets
// picked up by the inbox agent's SMS digest (channel-agnostic, runs every
// 20 min). The operator API treats email items as review-only, so nothing
// tries to auto-reply to Stripe.
//
// Gated by tenant_settings.inbox_agent_enabled (same opt-in as the inbox
// agent it feeds), so no new flag / migration is required.
//
// Schedule: cron entry in vercel.json (every 20 min). Manual / smoke test
// needs an owner/admin session (Authorization: Bearer <ryujin_token>) or the
// cron secret (Authorization: Bearer $CRON_SECRET):
//   GET /api/feeders/gmail-stripe?tenant=plus-ultra
//   optional ?days=N widens the Gmail lookback for backfill/testing (cap 30).
// ═══════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import { supabaseAdmin } from '../../lib/supabase.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { gmailSearch } from '../../lib/google.js';

const PLUS_ULTRA_SLUG = 'plus-ultra';

// Senders to surface into the inbox. Matched against the email From header.
// EXTEND THIS LIST to watch more money-critical senders later (bank, insurer,
// CRA, etc.) -- one line each, no migration needed. Gmail `from:` matches the
// domain (and its subdomains), and the From-header check below is the backstop.
const WATCHED_SENDERS = ['stripe.com'];

const DEFAULT_LOOKBACK_DAYS = 2;   // cron runs every 20 min, so 2d is heavy overlap (idempotent re-scan)
const MAX_LOOKBACK_DAYS = 30;      // cap on the ?days= manual override
const MAX_RESULTS = 25;

// Urgency hint only (NOT a notify gate -- per config, every watched email
// notifies). Lets the inbox sort the scary ones up. Open text, no schema.
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

export async function runGmailStripeFeeder({ tenantSlug = PLUS_ULTRA_SLUG, lookbackDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  const report = {
    feeder: 'gmail-stripe', tenant: tenantSlug, lookbackDays,
    scanned: 0, inserted: 0, skipped: 0, errors: [],
  };

  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('id').eq('slug', tenantSlug).maybeSingle();
  if (!tenant) { report.errors.push(`tenant ${tenantSlug} not found`); return report; }

  // Opt-in: reuse the inbox feature gate (this feeder feeds that inbox).
  const { data: settings } = await supabaseAdmin
    .from('tenant_settings').select('inbox_agent_enabled').eq('tenant_id', tenant.id).maybeSingle();
  if (!settings?.inbox_agent_enabled) {
    report.skipped_disabled = true;
    return report;
  }

  const fromClause = WATCHED_SENDERS.map(s => `from:${s}`).join(' OR ');
  const query = `(${fromClause}) newer_than:${lookbackDays}d`;

  let messages = [];
  try {
    messages = await gmailSearch(query, MAX_RESULTS);
  } catch (e) {
    report.errors.push(`gmailSearch: ${e.message}`);
    return report;
  }
  report.scanned = messages.length;

  for (const m of messages) {
    try {
      // Backstop: confirm the From actually contains a watched sender, since
      // Gmail's from: operator can match loosely.
      const from = (m.from || '').toLowerCase();
      if (!WATCHED_SENDERS.some(s => from.includes(s))) { report.skipped++; continue; }

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
      const urgency = classifyUrgency(`${subject} ${m.snippet || ''}`);

      const insertRow = {
        tenant_id: tenant.id,
        ghl_conversation_id: convoKey,
        ghl_contact_id: null,
        contact_name: 'Stripe',
        channel: 'email',
        last_message_body: `${subject}\n\n${(m.snippet || '').slice(0, 1000)}`.slice(0, 4000),
        last_message_at: safeIso(m.date),
        last_message_id: m.id,
        state_hash: stateHash,
        summary: `Stripe email: ${subject}`.slice(0, 500),
        category: 'finance',
        urgency,
        notify: true,                         // per config: every Stripe email pings
        notify_reason: `Stripe: ${subject}`.slice(0, 160),
        needs_reply: false,                   // informational; no auto-reply to Stripe
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
    const report = await runGmailStripeFeeder({ tenantSlug, lookbackDays });
    return res.json({ feeder: 'gmail-stripe', invocation: req.method === 'GET' ? 'on-demand' : 'cron', data: report });
  } catch (e) {
    console.error('[GmailStripeFeeder] FAILED:', e.message);
    return res.status(500).json({ feeder: 'gmail-stripe', error: e.message });
  }
}
