// ═══════════════════════════════════════════════════════════════
// RYUJIN RECONCILIATION AGENT - the cross-system revenue truth check.
//
// Reads estimates + workorders + paysheets + customers, runs the pure engine
// (lib/reconcile.js), and persists the drift findings so the cockpit can stop
// quoting a single-system number that lies. It answers "what signed work is my
// software blind to, and what one-tap fix closes each gap".
//
// Design guarantees (mirrors questscan):
//   - READ-ONLY on business data. It writes ONLY to reconciliation_findings +
//     agent_runs. It never edits an estimate, customer, or dollar. The fixes it
//     proposes are executed later, with approval, by Slice 2.
//   - IDEMPOTENT: every finding carries a deterministic dedup_key (kind:target).
//     A second run updates the existing row, never duplicates it.
//   - SELF-CLEANING: a finding whose condition has cleared (someone backfilled
//     the dollar, fixed the estimate) is auto-resolved on the next clean run.
//     Auto-resolve only runs when the scan itself succeeded, so a fetch error
//     can never mass-resolve real findings.
//   - SAFE: dormant until tenant_settings.reconcile_agent_enabled is true, and
//     ?dry=1 returns the full reconciliation without writing anything.
//
// Schedule: daily via vercel cron (/api/agents/reconcile?tenant=plus-ultra).
// Preview:  GET ?tenant=plus-ultra&dry=1  -> figures + findings, no writes.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../../lib/supabase.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { reconcile } from '../../lib/reconcile.js';
import { fetchWonOpportunities, crossCheckGhl } from '../../lib/ghlReconcile.js';

export const config = { maxDuration: 60 };

const normJob = (s) => String(s || '')
  .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// dedup_key: stable per logical finding. Prefer the estimate id (survives a name
// change); fall back to kind + normalized job label for the no-estimate jobs.
const dedupKey = (f) => `${f.kind}:${f.estimate_id || normJob(f.job)}`;

async function fetchData(tenantId) {
  const sel = (table, cols) => supabaseAdmin.from(table).select(cols).eq('tenant_id', tenantId);
  const [est, wos, pay, cust] = await Promise.all([
    sel('estimates', 'id,estimate_number,customer_id,status,final_accepted_total,accepted_at,created_at'),
    sel('workorders', 'id,wo_number,customer_name,address,status,total_sq,linked_estimate_id,linked_paysheet_id'),
    sel('paysheets', 'id,customer_name,address,status,total,subtotal,linked_estimate_id'),
    sel('customers', 'id,full_name,address'),
  ]);
  for (const r of [est, wos, pay, cust]) if (r.error) throw new Error(r.error.message);
  return { estimates: est.data || [], workorders: wos.data || [], paysheets: pay.data || [], customers: cust.data || [] };
}

async function persistFindings(tenantId, findings) {
  const now = new Date().toISOString();
  const seen = new Set();
  let persisted = 0, skippedDismissed = 0;

  // Findings the user has DISMISSED stay dismissed — e.g. a VALUE_LOOKS_LIKE_COST
  // on a deliberate price-match (Egbuwoku) is a confirmed false positive, not a
  // gap. Never re-open them, and keep them in `seen` so the self-clean below
  // doesn't touch them either.
  const { data: dismissedRows } = await supabaseAdmin
    .from('reconciliation_findings')
    .select('dedup_key').eq('tenant_id', tenantId).eq('status', 'dismissed');
  const dismissed = new Set((dismissedRows || []).map((r) => r.dedup_key));

  for (const f of findings) {
    const key = dedupKey(f);
    seen.add(key);
    if (dismissed.has(key)) { skippedDismissed++; continue; } // honor the user's dismissal
    const row = {
      tenant_id: tenantId, dedup_key: key, kind: f.kind, job: f.job,
      detail: f.detail, proposed_fix: f.proposed_fix,
      dollar_impact: f.dollar_impact ?? null,
      estimate_id: f.estimate_id || null,
      status: 'open', updated_at: now,
      metadata: { sub_cost_floor: f.sub_cost_floor ?? null },
    };
    // upsert on (tenant_id, dedup_key); re-open a previously resolved one if it recurs
    const { error } = await supabaseAdmin
      .from('reconciliation_findings')
      .upsert(row, { onConflict: 'tenant_id,dedup_key' });
    if (error) throw new Error(`persist ${key}: ${error.message}`);
    persisted++;
  }

  // Self-clean: auto-resolve open findings not present in this (successful) run.
  const { data: open } = await supabaseAdmin
    .from('reconciliation_findings')
    .select('id,dedup_key').eq('tenant_id', tenantId).eq('status', 'open');
  const stale = (open || []).filter((r) => !seen.has(r.dedup_key)).map((r) => r.id);
  let resolved = 0;
  if (stale.length) {
    const { error } = await supabaseAdmin.from('reconciliation_findings')
      .update({ status: 'resolved', resolved_at: now, updated_at: now }).in('id', stale);
    if (!error) resolved = stale.length;
  }
  return { persisted, resolved, skippedDismissed };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const slug = (req.query.tenant || 'plus-ultra').toString().trim();
  const dry = req.query.dry === '1' || req.query.dry === 'true';
  const trigger = req.query.manual === '1' ? 'manual' : 'cron_daily'; // must match agent_runs.trigger CHECK (migration_041)
  const startTime = Date.now();

  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('id, slug').eq('slug', slug).maybeSingle();
  if (!tenant) return res.status(404).json({ error: `tenant '${slug}' not found` });

  const { data: settings } = await supabaseAdmin
    .from('tenant_settings').select('reconcile_agent_enabled').eq('tenant_id', tenant.id).maybeSingle();
  if (!settings?.reconcile_agent_enabled && !dry) {
    return res.json({ agent: 'reconcile', skipped: 'reconcile_agent_enabled is false for this tenant', tenant: slug });
  }

  let runId = null, runClosed = false;
  try {
    if (!dry) {
      const { data: run, error: runErr } = await supabaseAdmin
        .from('agent_runs')
        .insert({ tenant_id: tenant.id, agent_slug: 'reconcile', trigger, status: 'running' })
        .select('id').single();
      if (runErr) console.error('reconcile: agent_runs insert failed:', runErr.message);
      runId = run?.id || null;
    }

    const data = await fetchData(tenant.id);
    const result = reconcile(data);

    // Slice 3: widen senses — cross-check GHL won deals (graceful; null if GHL unavailable).
    const ghlWon = await fetchWonOpportunities();
    if (ghlWon) result.findings.push(...crossCheckGhl(ghlWon, result.jobs));
    result.figures.ghl_won_checked = ghlWon ? ghlWon.length : 0;

    let persistence = { persisted: 0, resolved: 0, skippedDismissed: 0 };
    if (!dry) persistence = await persistFindings(tenant.id, result.findings);

    const F = result.figures;
    const summary = `${F.committed_delivered_jobs} jobs; recorded $${F.figureA_accepted_sum.toLocaleString()}, est true ~$${F.estimated_true_committed_mid.toLocaleString()}; ${result.findings.length} findings (${F.jobs_with_no_recorded_contract_value} no-value)`;

    if (runId) {
      await supabaseAdmin.from('agent_runs').update({
        status: 'success', completed_at: new Date().toISOString(), summary,
        output: { figures: F, persistence, finding_count: result.findings.length },
        duration_ms: Date.now() - startTime,
      }).eq('id', runId);
      runClosed = true;
    }

    if (!dry) {
      try {
        const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://ryujin-os.vercel.app';
        await fetch(`${base}/api/snapshot`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reconcile: { lastRun: new Date().toISOString(), figures: F, openFindings: result.findings.length } }),
          signal: AbortSignal.timeout(10000),
        });
      } catch { /* snapshot is best-effort */ }
    }

    return res.json({ agent: 'reconcile', tenant: slug, dry, summary, figures: F, ...persistence, findings: result.findings, jobs: result.jobs });
  } catch (e) {
    if (runId && !runClosed) {
      try {
        await supabaseAdmin.from('agent_runs').update({
          status: 'error', completed_at: new Date().toISOString(),
          error_message: String(e.message).slice(0, 500), duration_ms: Date.now() - startTime,
        }).eq('id', runId);
        runClosed = true;
      } catch { /* ignore */ }
    }
    return res.status(500).json({ agent: 'reconcile', tenant: slug, error: e.message });
  }
}
