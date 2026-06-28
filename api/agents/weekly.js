// Z Fighter Weekly Agent Runner
// Runs: Trunks, Bulma
// Schedule: Monday 5:07 AM AT (Vercel cron)
//
// RULE: Agents NEVER create tickets or take external actions directly.
// All actions route through /api/router for Mackenzie's approval.

import { runTrunks, runBulma } from './_shared.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';
import { logAgentRun } from '../../lib/agents/logAgentRun.js';
import { supabaseAdmin } from '../../lib/supabase.js';

const BASE_URL = 'https://ryujin-os.vercel.app';

export default async function handler(req, res) {
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const startTime = Date.now();
  console.log('[Z Fighter Weekly] Running Trunks, Bulma...');

  // Run Trunks first (infra check), then Bulma (needs infra confirmed)
  const trunks = await runTrunks();
  const bulma = await runBulma();

  const reports = { trunks, bulma };

  const recommendations = [];
  for (const [agent, report] of Object.entries(reports)) {
    for (const task of (report.tasks || [])) {
      recommendations.push({ agent, title: task.title, priority: task.priority, description: task.description });
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[Z Fighter Weekly] Complete in ${duration}ms — ${recommendations.length} recommendations`);

  // Persist reports to snapshot so audits can confirm each agent ran.
  // OWN top-level key (NOT agentReports.weekly): the snapshot POST handler does a
  // shallow per-section overwrite, and daily.js already owns agentReports. Sharing
  // that key meant daily's 10:04 run wiped this weekly bucket within the hour every
  // Monday (Trunks/Bulma output vanished). Disjoint keys is the documented rule in
  // api/snapshot.js. agentReportsWeekly must be in that file's preserveKeys.
  try {
    await fetch(`${BASE_URL}/api/snapshot`, {
      method: 'POST',
      headers: snapshotHeaders(),
      body: JSON.stringify({
        agentReportsWeekly: {
          lastRun: new Date().toISOString(),
          durationMs: duration,
          trunks,
          bulma,
          recommendations
        }
      })
    });
  } catch (e) {
    console.error(`[Z Fighter Weekly] Snapshot persistence failed: ${e.message}`);
  }

  // Observability heartbeat (migration_106 allows 'weekly'). Best-effort.
  try {
    const { data: t } = await supabaseAdmin.from('tenants').select('id').eq('slug', 'plus-ultra').single();
    await logAgentRun({ tenantId: t?.id, agentSlug: 'weekly', trigger: 'cron_daily', status: 'success', summary: `${Object.keys(reports).length} agents, ${recommendations.length} recs`, startedAt: startTime });
  } catch { /* best-effort */ }

  res.json({
    status: 'complete',
    ranAt: new Date().toISOString(),
    duration: `${duration}ms`,
    agents: Object.keys(reports).length,
    totalFindings: Object.values(reports).reduce((s, r) => s + (r.findings?.length || 0), 0),
    recommendations: recommendations.length,
    reports,
    recommended_actions: recommendations
  });
}
