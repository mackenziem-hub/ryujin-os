// ═══════════════════════════════════════════════════════════════
// HEARTBEAT — Dead-man's switch for the morning briefing
// Runs at 9:00 AM AT (12:00 UTC) — 2 hours after morning briefing cron
// Verifies the morning briefing actually fired AND sent its email
// If anything is wrong, sends a raw fallback email to Mackenzie
// ═══════════════════════════════════════════════════════════════

import { gmailSend } from '../../lib/google.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';

const SHENRON_BASE = 'https://ryujin-os.vercel.app';
const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL || 'mackenzie.m@plusultraroofing.com').trim();

// How fresh the morning briefing must be (hours).
// Cron fires at 9 AM AT, briefing runs at 7 AM AT, so 3 hours is the cutoff.
const BRIEFING_MAX_AGE_HOURS = 3;

async function sendFallbackAlert(subject, body) {
  try {
    await gmailSend(NOTIFY_EMAIL, `[Ryujin Heartbeat] ${subject}`, body);
    return { ok: true };
  } catch (e) {
    console.error(`[Heartbeat] Email fallback failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

export default async function handler(req, res) {
  const auth = requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const startTime = Date.now();
  const checks = [];
  const failures = [];

  // ── 1. Fetch snapshot ──
  let snapshot;
  try {
    const r = await fetch(`${SHENRON_BASE}/api/snapshot?_t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    snapshot = await r.json();
  } catch (e) {
    // Snapshot itself is dead. Send raw alert and bail.
    await sendFallbackAlert(`Heartbeat fail — snapshot unreachable`, `Snapshot API unreachable: ${e.message}\n\nWhole system may be down. Check Vercel logs.`);
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
    // Email dispatch check (briefing.js writes emailSent into snapshot)
    if (briefingMorning.emailSent === false) {
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

  // ── 4. If anything failed, send a fallback email ──
  let fallbackResult = null;
  if (failures.length > 0) {
    const lines = ['Morning briefing pipeline issue:\n'];
    for (const f of failures.slice(0, 4)) {
      lines.push(`• ${f}`);
    }
    lines.push('\nCheck Vercel logs at https://vercel.com/mackenziem-8357s-projects/ryujin-os');
    fallbackResult = await sendFallbackAlert(`${failures.length} briefing failures detected`, lines.join('\n'));
  }

  // ── 5. Write heartbeat status to snapshot ──
  try {
    await fetch(`${SHENRON_BASE}/api/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        heartbeat: {
          lastRun: new Date().toISOString(),
          status: failures.length === 0 ? 'ok' : 'alert',
          failures,
          checks,
          fallbackSMSSent: !!(fallbackResult && fallbackResult.ok)
        }
      })
    });
  } catch (e) {
    console.error(`[Heartbeat] Snapshot push failed: ${e.message}`);
  }

  const duration = Date.now() - startTime;
  console.log(`[Heartbeat] ${failures.length === 0 ? 'OK' : 'ALERT'} in ${duration}ms — ${failures.length} failures`);

  return res.json({
    status: failures.length === 0 ? 'ok' : 'alert',
    duration: `${duration}ms`,
    failures,
    checks,
    fallbackSMSSent: !!(fallbackResult && fallbackResult.ok),
    fallbackSMSError: fallbackResult?.error || null
  });
}
