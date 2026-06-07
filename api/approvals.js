// Phase 9b: Approvals management endpoint
// GET    /api/approvals             → list pending for caller (owner sees all in tenant, others see own)
// GET    /api/approvals?status=all  → owner sees full history (pending + decided)
// PATCH  /api/approvals?code=X      → approve / reject (body: { status: 'approved'|'rejected', note?: string })
// DELETE /api/approvals?code=X      → delete (only for own pending approvals or owner)

import { supabaseAdmin } from '../lib/supabase.js';
import { executePayload } from './approve.js';

async function resolveCallerContext(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    || req.headers['x-ryujin-token']
    || req.query?.token;
  if (!token) return null;

  const { data: session } = await supabaseAdmin
    .from('sessions').select('user_id, tenant_id, expires_at').eq('token', token).single();
  if (!session || new Date(session.expires_at) < new Date()) return null;

  const { data: user } = await supabaseAdmin
    .from('users').select('id, role, role_id, name').eq('id', session.user_id).single();
  if (!user) return null;

  let roleSlug = user.role || 'crew';
  if (user.role_id) {
    const { data: roleRow } = await supabaseAdmin.from('roles').select('slug').eq('id', user.role_id).single();
    if (roleRow?.slug) roleSlug = roleRow.slug;
  }

  return { userId: user.id, tenantId: session.tenant_id, role: roleSlug, userName: user.name };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ctx = await resolveCallerContext(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET (list / single) ──
  if (req.method === 'GET') {
    if (req.query?.code) {
      const { data, error } = await supabaseAdmin
        .from('pending_approvals')
        .select('*')
        .eq('tenant_id', ctx.tenantId)
        .eq('code', String(req.query.code).toUpperCase())
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'Not found' });
      // Auth check: owner sees all, others only see own requests or assigned-to-them
      if (ctx.role !== 'owner' && data.requested_by_user_id !== ctx.userId && data.assigned_to_user_id !== ctx.userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return res.json(data);
    }

    const status = String(req.query?.status || 'pending');
    let query = supabaseAdmin
      .from('pending_approvals')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (status !== 'all') query = query.eq('status', status);
    if (ctx.role !== 'owner') {
      // Non-owners see only own requests + assigned-to-them
      query = query.or(`requested_by_user_id.eq.${ctx.userId},assigned_to_user_id.eq.${ctx.userId}`);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ approvals: data, count: data.length });
  }

  // ── PATCH (approve / reject) ──
  if (req.method === 'PATCH') {
    const code = req.query?.code ? String(req.query.code).toUpperCase() : null;
    if (!code) return res.status(400).json({ error: 'code required' });
    const { status, note } = req.body || {};
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved or rejected' });
    }

    const { data: existing, error: readErr } = await supabaseAdmin
      .from('pending_approvals')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('code', code)
      .maybeSingle();
    if (readErr) return res.status(500).json({ error: readErr.message });
    if (!existing) return res.status(404).json({ error: 'Approval not found' });
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: `Already ${existing.status}`, current: existing });
    }

    // Auth: owner can decide any; non-owner can only decide if they were the assignee
    if (ctx.role !== 'owner' && existing.assigned_to_user_id !== ctx.userId) {
      return res.status(403).json({ error: 'Only owner or assignee can decide' });
    }

    const decidedAt = new Date().toISOString();
    const decisionNote = note ? String(note).slice(0, 500) : null;

    // Reject: just flip the status.
    if (status === 'rejected') {
      const { data, error } = await supabaseAdmin
        .from('pending_approvals')
        .update({ status: 'rejected', decided_at: decidedAt, decided_by_user_id: ctx.userId, decision_note: decisionNote })
        .eq('id', existing.id).eq('status', 'pending').select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ approval: data });
    }

    // Approve: atomically CLAIM, then actually EXECUTE via the shared executor.
    // (Previously this path only flipped the flag and relied on chat.js to execute, so the
    // portal Approve button ran NOTHING - even send_email was lost. Now it runs the same
    // executePayload as api/approve.js, with the same claim + revert-on-failure semantics.)
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('pending_approvals')
      .update({ status: 'approved', decided_at: decidedAt, decided_by_user_id: ctx.userId, decision_note: decisionNote })
      .eq('id', existing.id).eq('status', 'pending').select('id');
    if (claimErr) return res.status(500).json({ error: claimErr.message });
    if (!claimed || claimed.length === 0) return res.status(409).json({ error: 'Already being processed' });

    let exec;
    try { exec = await executePayload(existing.execute_payload || {}, { tenant_id: existing.tenant_id }); }
    catch (e) { exec = { executed: false, error: e && e.message ? e.message : String(e) }; }

    if (exec.executed) {
      const { data } = await supabaseAdmin.from('pending_approvals')
        .update({ execution_result: exec }).eq('id', existing.id).select().single();
      return res.json({ approval: data, execution: { executed: true, details: exec.details } });
    }
    // Not executed (no executor wired / failed) -> revert to pending so it can be retried.
    const { data: reverted } = await supabaseAdmin.from('pending_approvals')
      .update({ status: 'pending', decided_at: null, decided_by_user_id: null, execution_result: exec })
      .eq('id', existing.id).select().single();
    return res.status(200).json({ approval: reverted, execution: { executed: false, details: 'Not executed: ' + (exec.error || 'unknown') } });
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    const code = req.query?.code ? String(req.query.code).toUpperCase() : null;
    if (!code) return res.status(400).json({ error: 'code required' });

    const { data: existing } = await supabaseAdmin
      .from('pending_approvals')
      .select('id, requested_by_user_id, status')
      .eq('tenant_id', ctx.tenantId)
      .eq('code', code)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (ctx.role !== 'owner' && existing.requested_by_user_id !== ctx.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { error } = await supabaseAdmin.from('pending_approvals').delete().eq('id', existing.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
