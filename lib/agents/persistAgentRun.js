// ═══════════════════════════════════════════════════════════════
// PERSIST AGENT RUN — bridge between agent reports and admin core tables.
//
// Each existing agent (api/agents/_shared.js: runVegeta/Piccolo/Krillin/...
// + the new lib/agents/customer_scan + strategy_scan) returns a `report`
// object with shape:
//   { agent, role, timestamp, findings: [], tasks: [], stats: {...}, ... }
//
// This module turns that report into rows in:
//   - agent_runs       (audit log + report storage)
//   - quests           (each task → assignable quest with XP)
//   - briefing_items   (each finding → today's morning briefing entry)
//   - kpis             (each named stat → upserted KPI tile)
//
// All writes go through service-role supabase. Tenant comes from the
// caller (default plus-ultra). Per-user assigned_to comes from the
// optional `assignedTo` map (agent_slug → user_id).
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../supabase.js';

const PRIORITY_FROM_TASK = {
  top_priority: 'urgent',
  high: 'high',
  medium: 'normal',
  low: 'normal'
};

const XP_FOR_PRIORITY = {
  urgent: 30,
  high: 20,
  normal: 10
};

const QUEST_CATEGORY = {
  sales: 'sales',
  vegeta: 'sales',
  marketing: 'marketing',
  bulma: 'marketing',
  ops: 'ops',
  piccolo: 'ops',
  finance: 'finance',
  cashflow: 'finance',
  customer: 'customer',
  comms: 'customer',
  krillin: 'customer',
  service: 'service',
  strategy: 'strategy',
  // bonus mappings — these write into closest category
  game: 'ops',
  gohan: 'ops',
  infra: 'ops',
  trunks: 'ops',
  creative: 'marketing',
  android18: 'marketing'
};

/**
 * Persist a single agent report to the admin-core tables.
 *
 * @param {object} report          — agent's return value (must have agent, findings, tasks)
 * @param {object} opts
 * @param {string} opts.tenantId   — tenant uuid (required)
 * @param {string} opts.agentSlug  — canonical agent slug (sales|marketing|ops|finance|customer|strategy)
 * @param {string} opts.trigger    — 'cron_daily' | 'manual' | 'api'
 * @param {object} opts.assignedTo — { sales: <uuid>, ops: <uuid>, ... } user mapping per agent
 * @param {object} opts.kpiMap     — { reportPath: { key, label, unit, target } } for stat→KPI extraction
 * @returns {object}               — { runId, emittedQuests, emittedKpis, emittedBriefs }
 */
export async function persistAgentRun(report, opts) {
  const {
    tenantId,
    agentSlug,
    trigger = 'cron_daily',
    assignedTo = {},
    kpiMap = {}
  } = opts || {};
  if (!tenantId) throw new Error('persistAgentRun: tenantId required');
  if (!agentSlug) throw new Error('persistAgentRun: agentSlug required');

  const startedAt = new Date(report.timestamp || Date.now()).toISOString();
  const completedAt = new Date().toISOString();
  const durationMs = Date.parse(completedAt) - Date.parse(startedAt);

  // 1. Insert agent_runs row first — get the id for back-references
  const runInsert = await supabaseAdmin
    .from('agent_runs')
    .insert({
      tenant_id: tenantId,
      agent_slug: agentSlug,
      trigger,
      started_at: startedAt,
      completed_at: completedAt,
      status: report.errors?.length ? 'partial' : 'success',
      summary: summarizeReport(report),
      output: report,
      duration_ms: durationMs
    })
    .select('id')
    .single();

  if (runInsert.error) {
    console.error(`[persistAgentRun] agent_runs insert failed for ${agentSlug}:`, runInsert.error.message);
    return { runId: null, emittedQuests: 0, emittedKpis: 0, emittedBriefs: 0, error: runInsert.error.message };
  }
  const runId = runInsert.data.id;

  // 2. Tasks → quests
  const questRows = (report.tasks || []).map(t => {
    const priority = PRIORITY_FROM_TASK[t.priority] || 'normal';
    return {
      tenant_id: tenantId,
      assigned_to: assignedTo[agentSlug] || null,
      category: QUEST_CATEGORY[agentSlug] || 'personal',
      type: priority === 'urgent' ? 'campaign' : 'daily',
      title: t.title,
      description: t.description || null,
      xp_reward: XP_FOR_PRIORITY[priority],
      source_agent: agentSlug,
      source_id: runId,
      metadata: { agent_priority: t.priority || null, ...(t.meta || {}) }
    };
  });

  let emittedQuests = 0;
  if (questRows.length > 0) {
    const qres = await supabaseAdmin.from('quests').insert(questRows);
    if (!qres.error) emittedQuests = questRows.length;
    else console.error(`[persistAgentRun] quests insert failed for ${agentSlug}:`, qres.error.message);
  }

  // 3. Findings → briefing_items (today's date, priority normal unless flagged)
  const briefRows = (report.findings || []).map((f, i) => {
    const text = typeof f === 'string' ? f : (f.text || JSON.stringify(f));
    const priority = inferBriefingPriority(text);
    return {
      tenant_id: tenantId,
      for_user_id: assignedTo[agentSlug] || null,
      for_date: new Date().toISOString().slice(0, 10),
      priority,
      title: truncate(text, 140),
      body: text.length > 140 ? text : null,
      source_agent: agentSlug,
      source_id: runId,
      metadata: { index: i }
    };
  });

  let emittedBriefs = 0;
  if (briefRows.length > 0) {
    const bres = await supabaseAdmin.from('briefing_items').insert(briefRows);
    if (!bres.error) emittedBriefs = briefRows.length;
    else console.error(`[persistAgentRun] briefing_items insert failed for ${agentSlug}:`, bres.error.message);
  }

  // 4. Stats → kpis (upsert by key)
  const kpiRows = [];
  for (const [path, meta] of Object.entries(kpiMap)) {
    const value = getByPath(report, path);
    if (value === undefined || value === null) continue;
    kpiRows.push({
      tenant_id: tenantId,
      key: meta.key,
      label: meta.label,
      value: String(value),
      unit: meta.unit || null,
      target: meta.target || null,
      sort_order: meta.sort_order ?? 100,
      source_agent: agentSlug,
      last_updated_at: completedAt,
      metadata: meta.metadata || {}
    });
  }

  let emittedKpis = 0;
  if (kpiRows.length > 0) {
    const kres = await supabaseAdmin
      .from('kpis')
      .upsert(kpiRows, { onConflict: 'tenant_id,key' });
    if (!kres.error) emittedKpis = kpiRows.length;
    else console.error(`[persistAgentRun] kpis upsert failed for ${agentSlug}:`, kres.error.message);
  }

  // 5. Patch the run row with emission counts
  await supabaseAdmin
    .from('agent_runs')
    .update({
      emitted_quests: emittedQuests,
      emitted_kpis: emittedKpis,
      emitted_briefs: emittedBriefs
    })
    .eq('id', runId);

  return { runId, emittedQuests, emittedKpis, emittedBriefs };
}

function summarizeReport(report) {
  const counts = `${(report.findings || []).length} findings, ${(report.tasks || []).length} tasks`;
  const top = (report.findings || [])[0];
  return top ? `${counts}. Top: ${truncate(typeof top === 'string' ? top : top.text || '', 100)}` : counts;
}

function inferBriefingPriority(text) {
  const lower = text.toLowerCase();
  if (/🚨|critical|urgent|down|unreachable|payment fail|billing fail|zero leads/.test(lower)) return 'urgent';
  if (/⚠️|warning|stale|overdue|low|fail|alert/.test(lower)) return 'high';
  return 'normal';
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
