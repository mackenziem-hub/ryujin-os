// Z Fighter Daily Agent Runner
// Runs: Meta Ads refresh → Vegeta, Piccolo, Krillin, Gohan
// Schedule: 6:03 AM AT daily (Vercel cron)
//
// RULE: Agents NEVER create tickets or take external actions directly.
// All actions route through /api/router for Mackenzie's approval.

import { runVegeta, runPiccolo, runKrillin, runGohan, sendFallbackEmail } from './_shared.js';
import { buildMetaAdsSnapshot, checkTokenHealth, auditAdSetConfig } from '../../lib/meta.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';
import { logAgentRun } from '../../lib/agents/logAgentRun.js';
import { supabaseAdmin } from '../../lib/supabase.js';

const BASE_URL = 'https://ryujin-os.vercel.app';
const AGENT_TIMEOUT = 25000; // 25s per agent

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}

export default async function handler(req, res) {
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const startTime = Date.now();

  // ── PHASE 0: Check token health + refresh Meta Ads data BEFORE agents run ──
  let metaRefresh = { status: 'skipped' };
  let tokenStatus = null;
  try {
    // Check token health — warns if within 14 days of expiry (no auto-exchange)
    tokenStatus = await checkTokenHealth();
    if (tokenStatus.expiryWarning) {
      console.log(`[Z Fighter Daily] ${tokenStatus.expiryWarning}`);
      await fetch(`${BASE_URL}/api/snapshot`, {
        method: 'POST',
        headers: snapshotHeaders(),
        body: JSON.stringify({ tokenWarning: { timestamp: new Date().toISOString(), daysLeft: tokenStatus.daysLeft, message: tokenStatus.expiryWarning } })
      });
      // Escalation at 14d / 7d / 3d / expired so it doesn't just sit silent in the snapshot.
      const d = tokenStatus.daysLeft;
      if (d !== null && (d <= 3 || d === 7 || d === 14)) {
        await sendFallbackEmail(`META TOKEN expires in ${d} days`, `Generate a System User token in Meta Business Settings → System Users → (Shenron or Ryujin) → Generate Token, then update META_ACCESS_TOKEN in Vercel. System User tokens never expire.`);
      }
    } else if (tokenStatus.valid) {
      // Token is healthy again (14+ days to expiry). tokenWarning is sticky:
      // it lives in snapshot preserveKeys and was only ever WRITTEN here, never
      // cleared, so a recovered token left a frozen stale warning forever. That
      // burned a false "ads went blind / token expired" alarm on 2026-06-15 (the
      // Jun-11 warning predated Mac's Jun-12 regen but kept showing). Clear it on
      // recovery so the snapshot self-heals. Guarded on .valid so a transient
      // health-check error does not wipe a genuine pending warning.
      await fetch(`${BASE_URL}/api/snapshot`, {
        method: 'POST',
        headers: snapshotHeaders(),
        body: JSON.stringify({ tokenWarning: null })
      });
    }
  } catch (e) {
    console.error(`[Z Fighter Daily] Token health check failed: ${e.message}`);
  }

  // Config audit — verify every active ad set is optimizing for the right event.
  // Catches the "campaign optimizing for landing_page_view instead of Lead" failure mode.
  let configAudit = { status: 'skipped' };
  try {
    const audit = await auditAdSetConfig();
    configAudit = { status: 'ok', total: audit.totalAdSets, active: audit.activeAdSets, flagged: audit.flaggedCount };
    await fetch(`${BASE_URL}/api/snapshot`, {
      method: 'POST',
      headers: snapshotHeaders(),
      body: JSON.stringify({ metaConfigAudit: audit })
    });
    if (audit.flaggedCount > 0) {
      const lines = audit.flagged.slice(0, 5).map(f => `• ${f.campaign} → ${f.adSet}: ${f.flags[0]}`).join('\n');
      await sendFallbackEmail(`Meta config alert — ${audit.flaggedCount} ad set(s) misconfigured`, `${lines}\n\nFull audit: https://ryujin-os.vercel.app/api/meta-config-audit`);
    }
  } catch (e) {
    configAudit = { status: 'error', error: e.message };
    console.error(`[Z Fighter Daily] Config audit failed: ${e.message}`);
  }

  // Refresh Meta Ads data — agents read from snapshot, so ad data must be fresh
  try {
    console.log('[Z Fighter Daily] Refreshing Meta Ads from live API...');
    const metaAds = await buildMetaAdsSnapshot();
    // Include token expiry info in the snapshot for the recommendations panel
    if (tokenStatus?.expiresAt) metaAds._tokenExpiresAt = tokenStatus.expiresAt;
    await fetch(`${BASE_URL}/api/snapshot`, {
      method: 'POST',
      headers: snapshotHeaders(),
      body: JSON.stringify({ metaAds })
    });
    metaRefresh = { status: 'ok', campaigns: metaAds.activeCampaignCount, alerts: metaAds.alerts.length, tokenDaysLeft: tokenStatus?.daysLeft };
    console.log(`[Z Fighter Daily] Meta Ads refreshed — ${metaAds.activeCampaignCount} active, ${metaAds.alerts.length} alerts`);
  } catch (e) {
    metaRefresh = { status: 'error', error: e.message };
    console.error(`[Z Fighter Daily] Meta Ads refresh failed: ${e.message} — agents will use stale data`);
  }

  // ── PHASE 1: Run agents (with fresh ad data in snapshot) ──
  console.log('[Z Fighter Daily] Running Vegeta, Piccolo, Krillin, Gohan...');

  let reports = {};
  const errors = [];

  try {
    const [vegeta, piccolo, krillin, gohan] = await Promise.all([
      withTimeout(runVegeta(), AGENT_TIMEOUT, 'Vantage').catch(e => { errors.push(`vegeta: ${e.message}`); return null; }),
      withTimeout(runPiccolo(), AGENT_TIMEOUT, 'Keystone').catch(e => { errors.push(`piccolo: ${e.message}`); return null; }),
      withTimeout(runKrillin(), AGENT_TIMEOUT, 'Relay').catch(e => { errors.push(`krillin: ${e.message}`); return null; }),
      withTimeout(runGohan(), AGENT_TIMEOUT, 'Beacon').catch(e => { errors.push(`gohan: ${e.message}`); return null; })
    ]);

    reports = { vegeta, piccolo, krillin, gohan };
  } catch (e) {
    errors.push(`runner: ${e.message}`);
    await sendFallbackEmail(`Daily agent CRASHED`, `Error: ${e.message}\n\nCheck Vercel function logs for ryujin-os/api/agents/daily.`);
  }

  // Agents only report — no tickets, no SMS, no external actions.
  const recommendations = [];
  for (const [agent, report] of Object.entries(reports)) {
    if (!report) continue;
    for (const task of (report.tasks || [])) {
      recommendations.push({ agent, title: task.title, priority: task.priority, description: task.description });
    }
  }

  if (errors.length > 0) {
    console.error(`[Z Fighter Daily] ${errors.length} agent errors: ${errors.join('; ')}`);
  }

  const duration = Date.now() - startTime;
  console.log(`[Z Fighter Daily] Complete in ${duration}ms — ${recommendations.length} recommendations`);

  // Persist reports to snapshot so audits/briefings can confirm each agent ran.
  // Without this, daily reports vanish on HTTP response and only metaAds is visible.
  try {
    await fetch(`${BASE_URL}/api/snapshot`, {
      method: 'POST',
      headers: snapshotHeaders(),
      body: JSON.stringify({
        agentReports: {
          daily: {
            lastRun: new Date().toISOString(),
            durationMs: duration,
            vegeta: reports.vegeta || null,
            piccolo: reports.piccolo || null,
            krillin: reports.krillin || null,
            gohan: reports.gohan || null,
            recommendations,
            errors
          }
        }
      })
    });
  } catch (e) {
    console.error(`[Z Fighter Daily] Snapshot persistence failed: ${e.message}`);
  }

  // Observability heartbeat: log to agent_runs so the load-scan freshness alarm
  // can see the daily agent (migration_106 allows the 'daily' slug). Best-effort.
  try {
    const { data: t } = await supabaseAdmin.from('tenants').select('id').eq('slug', 'plus-ultra').single();
    await logAgentRun({
      tenantId: t?.id,
      agentSlug: 'daily',
      trigger: req.query?.type || req.query?.manual ? 'manual' : 'cron_daily',
      status: errors.length > 0 ? 'partial' : 'success',
      summary: `daily: ${recommendations.length} recs, ${Object.values(reports).filter(Boolean).length} agents`,
      error: errors.length ? errors.join(' | ') : null,
      startedAt: startTime,
    });
  } catch { /* best-effort */ }

  res.json({
    status: errors.length > 0 ? 'partial' : 'complete',
    ranAt: new Date().toISOString(),
    duration: `${duration}ms`,
    metaRefresh,
    configAudit,
    agents: Object.values(reports).filter(Boolean).length,
    totalFindings: Object.values(reports).filter(Boolean).reduce((s, r) => s + (r.findings?.length || 0), 0),
    recommendations: recommendations.length,
    errors,
    reports,
    recommended_actions: recommendations
  });
}
