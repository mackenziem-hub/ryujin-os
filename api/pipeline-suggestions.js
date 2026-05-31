// ═══════════════════════════════════════════════════════════════
// /api/pipeline-suggestions -- list pending + resolve.
//
//   GET  /api/pipeline-suggestions?tenant=plus-ultra[&status=pending]
//        → { suggestions: [...] } with job + artifact context
//
//   PATCH /api/pipeline-suggestions?id=<uuid>
//        body: { action: 'confirm' | 'correct' | 'dismiss', stage?: string }
//        action=confirm  → applies suggested_stage to job_folders.current_stage
//        action=correct  → applies body.stage (must be valid enum), records on row
//        action=dismiss  → marks suggestion dismissed, no folder write
//
// Auth: portal session (admin/owner) for both verbs. The agent NEVER calls
// this endpoint -- it inserts pending rows directly. Resolution is human-only.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { resolveSession } from '../lib/portalAuth.js';

const VALID_STAGES = new Set([
  'unknown', 'prospect', 'proposal_sent', 'accepted',
  'scheduled', 'in_progress', 'completed', 'paid', 'lost', 'cold'
]);

// Stages the production agent derives ONLY from hard artifacts (warranty PDF,
// workorders.completed_at, a paid GHL invoice), so they are safe to auto-confirm
// in bulk. Inferred stages (prospect/proposal_sent/accepted/scheduled/cold) stay
// human-confirmed. Bulk-confirm only ever touches folders still at 'unknown', so
// it can never regress a folder that already advanced.
const SAFE_AUTO_STAGES = new Set(['completed', 'paid']);

export default async function handler(req, res) {
  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required' });
  if (!['owner', 'admin'].includes(session.role)) {
    return res.status(403).json({ error: 'admin only' });
  }

  if (req.method === 'GET') return list(req, res, session);
  if (req.method === 'PATCH') {
    // Bulk safe-confirm (no id): confirm every pending factual-terminal suggestion
    // on a still-'unknown' folder in one call. Single-id resolve otherwise.
    if (req.body?.action === 'confirm_safe' && !req.query.id) return bulkConfirmSafe(req, res, session);
    return resolve(req, res, session);
  }
  return res.status(405).json({ error: 'GET or PATCH only' });
}

const VALID_STATUSES = new Set(['pending', 'confirmed', 'corrected', 'dismissed', 'expired']);

async function list(req, res, session) {
  const status = (req.query.status || 'pending').toString();
  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: `invalid status "${status}"; valid: ${[...VALID_STATUSES].join(', ')}` });
  }
  const { data, error } = await supabaseAdmin
    .from('pipeline_suggestions')
    .select(`
      id, suggested_stage, previous_stage, reasoning, evidence, status,
      confirmed_stage, created_at, resolved_at,
      job_folder:job_folders!pipeline_suggestions_job_folder_id_fkey(
        id, address, customer_name, current_stage,
        linked_estimate_id, linked_workorder_id
      )
    `)
    .eq('tenant_id', session.tenant_id)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ suggestions: data || [] });
}

async function resolve(req, res, session) {
  const id = (req.query.id || '').toString();
  if (!id) return res.status(400).json({ error: 'id query param required' });
  const action = (req.body?.action || '').toString();
  if (!['confirm', 'correct', 'dismiss'].includes(action)) {
    return res.status(400).json({ error: 'action must be confirm|correct|dismiss' });
  }

  const { data: suggestion, error: sErr } = await supabaseAdmin
    .from('pipeline_suggestions')
    .select('id, tenant_id, job_folder_id, suggested_stage, status')
    .eq('id', id).maybeSingle();
  if (sErr || !suggestion) return res.status(404).json({ error: 'suggestion not found' });
  if (suggestion.tenant_id !== session.tenant_id) return res.status(403).json({ error: 'cross-tenant' });
  if (suggestion.status !== 'pending') return res.status(400).json({ error: `already ${suggestion.status}` });

  let appliedStage = null;
  if (action === 'confirm') {
    appliedStage = suggestion.suggested_stage;
  } else if (action === 'correct') {
    const corrected = (req.body?.stage || '').toString();
    if (!VALID_STAGES.has(corrected)) {
      return res.status(400).json({ error: `invalid stage "${corrected}"; valid: ${[...VALID_STAGES].join(', ')}` });
    }
    appliedStage = corrected;
  }

  // Update the suggestion row first
  const newStatus = action === 'confirm' ? 'confirmed' : action === 'correct' ? 'corrected' : 'dismissed';
  const { error: upErr } = await supabaseAdmin
    .from('pipeline_suggestions')
    .update({
      status: newStatus,
      confirmed_stage: appliedStage,
      resolved_at: new Date().toISOString(),
      resolved_by: session.user_id,
    })
    .eq('id', id);
  if (upErr) return res.status(500).json({ error: `suggestion update failed: ${upErr.message}` });

  // If confirm/correct, write the stage to job_folders
  if (appliedStage) {
    const { error: fErr } = await supabaseAdmin
      .from('job_folders')
      .update({
        current_stage: appliedStage,
        stage_confirmed_at: new Date().toISOString(),
        stage_confirmed_by: session.user_id,
      })
      .eq('id', suggestion.job_folder_id);
    if (fErr) return res.status(500).json({ error: `folder update failed: ${fErr.message}` });
  }

  return res.json({ ok: true, action, applied_stage: appliedStage });
}

async function bulkConfirmSafe(req, res, session) {
  const { data: pend, error } = await supabaseAdmin
    .from('pipeline_suggestions')
    .select(`id, job_folder_id, suggested_stage,
      job_folder:job_folders!pipeline_suggestions_job_folder_id_fkey(current_stage)`)
    .eq('tenant_id', session.tenant_id)
    .eq('status', 'pending')
    .in('suggested_stage', [...SAFE_AUTO_STAGES]);
  if (error) return res.status(500).json({ error: error.message });

  const now = new Date().toISOString();
  let confirmed = 0, skipped = 0;
  const byStage = {};
  for (const s of (pend || [])) {
    // No-regress guard: only unfreeze folders still at 'unknown'.
    if (!s.job_folder || s.job_folder.current_stage !== 'unknown') { skipped++; continue; }
    // 1) CLAIM the suggestion atomically: flip pending -> confirmed and require a
    //    returned row. If another admin/process resolved it (dismiss/confirm/correct)
    //    in the meantime, we match 0 rows and skip BEFORE touching the folder -- so a
    //    no-longer-pending suggestion can never advance a folder here.
    const { data: claimed, error: upErr } = await supabaseAdmin
      .from('pipeline_suggestions')
      .update({ status: 'confirmed', confirmed_stage: s.suggested_stage, resolved_at: now, resolved_by: session.user_id })
      .eq('id', s.id).eq('status', 'pending')
      .select('id');
    if (upErr) { skipped++; continue; }
    if (!claimed || !claimed.length) { skipped++; continue; } // lost the claim race
    // 2) We own the resolution: advance the folder if it is still 'unknown'
    //    (no-regress, race-safe). If it already advanced (a duplicate safe
    //    suggestion or another process), the claimed suggestion is still validly
    //    confirmed and the folder is already past 'unknown', so nothing is stuck.
    const { error: fErr } = await supabaseAdmin
      .from('job_folders')
      .update({ current_stage: s.suggested_stage, stage_confirmed_at: now, stage_confirmed_by: session.user_id })
      .eq('id', s.job_folder_id).eq('current_stage', 'unknown');
    if (fErr) {
      // Hard folder-write failure after we claimed: roll the claim back to pending
      // so it is retried, rather than leaving a confirmed-but-unapplied suggestion.
      // If the rollback itself fails (e.g. a duplicate pending row appeared in the
      // claim window), log it: the production agent re-derives the terminal stage
      // from the unchanged artifact (completed_at / paid invoice) on its next run
      // and re-suggests, so the folder self-heals rather than staying stuck.
      const { error: rbErr } = await supabaseAdmin.from('pipeline_suggestions')
        .update({ status: 'pending', confirmed_stage: null, resolved_at: null, resolved_by: null })
        .eq('id', s.id);
      if (rbErr) console.error('bulkConfirmSafe rollback failed for', s.id, '-', rbErr.message, '(self-heals on next agent run)');
      skipped++;
      continue;
    }
    confirmed++;
    byStage[s.suggested_stage] = (byStage[s.suggested_stage] || 0) + 1;
  }
  return res.json({ ok: true, confirmed, skipped, by_stage: byStage });
}
