// ═══════════════════════════════════════════════════════════════
// HEARTBEAT — Dead-man's switch for the morning briefing
// Runs at 9:00 AM AT (12:00 UTC) — 2 hours after morning briefing cron
// Verifies the morning briefing actually fired AND sent its email
// If anything is wrong, sends a raw fallback email to Mackenzie
// ═══════════════════════════════════════════════════════════════

import { gmailSend } from '../../lib/google.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';
import { sendFallbackSMS } from './_shared.js';
import { logAgentRun } from '../../lib/agents/logAgentRun.js';
import { supabaseAdmin } from '../../lib/supabase.js';

const BASE_URL = 'https://ryujin-os.vercel.app';
// White-label: no hardcoded recipient fallback (set in Vercel env for the live
// deployment). Missing env -> skip-and-log; callers already tolerate ok:false
// and the SMS dead-man fallback still fires for true emergencies.
const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL || '').trim();

// How fresh the morning briefing must be (hours).
// Cron fires at 9 AM AT, briefing runs at 7 AM AT, so 3 hours is the cutoff.
const BRIEFING_MAX_AGE_HOURS = 3;

async function sendFallbackAlert(subject, body) {
  if (!NOTIFY_EMAIL) {
    console.error('[Heartbeat] NOTIFY_EMAIL not set; skipping email fallback');
    return { ok: false, error: 'NOTIFY_EMAIL not set' };
  }
  try {
    await gmailSend(NOTIFY_EMAIL, `[Ryujin Heartbeat] ${subject}`, body);
    return { ok: true };
  } catch (e) {
    console.error(`[Heartbeat] Email fallback failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

export default async function handler(req, res) {
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const startTime = Date.now();
  const checks = [];
  const failures = [];

  // Tenant for the agent_runs heartbeat row (migration_106 allows 'heartbeat').
  let tenantId = null;
  try { const { data: t } = await supabaseAdmin.from('tenants').select('id').eq('slug', 'plus-ultra').single(); tenantId = t?.id || null; } catch { /* best-effort */ }

  // ── 1. Fetch snapshot ──
  let snapshot;
  try {
    const r = await fetch(`${BASE_URL}/api/snapshot?_t=${Date.now()}`, { cache: 'no-store', headers: snapshotHeaders() });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    snapshot = await r.json();
  } catch (e) {
    // Snapshot itself is dead. The whole system may be down with it, so SMS
    // leads (email infra may be down too) and email follows only if configured.
    await sendFallbackSMS(`[Ryujin Heartbeat] Snapshot API unreachable: ${e.message}. Whole system may be down.`);
    await sendFallbackAlert(`Heartbeat fail — snapshot unreachable`, `Snapshot API unreachable: ${e.message}\n\nWhole system may be down. Check Vercel logs.`);
    await logAgentRun({ tenantId, agentSlug: 'heartbeat', trigger: 'cron_daily', status: 'error', error: `snapshot dead: ${e.message}`, startedAt: startTime });
    return res.status(500).json({ status: 'snapshot_dead', error: e.message });
  }

  // ── 2. Check morning briefing freshness ──
  const briefingMorning = snapshot?.sections?.briefing_morning;
  if (!briefingMorning) {
    failures.push('Morning briefing has never run (no briefing_morning in snapshot).');
  } else {
    const ts = new Date(briefingMorning.timestamp).getTime();
    const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
    checks.push({ check: 'briefing_age_hours', value: ageHours.toFixed(2) });
    if (ageHours > BRIEFING_MAX_AGE_HOURS) {
      failures.push(`Morning briefing is ${ageHours.toFixed(1)}h old (max ${BRIEFING_MAX_AGE_HOURS}h). Cron may have skipped or function crashed.`);
    }
    // Email dispatch check (briefing.js writes emailSent into snapshot).
    // Skip when the owner has intentionally muted the briefing email
    // (OWNER_BRIEFING_EMAIL_MUTED, directive 2026-05-12). Without this guard the
    // heartbeat alerted every day on a by-design emailSent=false and fired a
    // daily fallback SMS. Only flag a genuine send failure, not an intentional mute.
    if (briefingMorning.emailSent === false && !briefingMorning.emailMuted) {
      failures.push(`Morning briefing ran but email did NOT send. See briefing errors.`);
    }
    if (briefingMorning.errors && briefingMorning.errors.length > 0) {
      failures.push(`Morning briefing reported errors: ${briefingMorning.errors.slice(0, 3).join(' | ')}`);
    }
  }

  // ── 3. Check watchdog freshness (if it has ever run) ──
  const watchdog = snapshot?.sections?.watchdog;
  if (watchdog?.lastRun) {
    const wdAge = (Date.now() - new Date(watchdog.lastRun).getTime()) / (1000 * 60 * 60);
    checks.push({ check: 'watchdog_age_hours', value: wdAge.toFixed(2) });
    if (wdAge > 4) {
      failures.push(`Watchdog hasn't run in ${wdAge.toFixed(1)}h (cron is every 2h). May be down.`);
    }
  }
  // NOTE: watchdog only writes to snapshot when there are tier2 emails, so missing
  // section ≠ broken. We don't alert on absence — only on stale.

  // ── 4. If anything failed, fire the fallback chain: SMS first (the proven
  // GHL path, same transport /api/notify uses), then email only if
  // NOTIFY_EMAIL is configured. The white-label silent skip on email stays
  // correct; the report below names the gap so it is visible, never silent.
  let smsResult = null;
  let emailResult = null;
  if (failures.length > 0) {
    const headline = failures[0].slice(0, 140);
    smsResult = await sendFallbackSMS(`[Ryujin Heartbeat] ${failures.length} failure(s): ${headline}${failures.length > 1 ? ' (+more)' : ''}`);

    const lines = ['Morning briefing pipeline issue:\n'];
    for (const f of failures.slice(0, 4)) {
      lines.push(`• ${f}`);
    }
    lines.push('\nCheck Vercel logs at https://vercel.com/mackenziem-8357s-projects/ryujin-os');
    emailResult = await sendFallbackAlert(`${failures.length} briefing failures detected`, lines.join('\n'));
  }

  // Which transports actually fired. sms.configured false = GHL token missing
  // or OWNER_SMS_MUTED (sendFallbackSMS returns null). email.configured false
  // = NOTIFY_EMAIL unset.
  const transports = {
    sms: {
      configured: failures.length === 0 ? true : smsResult !== null,
      sent: !!(smsResult && smsResult.ok),
      error: (smsResult && smsResult.error) || null
    },
    email: {
      configured: !!NOTIFY_EMAIL,
      sent: !!(emailResult && emailResult.ok),
      error: (NOTIFY_EMAIL && emailResult && emailResult.error) || null
    }
  };
  const transportNote = !NOTIFY_EMAIL
    ? 'sms-only (NOTIFY_EMAIL unset)'
    : (failures.length > 0 && !transports.sms.sent && !transports.email.sent ? 'ALL TRANSPORTS FAILED' : null);

  // ── 5. Write heartbeat status to snapshot ──
  try {
    await fetch(`${BASE_URL}/api/snapshot`, {
      method: 'POST',
      headers: snapshotHeaders(),
      body: JSON.stringify({
        heartbeat: {
          lastRun: new Date().toISOString(),
          status: failures.length === 0 ? 'ok' : 'alert',
          failures,
          checks,
          transports,
          ...(transportNote ? { transportNote } : {}),
          fallbackSMSSent: transports.sms.sent
        }
      })
    });
  } catch (e) {
    console.error(`[Heartbeat] Snapshot push failed: ${e.message}`);
  }

  const duration = Date.now() - startTime;
  console.log(`[Heartbeat] ${failures.length === 0 ? 'OK' : 'ALERT'} in ${duration}ms — ${failures.length} failures`);

  await logAgentRun({ tenantId, agentSlug: 'heartbeat', trigger: 'cron_daily', status: failures.length === 0 ? 'success' : 'partial', summary: `${failures.length} failures`, error: failures.length ? `${failures.length} system check failure(s)` : null, startedAt: startTime });
  return res.json({
    status: failures.length === 0 ? 'ok' : 'alert',
    duration: `${duration}ms`,
    failures,
    checks,
    transports,
    ...(transportNote ? { transportNote } : {}),
    fallbackSMSSent: transports.sms.sent,
    fallbackSMSError: transports.sms.error
  });
}
