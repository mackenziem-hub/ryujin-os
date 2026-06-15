// ═══════════════════════════════════════════════════════════════
// RYUJIN WATCHDOG — Passive email & system monitor
// Runs every 2 hours via Vercel cron
// Checks Gmail for priority emails, sends SMS alert if critical
// Stores last-alerted state in Vercel Blob to prevent double-pings
// ═══════════════════════════════════════════════════════════════

import { gmailSearch, gmailReadMessage } from '../../lib/google.js';
import { put, list } from '@vercel/blob';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_TOKEN = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
const GHL_VERSION = '2021-07-28';
const MACKENZIE_CONTACT_ID = '02IhxZfSwZZAZ2fooVGu';

const WATCHDOG_BLOB_KEY = 'ryujin-watchdog-state.json';
const LEGACY_WATCHDOG_BLOB_KEY = 'shenron-watchdog-state.json';
let storeBase = null;

// ═══════════════════════════════════════════
// STATE PERSISTENCE (Vercel Blob)
// ═══════════════════════════════════════════

async function getState() {
  try {
    let { blobs } = await list({ prefix: WATCHDOG_BLOB_KEY, limit: 1 });
    if (blobs.length === 0) {
      ({ blobs } = await list({ prefix: LEGACY_WATCHDOG_BLOB_KEY, limit: 1 }));
    }
    if (blobs.length === 0) return { alertedIds: [], lastRun: null };
    if (!storeBase) {
      const match = blobs[0].url.match(/^(https:\/\/[^/]+)/);
      if (match) storeBase = match[1];
    }
    const resp = await fetch(blobs[0].url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) return { alertedIds: [], lastRun: null };
    return await resp.json();
  } catch {
    return { alertedIds: [], lastRun: null };
  }
}

async function saveState(state) {
  const blob = await put(WATCHDOG_BLOB_KEY, JSON.stringify(state), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json'
  });
  return blob;
}

// ═══════════════════════════════════════════
// SMS ALERT (direct — no approval gate)
// ═══════════════════════════════════════════

async function sendWatchdogSMS(message) {
  if (process.env.OWNER_SMS_MUTED === '1') { console.log('[Watchdog] SMS muted via OWNER_SMS_MUTED'); return null; }
  if (!GHL_TOKEN) {
    console.error('[Watchdog] No GHL_TOKEN — cannot send SMS');
    return null;
  }

  const resp = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GHL_TOKEN}`,
      'Version': GHL_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ type: 'SMS', contactId: MACKENZIE_CONTACT_ID, message })
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`[Watchdog] SMS failed (${resp.status}): ${err}`);
    return null;
  }
  return resp.json();
}

// ═══════════════════════════════════════════
// EMAIL CLASSIFICATION
// ═══════════════════════════════════════════

// ── TIER 1: IMMEDIATE SMS (customers, leads, suppliers, active jobs) ──
// Any match here = high priority, triggers SMS
const TIER1_SENDERS = [
  // Suppliers
  'qxo', 'beacon', 'castle', 'bp canada', 'kent building', 'rona', 'home depot',
  'abc supply', 'duravent', 'gentek', 'kaycan', 'royal building',
  // Insurance / adjusters
  'insurance', 'adjuster', 'claim', 'intact', 'aviva', 'desjardins', 'wawanesa',
  'co-operators', 'allstate', 'td insurance',
  // Team
  'darcy', 'diego', 'pavignette',
  // CRM / lead sources
  'leadconnector', 'highlevel', 'gohighlevel',
  // Watched customers (immediate ping on reply, by owner request)
  'cohni.omega@gmail.com', // Concepcion Omega, 200 Lonsdale (est #38), awaiting shingle-color confirmation
];

const TIER1_SUBJECTS = [
  // Customer / lead inquiries
  'roof', 'estimate', 'quote', 'inspection', 'leak', 'shingle', 'gutter',
  'soffit', 'fascia', 'siding', 'flashing', 'repair',
  'new lead', 'estimate request', 'quote request', 'booking', 'appointment',
  // Active job keywords
  'job site', 'crew', 'material', 'delivery', 'schedule', 'permit',
  // Urgent business
  'urgent', 'asap', 'emergency', 'action required', 'action needed',
  'time sensitive', 'deadline', 'reply needed', 'response needed',
  // Insurance / claims
  'claim number', 'adjuster', 'scope of loss',
];

// ── TIER 2: DAILY DOCKET (payment issues, subscriptions, system alerts) ──
// Logged for briefing but no SMS unless combined with Tier 1 signal
const TIER2_SENDERS = [
  'stripe', 'paypal', 'square', 'payment', 'invoice',
  'google payments', 'ads-noreply@google', 'bank', 'td bank', 'rbc',
  'facebookmail', 'facebook.com', 'meta.com', 'fb.com',
  'vercel', 'replit', 'anthropic', 'openai', 'supabase',
  'opusclip', 'opus.pro', 'canva', 'automator',
];

const TIER2_SUBJECTS = [
  'payment failed', 'payment declined', 'charge failed', 'card declined',
  'past due', 'overdue', 'final notice', 'suspension', 'ads paused',
  'cancelled', 'canceled', 'expiring', 'expires today', 'expires tomorrow',
  'billing', 'subscription', 'renewal', 'payment method',
  'security alert', 'suspicious', 'unauthorized', 'breach',
  'violation', 'complaint',
];

// ── TIER 0: SPAM / SOLICITATION BLACKLIST ──
// Force-ignore cold emails, vendor pitches, and scams before Gmail labels can promote them
const SPAM_SENDERS = [
  // Working capital / MCA / financing solicitations
  'statusfcgroup', 'fero capital', 'ondeck', 'kabbage', 'bluevine', 'fundbox',
  'credibly', 'rapid finance', 'forward financing', 'clearco', 'capify',
  // SEO / marketing cold outreach
  'aimestimation', 'hillestimation', 'estimation llc', 'takeoff', 'seo service',
  // Generic spam patterns
  'noreply@', 'no-reply@', 'donotreply',
];

const SPAM_SUBJECTS = [
  // Financing / capital solicitations
  'working capital', 'business loan', 'business funding', 'fast capital',
  'merchant cash', 'cash advance', 'line of credit', 'approved within',
  'pre-approved', 'revenue-based', 'revenue based',
  // SEO / marketing spam
  'seo service', 'rank higher', 'search results', 'price jobs competitively',
  'boost your', 'grow your business', 'digital marketing',
  // Estimation service pitches
  'estimation services', 'material takeoff', 'quantity take-off', 'cost estimation',
  // Phishing patterns
  'can i send', 'may i send', 'send you info', 'send the screenshot',
];

function classifyEmail(email) {
  const from = (email.from || '').toLowerCase();
  const subject = (email.subject || '').toLowerCase();
  const labels = email.labels || [];

  const reasons = [];
  let tier = 0; // 0 = ignore, 1 = SMS now, 2 = daily docket

  // ── Tier 0: spam/solicitation blacklist (checked FIRST, overrides everything) ──
  for (const pattern of SPAM_SENDERS) {
    if (from.includes(pattern)) {
      return { shouldAlert: false, tier: 0, highPriority: false, reasons: [`spam-sender:${pattern}`] };
    }
  }
  for (const keyword of SPAM_SUBJECTS) {
    if (subject.includes(keyword)) {
      return { shouldAlert: false, tier: 0, highPriority: false, reasons: [`spam-subject:${keyword}`] };
    }
  }

  // ── Tier 1 checks (customers, leads, suppliers, jobs) ──
  for (const pattern of TIER1_SENDERS) {
    if (from.includes(pattern)) {
      reasons.push(`t1-sender:${pattern}`);
      tier = 1;
      break;
    }
  }
  for (const keyword of TIER1_SUBJECTS) {
    if (subject.includes(keyword)) {
      reasons.push(`t1-subject:${keyword}`);
      tier = 1;
      break;
    }
  }

  // ── Tier 2 checks (payments, subscriptions, system stuff) ──
  if (tier === 0) {
    for (const pattern of TIER2_SENDERS) {
      if (from.includes(pattern)) {
        reasons.push(`t2-sender:${pattern}`);
        tier = 2;
        break;
      }
    }
    for (const keyword of TIER2_SUBJECTS) {
      if (subject.includes(keyword)) {
        reasons.push(`t2-subject:${keyword}`);
        tier = 2;
        break;
      }
    }
  }

  // Gmail starred = bump tier 2 → tier 1
  if (labels.includes('STARRED')) {
    reasons.push('starred');
    if (tier === 2) tier = 1;
    if (tier === 0) tier = 2;
  }

  // Gmail IMPORTANT alone = tier 2 at most (too many false positives)
  if (tier === 0 && labels.includes('IMPORTANT') && labels.includes('CATEGORY_PERSONAL')) {
    reasons.push('gmail-important+personal');
    tier = 2;
  }

  return {
    shouldAlert: tier > 0,
    tier,
    highPriority: tier === 1,
    reasons
  };
}

// ═══════════════════════════════════════════
// MAIN WATCHDOG LOGIC
// ═══════════════════════════════════════════

export default async function handler(req, res) {
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const startTime = Date.now();
  console.log('[Watchdog] Starting scan...');

  const state = await getState();
  const alerts = [];
  const newAlertedIds = [...(state.alertedIds || [])];

  try {
    // Search for unread emails from the last 6 hours (with 20s timeout).
    // Internal timeout MUST stay below the function maxDuration (30s in vercel.json)
    // so the catch-block recovery path (WATCHDOG CRASHED SMS + saveState) has
    // headroom to run before Vercel kills the invocation. 20s leaves ~10s.
    const unread = await Promise.race([
      gmailSearch('is:unread newer_than:6h', 20),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Gmail search timed out after 20s')), 20000))
    ]);

    for (const email of unread) {
      // Skip already alerted
      if (newAlertedIds.includes(email.id)) continue;

      const classification = classifyEmail(email);
      if (classification.shouldAlert) {
        alerts.push({
          id: email.id,
          from: email.from,
          subject: email.subject,
          date: email.date,
          snippet: email.snippet,
          ...classification
        });
        newAlertedIds.push(email.id);
      }
    }

    // Keep only last 200 alerted IDs (prevent blob from growing forever)
    if (newAlertedIds.length > 200) {
      newAlertedIds.splice(0, newAlertedIds.length - 200);
    }

    // GHL conversation triage moved to the dedicated inbox agent
    // (api/agents/inbox.js, migration 078). The watchdog used to poll
    // /api/ghl?mode=conversations and SMS-alert on ANY unread DM, which
    // over-notified. The inbox agent now reads each conversation, triages
    // it, and only fires an SMS for a genuine active leak or active lead;
    // everything else is queued on /inbox.html. Keeping the block here too
    // would double-ping the owner, so the watchdog is now Gmail-only.

    // Tier 1 = SMS now, Tier 2 = daily docket only
    const tier1 = alerts.filter(a => a.tier === 1);
    const tier2 = alerts.filter(a => a.tier === 2);

    let smsResult = null;
    if (tier1.length > 0) {
      const lines = [`🐉 RYUJIN WATCHDOG\n`];
      lines.push(`📬 ${tier1.length} email${tier1.length > 1 ? 's' : ''} need your attention:\n`);

      for (const alert of tier1.slice(0, 5)) {
        const fromName = alert.from.replace(/<[^>]+>/, '').trim();
        lines.push(`• ${fromName}`);
        lines.push(`  ${alert.subject}`);
      }

      if (tier1.length > 5) {
        lines.push(`\n+ ${tier1.length - 5} more`);
      }

      if (tier2.length > 0) {
        lines.push(`\n📋 ${tier2.length} lower-priority item${tier2.length > 1 ? 's' : ''} on today's docket`);
      }

      smsResult = await sendWatchdogSMS(lines.join('\n'));
    }

    // Always push to snapshot so heartbeat/briefing can see we're alive.
    // Previously this only ran when tier2.length > 0, which made watchdog
    // appear "down" whenever there were no low-priority emails for hours.
    try {
      await fetch('https://ryujin-os.vercel.app/api/snapshot', {
        method: 'POST',
        headers: snapshotHeaders(),
        body: JSON.stringify({
          watchdog: {
            lastRun: new Date().toISOString(),
            docketItems: tier2.map(a => ({
              from: a.from, subject: a.subject, reasons: a.reasons
            })),
            tier1Count: tier1.length,
            tier2Count: tier2.length
          }
        })
      });
    } catch (e) {
      console.error(`[Watchdog] Snapshot push failed: ${e.message}`);
    }

    // Save state
    await saveState({
      alertedIds: newAlertedIds,
      lastRun: new Date().toISOString(),
      lastAlertCount: alerts.length,
      lastSMSSent: smsResult ? new Date().toISOString() : state.lastSMSSent || null
    });

    const duration = Date.now() - startTime;
    console.log(`[Watchdog] Complete in ${duration}ms — ${unread.length} scanned, T1:${tier1.length} T2:${tier2.length}`);

    return res.json({
      status: 'ok',
      ranAt: new Date().toISOString(),
      duration: `${duration}ms`,
      emailsScanned: unread.length,
      tier1_sms: tier1.length,
      tier2_docket: tier2.length,
      smsSent: !!smsResult,
      alerts: alerts.map(a => ({
        from: a.from,
        subject: a.subject,
        tier: a.tier,
        reasons: a.reasons
      }))
    });

  } catch (e) {
    console.error(`[Watchdog] Error: ${e.message}`);

    // Send fallback SMS so Mackenzie knows watchdog is down
    try {
      await sendWatchdogSMS(`🚨 WATCHDOG CRASHED: ${e.message}\nGmail scan failed — check Vercel logs.`);
    } catch (smsErr) { console.error(`[Watchdog] Crash SMS also failed: ${smsErr.message}`); }

    // Save state even on error so we don't lose alertedIds
    await saveState({
      ...state,
      lastRun: new Date().toISOString(),
      lastError: e.message
    });

    return res.status(500).json({ error: e.message, duration: `${Date.now() - startTime}ms` });
  }
}
