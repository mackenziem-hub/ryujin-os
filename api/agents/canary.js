// ═══════════════════════════════════════════════════════════════
// CANARY - 24/7 prod-health watch for the customer-facing surfaces
// Runs every 30 min. Curls the live alias for the /p/ proposal-link
// rewrite, the legacy proposal path, the site-up baseline, and the
// snapshot API. SMS-alerts Mac ONLY on a status TRANSITION (up to down,
// or recovery), debounced via snapshot.sections.canary so an ongoing
// outage never spams. Built after the Jun 21 2026 proposal-link clobber
// (every /p/ link 404'd ~9.5h, undetected until Mac clicked a link).
//
// The headline check is /p/__canary__ : a SYNTHETIC slug. A healthy /p/
// rewrite serves the static renderer (200) for any slug, so this tests
// the exact clobber failure mode (the rewrite rule getting dropped)
// without false-alarming when a real proposal is deleted or
// re-materialized. If the site baseline (/login) is up but /p/ is 404,
// the alert names the likely cause: a deploy clobber.
// ═══════════════════════════════════════════════════════════════

import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';
import { sendFallbackSMS } from './_shared.js';

const BASE_URL = 'https://ryujin-os.vercel.app';

// critical = its failure flips status to 'down' and pages Mac on transition.
// /login is informational: it tells us whether a /p/ failure is a clobber
// (site up, only proposals dead) or a full outage (site down too).
const CHECKS = [
  { name: 'rewrite /p/', path: '/p/__canary__', critical: true, auth: false },
  { name: 'legacy proposal', path: '/proposal-client.html?share=JI639ircHmr2JGEelAhJRO6eAkPBm482', critical: true, auth: false },
  { name: 'snapshot api', path: '/api/snapshot', critical: true, auth: true },
  { name: 'site /login', path: '/login.html', critical: false, auth: false },
];

async function probe(c) {
  try {
    const r = await fetch(`${BASE_URL}${c.path}`, {
      redirect: 'follow',
      cache: 'no-store',
      headers: c.auth ? snapshotHeaders() : {},
      signal: AbortSignal.timeout(15000),
    });
    return { name: c.name, critical: c.critical, code: r.status, ok: r.status === 200 };
  } catch (e) {
    return { name: c.name, critical: c.critical, code: 0, ok: false, error: e.message };
  }
}

export default async function handler(req, res) {
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const startTime = Date.now();

  // ── 1. Read previous canary status (for transition debounce) ──
  let prevStatus = 'ok';
  try {
    const r = await fetch(`${BASE_URL}/api/snapshot?_t=${Date.now()}`, { cache: 'no-store', headers: snapshotHeaders() });
    if (r.ok) {
      const snap = await r.json();
      prevStatus = snap?.sections?.canary?.status || 'ok';
    }
  } catch { /* treat as ok; a snapshot read miss must not block the probe */ }

  // ── 2. Probe every surface in parallel ──
  const checks = await Promise.all(CHECKS.map(probe));
  const failing = checks.filter((c) => c.critical && !c.ok);
  const nowStatus = failing.length ? 'down' : 'ok';
  const siteUp = checks.find((c) => c.name === 'site /login')?.ok;

  // ── 3. Fire SMS on a TRANSITION only (debounced) ──
  let smsResult = null;
  let sms = null;
  if (prevStatus === 'ok' && nowStatus === 'down') {
    const detail = failing.map((f) => `${f.name} ${f.code}`).join(', ');
    const onlyProposals = siteUp !== false && failing.every((f) => f.name !== 'snapshot api' && f.name !== 'site /login');
    const cause = siteUp === false
      ? 'Whole site looks down, check the deploy.'
      : onlyProposals
        ? 'Site is up but proposal links are 404, likely a deploy clobber. Redeploy origin/main.'
        : 'Check the deploy and Vercel logs.';
    sms = `RYUJIN PROD ALERT: ${detail}. ${cause}`;
  } else if (prevStatus === 'down' && nowStatus === 'ok') {
    sms = 'RYUJIN recovered: proposal links and the site are back to 200.';
  }
  if (sms) {
    smsResult = await sendFallbackSMS(sms);
  }

  // ── 4. Write status to snapshot (always, so admin can see history) ──
  try {
    await fetch(`${BASE_URL}/api/snapshot`, {
      method: 'POST',
      headers: snapshotHeaders(),
      body: JSON.stringify({
        canary: {
          lastRun: new Date().toISOString(),
          status: nowStatus,
          failing: failing.map((f) => ({ name: f.name, code: f.code })),
          checks: checks.map((c) => ({ name: c.name, code: c.code, ok: c.ok })),
          transition: prevStatus !== nowStatus ? `${prevStatus}->${nowStatus}` : null,
          smsSent: !!(smsResult && smsResult.ok),
        },
      }),
    });
  } catch (e) {
    console.error(`[Canary] snapshot push failed: ${e.message}`);
  }

  const duration = Date.now() - startTime;
  console.log(`[Canary] ${nowStatus.toUpperCase()} in ${duration}ms, ${checks.map((c) => `${c.name}=${c.code}`).join(' ')}`);

  return res.json({
    status: nowStatus,
    prevStatus,
    transition: prevStatus !== nowStatus ? `${prevStatus}->${nowStatus}` : null,
    duration: `${duration}ms`,
    checks,
    failing,
    smsSent: !!(smsResult && smsResult.ok),
  });
}
