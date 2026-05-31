// ═══════════════════════════════════════════════════════════════
// PRODUCTION PIPELINE AGENT -- Derives each job's pipeline stage
// from artifacts discovered across OneDrive / Google Drive / GHL /
// Obsidian / Ryujin, and surfaces stage-transition SUGGESTIONS for
// human confirmation. Never silently mutates job_folders.current_stage.
//
// Source of truth: per-job folders in Plus Ultra/Jobs/<street>/. The
// agent reads from job_artifacts (already populated by feeder syncs),
// applies deterministic rules, and writes pipeline_suggestions rows
// when the derived stage differs from the current stage.
//
// Schedule: cron entry in vercel.json (off by default; opt-in per
// tenant via tenant_settings.production_agent_enabled). Also callable
// on-demand at GET /api/agents/production.
//
// Stage derivation rules (highest-priority match wins):
//   warranty pdf present                              → completed
//   workorders.completed_at is set                    → completed
//   ghl invoice marked paid                           → paid
//   work_order pdf present OR start_date passed       → in_progress
//   work_order pdf present AND start_date future      → scheduled
//   estimates.accepted_at set OR contract pdf present → accepted
//   proposal pdf present                              → proposal_sent
//   cover/before photo only, nothing else             → prospect
//   no artifacts for 60+ days                         → cold
//   nothing matches                                   → unknown
//
// Per project_job_folders_source_of_truth memory + reference_manus
// _audit_loop (deterministic rules first; LLM only for genuine
// ambiguity, future work).
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../../lib/supabase.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';

const PLUS_ULTRA_SLUG = 'plus-ultra';
const COLD_AFTER_DAYS = 60;
const STAGE_PRIORITY = [
  'unknown', 'prospect', 'proposal_sent', 'accepted',
  'scheduled', 'in_progress', 'completed', 'paid', 'lost', 'cold'
];

// ─── address normalization (also called by /api/job-folder-sync) ─────
// Canonical key for deduping the same job across OneDrive / Drive / GHL.
// Lowercase, strip common street-type suffixes, drop city/province/postal.
const STREET_SUFFIXES = [
  'drive','dr','street','st','avenue','ave','road','rd','court','ct',
  'crescent','cres','lane','ln','boulevard','blvd','way','place','pl',
  'highway','hwy','route','rte'
];
export function normalizeAddress(raw) {
  if (!raw) return '';
  let s = String(raw).toLowerCase();
  s = s.split(',')[0];                                  // drop city/province/postal
  s = s.replace(/\s+/g, ' ').trim();
  // Suffix-strip only the LAST token, never a middle/start token. This
  // prevents the regex from eating 'st' out of '1st Ave' (which contains
  // the substring 'st' but isn't a street suffix). Each iteration may
  // expose a new last-token if a compound suffix existed (e.g. trailing
  // period), so loop until stable.
  for (let i = 0; i < 3; i++) {
    const tokens = s.split(' ');
    const last = (tokens[tokens.length - 1] || '').replace(/\.$/, '');
    if (STREET_SUFFIXES.includes(last)) {
      tokens.pop();
      s = tokens.join(' ').trim();
    } else break;
  }
  return s.replace(/\s+/g, ' ').trim();
}

// ─── deterministic stage derivation ──────────────────────────────────
// Returns { stage, reasoning, evidence } where evidence is an array of
// { artifact_id, fact } pairs the human reviewer can audit.
export function deriveStage({ artifacts, estimate, workorder, ghlInvoice }) {
  const ev = [];
  const has = (kind) => artifacts.find(a => a.artifact_kind === kind);

  // completed: warranty PDF OR workorder.completed_at
  const warranty = has('warranty');
  if (warranty) {
    ev.push({ artifact_id: warranty.id, fact: `warranty pdf present (${warranty.file_name || warranty.source_path})` });
    return { stage: 'completed', reasoning: 'Warranty PDF present in job folder.', evidence: ev };
  }
  if (workorder && workorder.completed_at) {
    ev.push({ artifact_id: null, fact: `workorders.completed_at = ${workorder.completed_at}` });
    return { stage: 'completed', reasoning: 'Linked workorder has completed_at stamped.', evidence: ev };
  }

  // paid: ghl invoice paid
  if (ghlInvoice && ghlInvoice.status === 'paid') {
    ev.push({ artifact_id: ghlInvoice.artifact_id || null, fact: `ghl invoice ${ghlInvoice.id} status=paid` });
    return { stage: 'paid', reasoning: 'GHL invoice marked paid.', evidence: ev };
  }

  // scheduled vs in_progress: work order pdf present
  const wo = has('work_order');
  if (wo) {
    ev.push({ artifact_id: wo.id, fact: `work order pdf present (${wo.file_name || wo.source_path})` });
    const startDate = workorder?.start_date ? new Date(workorder.start_date) : null;
    if (startDate && startDate < new Date()) {
      return { stage: 'in_progress', reasoning: `Work order present and start_date ${workorder.start_date} has passed.`, evidence: ev };
    }
    return { stage: 'scheduled', reasoning: 'Work order PDF present; start_date is future or unset.', evidence: ev };
  }

  // accepted: estimates.accepted_at OR contract pdf
  if (estimate && estimate.accepted_at) {
    ev.push({ artifact_id: null, fact: `estimate ${estimate.id} accepted_at = ${estimate.accepted_at}` });
    return { stage: 'accepted', reasoning: 'Linked estimate has accepted_at stamped.', evidence: ev };
  }
  const contract = has('contract');
  if (contract) {
    ev.push({ artifact_id: contract.id, fact: `contract pdf present (${contract.file_name})` });
    return { stage: 'accepted', reasoning: 'Contract PDF present in job folder.', evidence: ev };
  }

  // proposal_sent: proposal pdf
  const proposal = has('proposal');
  if (proposal) {
    ev.push({ artifact_id: proposal.id, fact: `proposal pdf present (${proposal.file_name})` });
    return { stage: 'proposal_sent', reasoning: 'Proposal PDF present; no contract/acceptance signal yet.', evidence: ev };
  }

  // prospect: only cover/before/photos
  const cover = has('cover_photo') || has('before_photo');
  if (cover) {
    ev.push({ artifact_id: cover.id, fact: `cover/before photo only (${cover.file_name})` });
    return { stage: 'prospect', reasoning: 'Only a cover/before photo present; no proposal yet.', evidence: ev };
  }

  // cold: no artifacts touched in COLD_AFTER_DAYS
  const newestMtime = artifacts.reduce((max, a) => {
    const t = a.mtime ? new Date(a.mtime).getTime() : 0;
    return t > max ? t : max;
  }, 0);
  if (newestMtime > 0) {
    const daysOld = Math.floor((Date.now() - newestMtime) / 86400000);
    if (daysOld > COLD_AFTER_DAYS) {
      ev.push({ artifact_id: null, fact: `newest artifact is ${daysOld}d old (threshold ${COLD_AFTER_DAYS})` });
      return { stage: 'cold', reasoning: `No artifact activity in ${daysOld} days.`, evidence: ev };
    }
  }

  return { stage: 'unknown', reasoning: 'No artifacts match any stage rule.', evidence: ev };
}

// ─── main runner ─────────────────────────────────────────────────────
export async function runProduction({ tenantSlug = PLUS_ULTRA_SLUG } = {}) {
  const report = {
    agent: 'Production',
    role: 'Pipeline Stage Propagation',
    timestamp: new Date().toISOString(),
    tenant: tenantSlug,
    jobs_scanned: 0,
    suggestions_emitted: 0,
    stages_unchanged: 0,
    by_suggested_stage: {},
    errors: [],
  };

  const { data: tenant, error: tErr } = await supabaseAdmin
    .from('tenants').select('id').eq('slug', tenantSlug).maybeSingle();
  if (tErr || !tenant) {
    report.errors.push(`tenant lookup failed: ${tErr?.message || 'not found'}`);
    return report;
  }
  const tid = tenant.id;
  report.tenant_id = tid; // surfaced so the handler can write an agent_runs row

  const { data: settings } = await supabaseAdmin
    .from('tenant_settings').select('production_agent_enabled').eq('tenant_id', tid).maybeSingle();
  if (!settings?.production_agent_enabled) {
    report.disabled = true;
    report.note = `tenant_settings.production_agent_enabled is false for ${tenantSlug} (opt-in; flip the flag to activate)`;
    return report;
  }

  // Pull all job folders + their artifacts + linked estimate/workorder
  const { data: folders, error: fErr } = await supabaseAdmin
    .from('job_folders')
    .select('id, address, address_key, customer_name, current_stage, linked_estimate_id, linked_workorder_id, linked_ghl_contact_id')
    .eq('tenant_id', tid);
  if (fErr) {
    report.errors.push(`job_folders read failed: ${fErr.message}`);
    return report;
  }

  for (const folder of folders || []) {
    report.jobs_scanned += 1;
    try {
      const { data: artifacts } = await supabaseAdmin
        .from('job_artifacts')
        .select('id, source, artifact_kind, file_name, source_path, mtime, raw_meta')
        .eq('tenant_id', tid)
        .eq('job_folder_id', folder.id)
        .order('mtime', { ascending: false, nullsFirst: false });

      let estimate = null;
      if (folder.linked_estimate_id) {
        const { data } = await supabaseAdmin
          .from('estimates').select('id, accepted_at').eq('id', folder.linked_estimate_id).maybeSingle();
        estimate = data;
      }
      let workorder = null;
      if (folder.linked_workorder_id) {
        const { data } = await supabaseAdmin
          .from('workorders').select('id, status, completed_at, start_date').eq('id', folder.linked_workorder_id).maybeSingle();
        workorder = data;
      }
      // Resolve ghlInvoice from artifacts (populated by api/feeders/ghl-job-artifacts.js).
      // Pick the most recently updated invoice with a paid-ish status if present;
      // otherwise the most recent invoice regardless of status. Falls through to null.
      const invoiceArtifacts = (artifacts || []).filter(a => a.artifact_kind === 'invoice');
      const paidInv = invoiceArtifacts.find(a => /^paid$/i.test(a.raw_meta?.status || ''));
      const ghlInvoice = paidInv
        ? { id: paidInv.raw_meta?.ghl_invoice_id, status: 'paid', artifact_id: paidInv.id }
        : (invoiceArtifacts[0] ? { id: invoiceArtifacts[0].raw_meta?.ghl_invoice_id, status: invoiceArtifacts[0].raw_meta?.status || 'unknown', artifact_id: invoiceArtifacts[0].id } : null);

      const { stage, reasoning, evidence } = deriveStage({ artifacts: artifacts || [], estimate, workorder, ghlInvoice });

      if (stage === folder.current_stage) {
        report.stages_unchanged += 1;
        continue;
      }

      // Don't emit a duplicate pending suggestion if one already exists for this folder/stage
      const { data: existing } = await supabaseAdmin
        .from('pipeline_suggestions')
        .select('id, suggested_stage, status')
        .eq('job_folder_id', folder.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1);
      if (existing && existing[0] && existing[0].suggested_stage === stage) {
        report.stages_unchanged += 1;
        continue;
      }

      const { error: insErr } = await supabaseAdmin.from('pipeline_suggestions').insert({
        tenant_id: tid,
        job_folder_id: folder.id,
        previous_stage: folder.current_stage,
        suggested_stage: stage,
        reasoning,
        evidence,
      });
      if (insErr) {
        // Postgres 23505 = unique_violation. The partial unique index
        // on (job_folder_id, suggested_stage) WHERE status='pending'
        // catches a concurrent run that beat us to the insert. Treat
        // as a benign no-op, not an error.
        if (insErr.code === '23505') {
          report.stages_unchanged += 1;
          continue;
        }
        report.errors.push(`insert failed for ${folder.address}: ${insErr.message}`);
        continue;
      }

      report.suggestions_emitted += 1;
      report.by_suggested_stage[stage] = (report.by_suggested_stage[stage] || 0) + 1;
    } catch (e) {
      report.errors.push(`${folder.address}: ${e.message}`);
    }
  }

  return report;
}

// ─── HANDLER (on-demand + cron entry point) ──────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }
  const auth = requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const tenantSlug = (req.query?.tenant || req.headers['x-tenant-id'] || PLUS_ULTRA_SLUG).toString();
  // Only the Vercel cron authenticates via the injected Bearer CRON_SECRET;
  // every owner trigger (the admin "re-run now" sends a GET with x-owner-call,
  // or a POST) is manual. Distinguish by the auth result, not the HTTP method,
  // so operator reruns are not mislabeled as the scheduled cron. Value must
  // match the agent_runs.trigger CHECK ('cron_daily' | 'manual').
  const trigger = auth.via === 'cron-secret' ? 'cron_daily' : 'manual';
  const startTime = Date.now();

  try {
    const report = await runProduction({ tenantSlug });

    // Observability: production used to write NO agent_runs row, so the 30-min
    // cron was invisible to admin-cron-health + any monitoring (the only blind
    // agent). Record one terminal-status row per invocation. A single terminal
    // row (vs running -> success) is deliberate: runProduction completes
    // synchronously, so there is no in-flight state to watch, and it avoids
    // orphaned 'running' rows if the function ever times out mid-scan.
    // Skip only when the tenant is disabled, mirroring reconcile's skip.
    let runId = null;
    if (report.tenant_id && !report.disabled) {
      const hadErrors = report.errors && report.errors.length;
      const { data: run, error: runErr } = await supabaseAdmin
        .from('agent_runs')
        .insert({
          tenant_id: report.tenant_id, agent_slug: 'production', trigger,
          status: hadErrors ? 'error' : 'success',
          completed_at: new Date().toISOString(),
          summary: `${report.jobs_scanned} jobs scanned, ${report.suggestions_emitted} new suggestions`,
          output: report,
          error_message: hadErrors ? String(report.errors.join('; ')).slice(0, 500) : null,
          duration_ms: Date.now() - startTime,
        }).select('id').single();
      if (runErr) console.error('production: agent_runs insert failed:', runErr.message);
      runId = run?.id || null;
    }

    return res.json({
      agent: 'production',
      role: 'Pipeline Stage Propagation',
      invocation: req.method === 'GET' ? 'on-demand' : 'cron',
      timestamp: new Date().toISOString(),
      run_id: runId,
      data: report,
      errors: report.errors,
    });
  } catch (err) {
    console.error('[Production] FAILED:', err.message);
    // Best-effort error row so a hard failure is still visible in the run trail.
    try {
      const { data: tn } = await supabaseAdmin.from('tenants').select('id').eq('slug', tenantSlug).maybeSingle();
      if (tn?.id) {
        await supabaseAdmin.from('agent_runs').insert({
          tenant_id: tn.id, agent_slug: 'production', trigger,
          status: 'error', completed_at: new Date().toISOString(),
          error_message: String(err.message).slice(0, 500), duration_ms: Date.now() - startTime,
        });
      }
    } catch { /* ignore */ }
    return res.status(500).json({ agent: 'production', error: err.message });
  }
}
