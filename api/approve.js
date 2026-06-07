// Approval EXECUTOR — the missing piece in the chat approval loop.
//
// router.js creates a pending_approvals row (status:'pending', execute_payload).
// approvals.js PATCH only flips the status flag. NOTHING was reading execute_payload
// to actually perform the action, so every approval-gated write (send_email, etc.)
// was orphaned and never executed. chat.js's approve_action / batch_approve tools
// POST here expecting { status, execution:{ executed, details } } back.
//
// This handler looks up the approval by code, executes the underlying action from
// execute_payload, flips status, and stores execution_result.
//
// Auth: resolveSession — accepts a real portal session OR RYUJIN_SERVICE_TOKEN
// (synthetic admin). chat.js calls server-to-server with the service token +
// x-tenant-id (the service-token branch needs the tenant header to resolve).

import { supabaseAdmin } from '../lib/supabase.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';
import { gmailSend } from '../lib/google.js';

// Dispatch an approved action by its execute_payload.tool. Returns
// { executed:true, details } on success or { executed:false, error } otherwise.
// Throwing is caught by the caller and treated as a failed (non-executed) attempt.
export async function executePayload(payload, ctx = {}) {
  const tool = payload && payload.tool;
  switch (tool) {
    case 'send_email': {
      const { to, subject, body, cc, threadId } = payload;
      if (!to || !subject) return { executed: false, error: 'send_email payload missing to/subject' };
      await gmailSend(to, subject, body || '', { cc, threadId });
      return { executed: true, details: `Email sent to ${to}` };
    }
    case 'create_ticket': {
      const { title, description, priority, tags } = payload;
      if (!title) return { executed: false, error: 'create_ticket payload missing title' };
      if (!ctx.tenant_id) return { executed: false, error: 'create_ticket missing tenant context' };
      // `assignedTo` in the payload is a display name, not a users.id (uuid) -> leave unassigned.
      // Drop the internal 'quest' tag; keep real category tags.
      const cleanTags = Array.isArray(tags) ? tags.filter(t => t && t !== 'quest') : null;
      const { data, error } = await supabaseAdmin.from('tickets').insert({
        tenant_id: ctx.tenant_id,
        title,
        description: description || null,
        priority: priority || 'medium',
        status: 'open',
        tags: cleanTags && cleanTags.length ? cleanTags : null
      }).select('ticket_number').single();
      if (error) return { executed: false, error: `create_ticket failed: ${error.message}` };
      return { executed: true, details: `Ticket #${data.ticket_number} created: ${title}` };
    }
    default:
      // Other write tools route through approval but have no executor wired here yet.
      // Be honest rather than claim success.
      return { executed: false, error: `No executor wired for '${tool || 'unknown'}'` };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id, x-ryujin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  // Executing an approval performs a real write (send email, etc.) -> owner/admin only.
  // chat.js calls with RYUJIN_SERVICE_TOKEN, which resolves to an admin session.
  if (!isPrivileged(session)) return res.status(403).json({ error: 'admin_only', code: 'FORBIDDEN' });

  const { code, response } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code required' });
  const upper = String(code).toUpperCase();

  // decided_by must be a real users.id (uuid). The service token resolves to the
  // synthetic 'service-internal' id which is not a uuid, so store null in that case.
  const decidedBy = session.user_id && session.user_id !== 'service-internal' ? session.user_id : null;

  const { data: row, error: readErr } = await supabaseAdmin
    .from('pending_approvals')
    .select('*')
    .eq('tenant_id', session.tenant_id)
    .eq('code', upper)
    .maybeSingle();
  if (readErr) return res.status(500).json({ error: readErr.message });
  if (!row) return res.status(404).json({ error: 'Approval not found', code: upper });

  // Idempotent: already decided -> report, don't re-execute.
  if (row.status !== 'pending') {
    return res.json({
      status: row.status,
      code: upper,
      execution: { executed: false, details: `Already ${row.status}` }
    });
  }

  const decided_at = new Date().toISOString();

  // Reject path.
  const wantApprove = !response || /^(approve|approved|yes|confirm|confirmed|go)$/i.test(String(response));
  if (!wantApprove) {
    await supabaseAdmin.from('pending_approvals')
      .update({ status: 'rejected', decided_at, decided_by_user_id: decidedBy })
      .eq('id', row.id);
    return res.json({ status: 'rejected', code: upper, execution: { executed: false, details: 'Rejected' } });
  }

  // Atomically CLAIM the row before executing, so a concurrent/retried confirmation
  // can't double-send. The conditional .eq('status','pending') means only one caller
  // wins the flip to 'approved'; the loser gets 0 rows back and bails without executing.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('pending_approvals')
    .update({ status: 'approved', decided_at, decided_by_user_id: decidedBy })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id');
  if (claimErr) return res.status(500).json({ error: claimErr.message });
  if (!claimed || claimed.length === 0) {
    // Another request claimed it first (race) — do not execute again.
    return res.json({ status: 'approved', code: upper, execution: { executed: false, details: 'Already being processed' } });
  }

  // We own the row now. Execute the underlying action.
  let exec;
  try {
    exec = await executePayload(row.execute_payload || {}, { tenant_id: row.tenant_id });
  } catch (e) {
    exec = { executed: false, error: e && e.message ? e.message : String(e) };
  }

  if (exec.executed) {
    await supabaseAdmin.from('pending_approvals')
      .update({ execution_result: exec })
      .eq('id', row.id);
    return res.json({ status: 'approved', code: upper, execution: { executed: true, details: exec.details } });
  }

  // Execution failed (or no executor wired) -> revert to pending so it can be retried,
  // and surface the error. (Reverting re-opens the claim only for a future sequential retry.)
  await supabaseAdmin.from('pending_approvals')
    .update({ status: 'pending', decided_at: null, decided_by_user_id: null, execution_result: exec })
    .eq('id', row.id);
  return res.status(200).json({
    status: 'pending',
    code: upper,
    execution: { executed: false, details: `Not executed: ${exec.error || 'unknown'}` },
    error: exec.error || 'execution failed'
  });
}
