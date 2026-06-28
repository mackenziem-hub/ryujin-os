// ═══════════════════════════════════════════════════════════════
// LOG AGENT RUN — minimal observability for the intelligence agents.
//
// The brief/snapshot agents (briefing, daily, weekly, watchdog, heartbeat,
// cashflow, memory) write only to snapshot sections, never to agent_runs, so a
// health check sees zero rows and silent degradation never surfaces. Nothing
// watched the watchers.
//
// This is DELIBERATELY lighter than persistAgentRun: it inserts ONE agent_runs
// row and nothing else. persistAgentRun also emits quests / KPIs /
// briefing_items, which for these agents would duplicate the intelligence they
// already push into the snapshot. Here we only want a heartbeat: "did this
// agent run, when, and did it succeed."
//
// Requires the agent_slug to be in the agent_runs CHECK (migration_106).
// Fails soft: a logging failure never breaks the agent it is observing.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../supabase.js';

/**
 * Insert a single agent_runs heartbeat row.
 *
 * @param {object} o
 * @param {string} o.tenantId    - tenant uuid (required)
 * @param {string} o.agentSlug   - must be in the agent_runs CHECK list (required)
 * @param {string} [o.trigger]   - 'cron_daily' | 'manual' | 'api' (default 'cron_daily')
 * @param {string} [o.status]    - 'success' | 'partial' | 'error' (default 'success')
 * @param {string} [o.summary]   - short human line for the run
 * @param {string} [o.error]     - error message when status != success
 * @param {number} [o.startedAt] - ms epoch the run began (default: now)
 * @param {object} [o.output]    - optional small JSON payload to store
 * @returns {Promise<{ runId: string|null, error?: string }>}
 */
export async function logAgentRun(o) {
  const {
    tenantId,
    agentSlug,
    trigger = 'cron_daily',
    status = 'success',
    summary = null,
    error = null,
    startedAt = Date.now(),
    output = null,
  } = o || {};

  if (!tenantId || !agentSlug) {
    // Do not throw: observability must never break the observed agent.
    console.error(`[logAgentRun] missing ${!tenantId ? 'tenantId' : 'agentSlug'} - skipping run log`);
    return { runId: null, error: 'missing tenantId or agentSlug' };
  }

  try {
    // Inside the try: an invalid `startedAt` would make .toISOString() throw a
    // RangeError, and this function's contract is that it NEVER throws (callers
    // await it right before res.json with no surrounding catch).
    const startedIso = new Date(startedAt).toISOString();
    const completedIso = new Date().toISOString();
    const ins = await supabaseAdmin
      .from('agent_runs')
      .insert({
        tenant_id: tenantId,
        agent_slug: agentSlug,
        trigger,
        started_at: startedIso,
        completed_at: completedIso,
        status,
        summary: summary ? String(summary).slice(0, 500) : null,
        error_message: error ? String(error).slice(0, 1000) : null,
        output: output || null,
        duration_ms: Date.parse(completedIso) - Date.parse(startedIso),
      })
      .select('id')
      .single();

    if (ins.error) {
      // The CHECK-constraint silent-drop failure mode shows up here as a real
      // error now (insert returns it), so log it loudly instead of vanishing.
      console.error(`[logAgentRun] agent_runs insert failed for ${agentSlug}: ${ins.error.message}`);
      return { runId: null, error: ins.error.message };
    }
    return { runId: ins.data.id };
  } catch (e) {
    console.error(`[logAgentRun] threw for ${agentSlug}: ${e.message}`);
    return { runId: null, error: e.message };
  }
}
