// Phase 9a: Approval router (Ryujin-native, replaced the legacy blob queue May 2026)
// POST   /api/router       → Create approval request, return code
// GET    /api/router       → List pending approvals (current user / tenant)
// GET    /api/router?code=X→ Look up specific approval by code
//
// Auth: Bearer token (same as chat). Defaults tenant to caller's tenant. Falls back to plus-ultra
// when called from chat.js with no token (preserves existing chat-routed approvals).
//
// Note: this endpoint creates the approval record. Execution of the underlying action happens
// when an approver hits PATCH /api/approvals?code=X with status=approved (see api/approvals.js).

import { supabaseAdmin } from '../lib/supabase.js';

const APPROVAL_TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 hours

// Agent prefix routing for chat.js tool calls.
const AGENT_PREFIX = {
  vegeta: 'VEG', piccolo: 'PIC', krillin: 'KRI', gohan: 'GOH',
  bulma: 'BUL', trunks: 'TRU', android18: 'A18',
  // Greek god aliases (Phase 7+)
  hermes: 'HER', hephaestus: 'HEP', athena: 'ATH', hecate: 'HEC',
  artemis: 'ART', apollo: 'APO', aphrodite: 'APH', persephone: 'PER',
  hercules: 'HRC', prometheus: 'PRO', zeus: 'ZEU', hestia: 'HES'
};

// Plus Ultra tenant UUID — used as fallback when no auth header (chat.js calls)
const PLUS_ULTRA_TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b';

function generateCode(agent) {
  const prefix = AGENT_PREFIX[String(agent || '').toLowerCase()] || 'GEN';
  const num = String(Math.floor(100 + Math.random() * 900)); // 100-999
  return `${prefix}-${num}`;
}

async function uniqueCode(agent) {
  for (let i = 0; i < 8; i++) {
    const code = generateCode(agent);
    const { data } = await supabaseAdmin.from('pending_approvals').select('id').eq('code', code).maybeSingle();
    if (!data) return code;
  }
  // Last resort: append timestamp
  return `${generateCode(agent)}-${Date.now().toString(36).slice(-3)}`;
}

async function resolveCallerContext(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    || req.headers['x-ryujin-token']
    || req.query?.token
    || (req.body?.token);
  if (!token) return null;

  const { data: session } = await supabaseAdmin
    .from('sessions').select('user_id, tenant_id, expires_at').eq('token', token).single();
  if (!session || new Date(session.expires_at) < new Date()) return null;

  const { data: user } = await supabaseAdmin
    .from('users').select('id, role, role_id').eq('id', session.user_id).single();
  if (!user) return null;

  let roleSlug = user.role || 'crew';
  if (user.role_id) {
    const { data: roleRow } = await supabaseAdmin.from('roles').select('slug').eq('id', user.role_id).single();
    if (roleRow?.slug) roleSlug = roleRow.slug;
  }

  return { userId: user.id, tenantId: session.tenant_id, role: roleSlug };
}

// Find the tenant owner (default approver when no specific assignee given)
async function findTenantOwner(tenantId) {
  const { data } = await supabaseAdmin
    .from('users').select('id').eq('tenant_id', tenantId).eq('role', 'owner').limit(1).maybeSingle();
  if (data) return data.id;
  // Fall back to looking up via role_id table
  const { data: ownerRole } = await supabaseAdmin.from('roles').select('id').eq('slug', 'owner').limit(1).maybeSingle();
  if (ownerRole) {
    const { data: u } = await supabaseAdmin.from('users').select('id').eq('tenant_id', tenantId).eq('role_id', ownerRole.id).limit(1).maybeSingle();
    if (u) return u.id;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ctx = await resolveCallerContext(req);

  if (req.method === 'POST') {
    const body = req.body || {};
    const { trigger, action, target, summary, details, execute_payload, agent } = body;
    if (!action) return res.status(400).json({ error: 'action required' });

    // For backward-compat with chat.js (calls without auth), default to plus-ultra tenant
    const tenantId = ctx?.tenantId || PLUS_ULTRA_TENANT_ID;
    const requesterId = ctx?.userId || null;
    const requesterRole = ctx?.role || 'owner';

    // Default assignee = tenant owner
    const assigneeId = await findTenantOwner(tenantId);

    const code = await uniqueCode(agent);
    const expiresAt = new Date(Date.now() + APPROVAL_TIMEOUT_MS).toISOString();

    const { data, error } = await supabaseAdmin
      .from('pending_approvals')
      .insert({
        tenant_id: tenantId,
        code,
        requested_by_user_id: requesterId,
        requested_by_role: requesterRole,
        assigned_to_user_id: assigneeId,
        agent: agent || null,
        action_type: action,
        target: target || null,
        summary: summary || null,
        execute_payload: execute_payload || (typeof details === 'string' ? safeJSON(details) : details) || {},
        status: 'pending',
        expires_at: expiresAt
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ code, id: data.id, expires_at: data.expires_at });
  }

  if (req.method === 'GET') {
    if (!ctx) return res.status(401).json({ error: 'Unauthorized — log in to view approvals' });

    if (req.query?.code) {
      const { data, error } = await supabaseAdmin
        .from('pending_approvals')
        .select('*')
        .eq('tenant_id', ctx.tenantId)
        .eq('code', String(req.query.code).toUpperCase())
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'Approval not found' });
      return res.json(data);
    }

    // Default: list pending for this tenant. Owners see all, non-owners only see own requests.
    let query = supabaseAdmin
      .from('pending_approvals')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (ctx.role !== 'owner') {
      query = query.eq('requested_by_user_id', ctx.userId);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ approvals: data, count: data.length });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

function safeJSON(s) { try { return JSON.parse(s); } catch { return {}; } }
