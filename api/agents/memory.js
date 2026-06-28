// Z Fighter Memory Agent
// Schedule: 3:59 AM AT daily
// Reads latest agent reports, compares to previous memory, writes deltas.

import { runVegeta, runPiccolo, runKrillin, runGohan, runBulma, runTrunks, fetchJSON, sendFallbackEmail } from './_shared.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';
import { logAgentRun } from '../../lib/agents/logAgentRun.js';
import { supabaseAdmin } from '../../lib/supabase.js';

const AGENT_TIMEOUT = 25000;
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}

const MEMORY_API = 'https://ryujin-os.vercel.app/api/memory';

async function readAgentMemory(agent) {
  try {
    const resp = await fetch(`${MEMORY_API}?type=agent&name=${agent}`, { headers: snapshotHeaders() });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.memory;
  } catch (e) { return null; }
}

async function writeAgentMemory(agent, memory) {
  try {
    const resp = await fetch(`${MEMORY_API}?type=agent&name=${agent}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...snapshotHeaders() },
      body: JSON.stringify(memory)
    });
    if (!resp.ok) throw new Error(`write failed: HTTP ${resp.status}`);
  } catch (e) {
    console.error(`[Memory] Failed to write ${agent} memory:`, e.message);
  }
}

function detectChanges(previous, current, agent) {
  const changes = [];
  if (!previous || !previous.report_summary) return changes;

  const prev = previous.report_summary;
  const curr = current;

  // Vegeta-specific deltas
  if (agent === 'vegeta') {
    if (prev.totalValue !== undefined && curr.stats?.totalValue !== undefined) {
      const delta = (curr.stats?.totalValue || 0) - (prev.totalValue || 0);
      if (delta !== 0) {
        changes.push({ type: 'pipeline_value_change', delta, old: prev.totalValue, new: curr.stats?.totalValue });
      }
    }
    if (prev.staleLeads !== undefined && curr.staleLeads !== undefined && prev.staleLeads !== curr.staleLeads) {
      changes.push({ type: 'stale_leads_change', old: prev.staleLeads, new: curr.staleLeads });
    }
  }

  // Piccolo-specific deltas
  if (agent === 'piccolo') {
    if (prev.overdueCount !== undefined && curr.stats?.overdueCount !== undefined && prev.overdueCount !== curr.stats.overdueCount) {
      changes.push({ type: 'overdue_change', old: prev.overdueCount, new: curr.stats.overdueCount });
    }
    if (prev.totalTickets !== undefined && curr.stats?.totalTickets !== undefined && prev.totalTickets !== curr.stats.totalTickets) {
      changes.push({ type: 'ticket_count_change', old: prev.totalTickets, new: curr.stats.totalTickets });
    }
  }

  // Krillin-specific deltas
  if (agent === 'krillin') {
    if (prev.unreadCount !== undefined && curr.stats?.unreadCount !== undefined && prev.unreadCount !== curr.stats.unreadCount) {
      changes.push({ type: 'unread_change', old: prev.unreadCount, new: curr.stats.unreadCount });
    }
  }

  return changes;
}

export default async function handler(req, res) {
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const startTime = Date.now();
  console.log('[Memory Agent] Running daily memory consolidation...');

  const errors = [];

  // Run all daily agents to get fresh data
  let reports;
  try {
    const [vegeta, piccolo, krillin, gohan, bulma, trunks] = await Promise.all([
      withTimeout(runVegeta(), AGENT_TIMEOUT, 'Vantage').catch(e => { errors.push(`vegeta: ${e.message}`); return null; }),
      withTimeout(runPiccolo(), AGENT_TIMEOUT, 'Keystone').catch(e => { errors.push(`piccolo: ${e.message}`); return null; }),
      withTimeout(runKrillin(), AGENT_TIMEOUT, 'Relay').catch(e => { errors.push(`krillin: ${e.message}`); return null; }),
      withTimeout(runGohan(), AGENT_TIMEOUT, 'Beacon').catch(e => { errors.push(`gohan: ${e.message}`); return null; }),
      withTimeout(runBulma(), AGENT_TIMEOUT, 'Compass').catch(e => { errors.push(`bulma: ${e.message}`); return null; }),
      withTimeout(runTrunks(), AGENT_TIMEOUT, 'Bulwark').catch(e => { errors.push(`trunks: ${e.message}`); return null; })
    ]);
    reports = { vegeta, piccolo, krillin, gohan, bulma, trunks };
  } catch (e) {
    errors.push(`runner: ${e.message}`);
    reports = {};
  }

  const memoryUpdates = {};

  for (const [agent, report] of Object.entries(reports)) {
    if (!report) continue;

    // Read previous memory
    const prevMemory = await readAgentMemory(agent);

    // Detect deltas
    const changes = detectChanges(prevMemory, report, agent);

    // Build new memory
    const newMemory = {
      agent,
      last_report_timestamp: new Date().toISOString(),
      report_summary: {
        ...(report.stats || {}),
        staleLeads: report.staleLeads,
        estimatorStats: report.estimatorStats,
        gameOnline: report.gameOnline,
        hqOnline: report.hqOnline
      },
      key_findings: report.findings || [],
      changes_since_last_report: changes,
      alerts: (report.tasks || []).filter(t => t.priority === 'top_priority' || t.priority === 'high').map(t => t.title),
      previous_report_timestamp: prevMemory?.last_report_timestamp || null,
      next_check: agent === 'bulma' || agent === 'trunks'
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };

    // Write to memory API
    await writeAgentMemory(agent, newMemory);
    memoryUpdates[agent] = { findings: newMemory.key_findings.length, changes: changes.length, alerts: newMemory.alerts.length };
  }

  if (errors.length >= 3) {
    await sendFallbackEmail(`Memory agent: ${errors.length} agents failed`, errors.join('\n'));
  }

  const duration = Date.now() - startTime;
  console.log(`[Memory Agent] Complete in ${duration}ms — ${Object.keys(memoryUpdates).length} agents updated`);

  // Observability heartbeat (migration_106 allows 'memory'). Best-effort.
  try {
    const { data: t } = await supabaseAdmin.from('tenants').select('id').eq('slug', 'plus-ultra').single();
    await logAgentRun({ tenantId: t?.id, agentSlug: 'memory', trigger: 'cron_daily', status: errors.length >= 3 ? 'partial' : 'success', summary: `${Object.keys(memoryUpdates).length} agents updated`, error: errors.length ? errors.join(' | ') : null, startedAt: startTime });
  } catch { /* best-effort */ }

  res.json({
    agent: 'Memory',
    status: errors.length >= 3 ? 'degraded' : 'ok',
    mode: 'active',
    timestamp: new Date().toISOString(),
    duration: `${duration}ms`,
    updates: memoryUpdates,
    errors
  });
}
