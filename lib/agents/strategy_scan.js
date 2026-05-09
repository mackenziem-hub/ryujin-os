// ═══════════════════════════════════════════════════════════════
// STRATEGY AGENT — weekly cross-domain rollup.
//
// Reads the past 7 days of agent_runs across all the other archetypal
// agents and synthesizes:
//   - which domains had the most findings/alerts (where attention is going)
//   - KPI deltas week-over-week
//   - any agent that errored or partially completed (silent failure radar)
//
// Returns the same { agent, role, findings, tasks, stats } shape as
// the other agents so persistAgentRun handles it identically.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../supabase.js';

export async function runStrategyScan({ tenantSlug = 'plus-ultra' } = {}) {
  const report = {
    agent: 'Strategy',
    role: 'Cross-domain synthesis + week-over-week deltas',
    timestamp: new Date().toISOString(),
    findings: [],
    tasks: [],
    stats: {}
  };

  const t = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .maybeSingle();
  if (t.error || !t.data) {
    report.findings.push(`Tenant lookup failed for slug=${tenantSlug}`);
    return report;
  }
  const tenantId = t.data.id;

  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();

  // ── Pull past 7 days of agent_runs across all agents ──
  const runs = await supabaseAdmin
    .from('agent_runs')
    .select('agent_slug, status, summary, emitted_quests, emitted_kpis, emitted_briefs, started_at, completed_at, error_message')
    .eq('tenant_id', tenantId)
    .gte('started_at', sevenDaysAgo)
    .order('started_at', { ascending: false })
    .limit(500);

  if (runs.error) {
    report.findings.push(`agent_runs read failed: ${runs.error.message}`);
    return report;
  }
  const list = runs.data || [];
  report.stats.runsLast7d = list.length;

  // ── Counts per agent ──
  const byAgent = {};
  for (const r of list) {
    if (!byAgent[r.agent_slug]) {
      byAgent[r.agent_slug] = { runs: 0, success: 0, partial: 0, error: 0, quests: 0, briefs: 0, kpis: 0 };
    }
    const a = byAgent[r.agent_slug];
    a.runs++;
    if (r.status === 'success') a.success++;
    else if (r.status === 'partial') a.partial++;
    else if (r.status === 'error') a.error++;
    a.quests += r.emitted_quests || 0;
    a.briefs += r.emitted_briefs || 0;
    a.kpis += r.emitted_kpis || 0;
  }
  report.stats.byAgent = byAgent;

  // ── Most active domain (most quests emitted this week) ──
  const ranked = Object.entries(byAgent).sort((a, b) => b[1].quests - a[1].quests);
  if (ranked.length > 0) {
    const [topAgent, topData] = ranked[0];
    report.findings.push(`Most active domain this week: ${topAgent} (${topData.quests} quests, ${topData.briefs} briefing items)`);
  }

  // ── Silent-failure radar: any agent with error/partial runs ──
  const failing = Object.entries(byAgent).filter(([, d]) => d.error > 0 || d.partial > 0);
  if (failing.length > 0) {
    report.findings.push(`${failing.length} agent${failing.length === 1 ? '' : 's'} had failures this week: ${failing.map(([a, d]) => `${a} (${d.error}E/${d.partial}P/${d.runs}T)`).join(', ')}`);
    report.tasks.push({
      title: `Investigate ${failing.length} agent${failing.length === 1 ? '' : 's'} with failed runs`,
      description: failing.map(([a, d]) => {
        const lastErr = list.find(r => r.agent_slug === a && (r.status === 'error' || r.status === 'partial'));
        return `• ${a}: ${d.error} errors / ${d.partial} partial / ${d.runs} total — last issue: ${lastErr?.error_message || lastErr?.summary || 'see agent_runs'}`;
      }).join('\n'),
      priority: 'high'
    });
  }

  // ── KPI week-over-week deltas ──
  // Pull current KPIs and compare against agent_runs.output snapshots from 7 days ago.
  // For now, simple: just report current KPI count + any KPI flagged with trend='down' or trend_pct < -10
  const kpis = await supabaseAdmin
    .from('kpis')
    .select('key, label, value, trend, trend_pct, last_updated_at')
    .eq('tenant_id', tenantId)
    .limit(100);

  if (!kpis.error && kpis.data) {
    report.stats.kpiCount = kpis.data.length;
    const downward = kpis.data.filter(k => k.trend === 'down' || (typeof k.trend_pct === 'number' && k.trend_pct < -10));
    if (downward.length > 0) {
      report.findings.push(`${downward.length} KPI${downward.length === 1 ? '' : 's'} trending down: ${downward.slice(0, 5).map(k => `${k.label} (${k.value}${k.trend_pct ? ` ${k.trend_pct}%` : ''})`).join(', ')}`);
      report.tasks.push({
        title: `Review ${downward.length} declining KPI${downward.length === 1 ? '' : 's'}`,
        description: downward.map(k => `• ${k.label}: ${k.value}${k.trend_pct ? ` (${k.trend_pct}% week-over-week)` : ''}`).join('\n'),
        priority: 'medium'
      });
    }
    // Stale KPIs (not updated in 3+ days)
    const staleCutoff = now - 3 * 86400000;
    const stale = kpis.data.filter(k => k.last_updated_at && new Date(k.last_updated_at).getTime() < staleCutoff);
    if (stale.length > 0) {
      report.findings.push(`${stale.length} KPI${stale.length === 1 ? '' : 's'} not refreshed in 3+ days — agent feeds may be silent`);
    }
  }

  // ── Activity summary line ──
  const totalQuests = Object.values(byAgent).reduce((s, d) => s + d.quests, 0);
  const totalBriefs = Object.values(byAgent).reduce((s, d) => s + d.briefs, 0);
  report.findings.push(`Week summary: ${list.length} agent runs · ${totalQuests} quests emitted · ${totalBriefs} briefing items`);

  return report;
}
