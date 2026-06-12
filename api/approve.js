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

// External write surfaces the executors call. These mirror the exact paths the
// chat.js tools + operator pages already use (Estimator OS REST for estimates,
// the deployed /api/ghl proxy for CRM notes); no new write path is invented.
const ESTIMATOR_URL = 'https://estimator-os.replit.app/api';
const ESTIMATOR_KEY = (process.env.ESTIMATOR_KEY || '').trim();
const RYUJIN_BASE = 'https://ryujin-os.vercel.app';
const SERVICE_TOKEN = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();

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
      // Insert succeeded; tolerate a missing returned row number rather than throw (which
      // would falsely revert the row to pending and re-queue an already-created ticket).
      const num = data && data.ticket_number;
      return { executed: true, details: `Ticket ${num ? '#' + num : ''} created: ${title}`.replace('  ', ' ') };
    }
    case 'create_estimate': {
      // chat.js create_estimate + the create_full_estimate chain both register
      // { tool:'create_estimate', payload:<full Estimator OS estimate> }.
      // Create it in Estimator OS, the same REST surface the operator uses.
      if (!ESTIMATOR_KEY) return { executed: false, error: 'create_estimate: ESTIMATOR_KEY not configured' };
      const estimate = payload && payload.payload;
      if (!estimate || !estimate.customer) return { executed: false, error: 'create_estimate payload missing estimate body' };
      const r = await fetch(`${ESTIMATOR_URL}/estimates`, {
        method: 'POST',
        headers: { 'x-api-key': ESTIMATOR_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(estimate),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        return { executed: false, error: `create_estimate failed: HTTP ${r.status} ${t.slice(0, 140)}` };
      }
      const data = await r.json().catch(() => null);
      const id = data && (data.id || data.estimateId || (data.estimate && data.estimate.id));
      const who = (estimate.customer && estimate.customer.fullName) || 'customer';
      return { executed: true, details: `Estimate created for ${who}${id ? ` (#${id})` : ''}` };
    }
    case 'update_estimate': {
      // { tool:'update_estimate', estimate_id, updates }. PUT to Estimator OS,
      // the same path api/agents/cashflow.js uses to patch estimate fields.
      if (!ESTIMATOR_KEY) return { executed: false, error: 'update_estimate: ESTIMATOR_KEY not configured' };
      const { estimate_id, updates } = payload;
      if (!estimate_id) return { executed: false, error: 'update_estimate payload missing estimate_id' };
      if (!updates || typeof updates !== 'object' || !Object.keys(updates).length) {
        return { executed: false, error: 'update_estimate payload missing updates' };
      }
      const r = await fetch(`${ESTIMATOR_URL}/estimates/${encodeURIComponent(estimate_id)}`, {
        method: 'PUT',
        headers: { 'x-api-key': ESTIMATOR_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        return { executed: false, error: `update_estimate failed: HTTP ${r.status} ${t.slice(0, 140)}` };
      }
      return { executed: true, details: `Estimate #${estimate_id} updated: ${Object.keys(updates).join(', ')}` };
    }
    case 'add_contact_note': {
      // { tool:'add_contact_note', contactId, noteText }. Write through the
      // deployed /api/ghl proxy (default POST = add note), the same surface the
      // operator CRM pages call. Server-to-server with the service token.
      const contactId = payload.contactId;
      const noteText = payload.noteText;
      if (!contactId) return { executed: false, error: 'add_contact_note payload missing contactId' };
      if (!noteText) return { executed: false, error: 'add_contact_note payload missing noteText' };
      const r = await fetch(`${RYUJIN_BASE}/api/ghl?id=${encodeURIComponent(contactId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': 'plus-ultra',
          ...(SERVICE_TOKEN ? { Authorization: `Bearer ${SERVICE_TOKEN}` } : {}),
        },
        body: JSON.stringify({ body: noteText }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        return { executed: false, error: `add_contact_note failed: HTTP ${r.status} ${t.slice(0, 140)}` };
      }
      return { executed: true, details: `Note added to contact ${contactId}` };
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
