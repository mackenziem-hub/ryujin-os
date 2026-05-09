// Ryujin OS — Agent Briefing Endpoint
//
// GET /api/agent-briefing?tenant_id=X
//
// Returns structured operator briefing for the Agent cockpit. Single canonical
// source — UI, chat agent, and future automation all consume the same shape.
// Per Bible v0.2 / Manus 72-hour plan: build endpoint first, expose to MCP later.
//
// Severity model (Manus v0.2):
//   P0 = trust/legal/compliance (claim violations, GHL drift on accepted estimates)
//   P1 = money flow blocked (overdue rep call, deposit pending too long, schedule passed)
//   P2 = pending acceptance (re-accept needed, CO awaiting decision)
//   P3 = info/convenience (rate hold expiring soon, GHL drift on draft work)
//
// Block schema:
//   {
//     severity: 'P0' | 'P1' | 'P2' | 'P3',
//     type: machine slug,
//     entity: { id, type, label },
//     label: human description,
//     due_at: ISO | null,
//     recommended_action: short imperative,
//     safe_action: machine slug for UI button (optional)
//   }

import { supabaseAdmin } from '../lib/supabase.js';

const TENANT_HEADER = 'x-tenant-id';
const PLUS_ULTRA_TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b';

// Resolve tenant: query param > header > default to Plus Ultra (tenant 0)
function resolveTenantId(req) {
  return (req.query?.tenant_id || req.headers?.[TENANT_HEADER] || PLUS_ULTRA_TENANT_ID).toString().trim();
}

function nowIso() { return new Date().toISOString(); }

// ── Block builders ─────────────────────────────────────────────────────

async function overdueRepCalls(tenantId) {
  const { data, error } = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, customer_id, customer:customers(full_name, address), rep_call_due_at, share_token')
    .eq('tenant_id', tenantId)
    .eq('state', 'approved_pending_rep_call')
    .lt('rep_call_due_at', nowIso())
    .order('rep_call_due_at', { ascending: true })
    .limit(50);
  if (error) { console.error('[agent-briefing] overdueRepCalls', error); return []; }
  return (data || []).map(e => ({
    severity: 'P1',
    type: 'overdue_rep_call',
    entity: { id: e.id, type: 'estimate', label: `PU-${e.estimate_number} · ${e.customer?.full_name || ''}` },
    label: `Rep call overdue · ${e.customer?.full_name || 'customer'}${e.customer?.address ? ' (' + e.customer.address + ')' : ''}`,
    due_at: e.rep_call_due_at,
    recommended_action: 'Call customer now to confirm scope + send contract',
    safe_action: 'open_estimate'
  }));
}

async function expiredRateHolds(tenantId) {
  const { data, error } = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, customer:customers(full_name), rate_hold_expires_at, state')
    .eq('tenant_id', tenantId)
    .eq('state', 'proposal_sent')
    .lt('rate_hold_expires_at', nowIso())
    .order('rate_hold_expires_at', { ascending: true })
    .limit(50);
  if (error) { console.error('[agent-briefing] expiredRateHolds', error); return []; }
  return (data || []).map(e => ({
    severity: 'P1',
    type: 'expired_rate_hold',
    entity: { id: e.id, type: 'estimate', label: `PU-${e.estimate_number}` },
    label: `Rate hold expired · ${e.customer?.full_name || 'customer'}`,
    due_at: e.rate_hold_expires_at,
    recommended_action: 'Re-quote at current material costs OR re-confirm rate with rep call',
    safe_action: 'open_estimate'
  }));
}

async function rateHoldsExpiringSoon(tenantId, hoursAhead = 72) {
  const cutoff = new Date(Date.now() + hoursAhead * 3600 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, customer:customers(full_name), rate_hold_expires_at')
    .eq('tenant_id', tenantId)
    .eq('state', 'proposal_sent')
    .gte('rate_hold_expires_at', nowIso())
    .lte('rate_hold_expires_at', cutoff)
    .order('rate_hold_expires_at', { ascending: true })
    .limit(20);
  if (error) { console.error('[agent-briefing] rateHoldsExpiringSoon', error); return []; }
  return (data || []).map(e => ({
    severity: 'P3',
    type: 'rate_hold_expiring',
    entity: { id: e.id, type: 'estimate', label: `PU-${e.estimate_number}` },
    label: `Rate hold expiring within ${hoursAhead}h · ${e.customer?.full_name || 'customer'}`,
    due_at: e.rate_hold_expires_at,
    recommended_action: 'Nudge customer or schedule rep follow-up before expiry',
    safe_action: 'open_estimate'
  }));
}

async function pendingReAccept(tenantId) {
  const { data, error } = await supabaseAdmin
    .from('paysheets')
    .select('id, job_id, customer_name, address, subcontractor, total, version, sub_acceptance_token, updated_at')
    .eq('tenant_id', tenantId)
    .eq('state', 'pending_re_accept')
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) { console.error('[agent-briefing] pendingReAccept', error); return []; }
  return (data || []).map(p => ({
    severity: 'P2',
    type: 'pending_re_accept',
    entity: { id: p.id, type: 'paysheet', label: `${p.job_id || 'job'} · ${p.subcontractor || 'sub'}` },
    label: `Sub re-accept needed (v${p.version}) · ${p.subcontractor || 'sub'} · ${p.customer_name || ''}`.trim(),
    due_at: null,
    recommended_action: 'Confirm sub received the new accept link',
    safe_action: 'open_paysheet'
  }));
}

async function changeOrdersAwaiting(tenantId) {
  const { data, error } = await supabaseAdmin
    .from('change_orders')
    .select('id, estimate_id, paysheet_id, reason, customer_accept_status, sub_accept_status, status, price_delta_customer, rate_delta_sub, created_at')
    .eq('tenant_id', tenantId)
    .in('status', ['pending_customer', 'pending_sub', 'pending_both'])
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) {
    if (error.code === '42P01') return []; // table doesn't exist yet (migration 039 not applied) — skip silently
    console.error('[agent-briefing] changeOrdersAwaiting', error);
    return [];
  }
  return (data || []).map(co => ({
    severity: 'P2',
    type: co.customer_accept_status === 'pending' ? 'co_pending_customer' : 'co_pending_sub',
    entity: { id: co.id, type: 'change_order', label: co.reason?.slice(0, 60) || 'change order' },
    label: `CO awaiting ${co.customer_accept_status === 'pending' ? 'customer' : 'sub'} · ${co.reason?.slice(0, 80) || ''}`,
    due_at: null,
    recommended_action: co.customer_accept_status === 'pending'
      ? 'Confirm customer received CO link; nudge if >24h'
      : 'Confirm sub received CO link; nudge if >24h',
    safe_action: 'open_change_order'
  }));
}

async function ghlDrift(tenantId) {
  const { data, error } = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, customer:customers(full_name), ghl_sync_status, ghl_sync_error, last_synced_at, state')
    .eq('tenant_id', tenantId)
    .in('ghl_sync_status', ['drifted', 'error'])
    .order('last_synced_at', { ascending: true })
    .limit(50);
  if (error) { console.error('[agent-briefing] ghlDrift', error); return []; }
  // Severity: P0 if estimate is committed (approved → closed_won), P3 if still in proposal phase
  const COMMITTED = new Set(['approved_pending_rep_call','contract_pending','deposit_pending','financing_pending','schedule_pending','scheduled','closed_won']);
  return (data || []).map(e => ({
    severity: COMMITTED.has(e.state) ? 'P0' : 'P3',
    type: 'ghl_drift',
    entity: { id: e.id, type: 'estimate', label: `PU-${e.estimate_number}` },
    label: `GHL ${e.ghl_sync_status} · ${e.customer?.full_name || ''} · ${e.ghl_sync_error?.slice(0, 80) || ''}`,
    due_at: e.last_synced_at,
    recommended_action: 'Open admin → Sync GHL retry; investigate persistent failures',
    safe_action: 'retry_ghl_sync'
  }));
}

async function depositBlockers(tenantId) {
  // Cash path: state=deposit_pending and approved >24h ago and deposit not cleared
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, customer:customers(full_name), approved_at, deposit_amount, deposit_status')
    .eq('tenant_id', tenantId)
    .eq('state', 'deposit_pending')
    .eq('deposit_status', 'pending')
    .lt('approved_at', dayAgo)
    .order('approved_at', { ascending: true })
    .limit(50);
  if (error) { console.error('[agent-briefing] depositBlockers', error); return []; }
  return (data || []).map(e => ({
    severity: 'P1',
    type: 'deposit_blocker',
    entity: { id: e.id, type: 'estimate', label: `PU-${e.estimate_number}` },
    label: `Deposit pending >24h · ${e.customer?.full_name || ''} · $${((e.deposit_amount || 0)/100).toFixed(2)}`,
    due_at: e.approved_at,
    recommended_action: 'Confirm contract sent and Stripe Checkout link is live; re-send if customer hasn\'t opened',
    safe_action: 'open_estimate'
  }));
}

async function financeBlockers(tenantId) {
  const { data, error } = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, customer:customers(full_name), approved_at, finance_status, finance_provider')
    .eq('tenant_id', tenantId)
    .eq('state', 'financing_pending')
    .eq('finance_status', 'pending')
    .order('approved_at', { ascending: true })
    .limit(50);
  if (error) { console.error('[agent-briefing] financeBlockers', error); return []; }
  return (data || []).map(e => ({
    severity: 'P1',
    type: 'finance_blocker',
    entity: { id: e.id, type: 'estimate', label: `PU-${e.estimate_number}` },
    label: `Financing pending · ${e.customer?.full_name || ''} · ${e.finance_provider || 'provider'}`,
    due_at: e.approved_at,
    recommended_action: 'Verify FinanceIt approval letter received; flip finance_status to approved when confirmed',
    safe_action: 'mark_finance_approved'
  }));
}

async function scheduleBlockers(tenantId) {
  const { data, error } = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, customer:customers(full_name), schedule_due_by')
    .eq('tenant_id', tenantId)
    .eq('state', 'schedule_pending')
    .lt('schedule_due_by', nowIso())
    .order('schedule_due_by', { ascending: true })
    .limit(50);
  if (error) { console.error('[agent-briefing] scheduleBlockers', error); return []; }
  return (data || []).map(e => ({
    severity: 'P1',
    type: 'schedule_blocker',
    entity: { id: e.id, type: 'estimate', label: `PU-${e.estimate_number}` },
    label: `Schedule SLA passed · ${e.customer?.full_name || ''}`,
    due_at: e.schedule_due_by,
    recommended_action: 'Create work order + notify customer of install window',
    safe_action: 'open_estimate'
  }));
}

async function softClaimsCount(tenantId) {
  // Surface as a single P0 summary block — all soft claims represent active retraction state
  const { data, error } = await supabaseAdmin
    .from('claims')
    .select('key, copy, retracted_reason')
    .eq('tenant_id', tenantId)
    .eq('status', 'soft');
  if (error) { console.error('[agent-briefing] softClaimsCount', error); return []; }
  if (!data || data.length === 0) return [];
  const keys = data.map(c => c.key).join(', ');
  return [{
    severity: 'P0',
    type: 'soft_claims_present',
    entity: { id: null, type: 'claims_library', label: 'Trust claims' },
    label: `${data.length} claim(s) currently SOFT (retracted, do-not-render): ${keys}`,
    due_at: null,
    recommended_action: 'Restore claim status to active when proof source is current',
    safe_action: 'open_admin_tenant_claims'
  }];
}

// ── Handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-tenant-id');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = resolveTenantId(req);

  // Gather all blocks in parallel
  const [
    repCalls, rateExpired, rateExpiring, reAccept, cosWaiting,
    drift, deposit, finance, schedule, soft
  ] = await Promise.all([
    overdueRepCalls(tenantId),
    expiredRateHolds(tenantId),
    rateHoldsExpiringSoon(tenantId),
    pendingReAccept(tenantId),
    changeOrdersAwaiting(tenantId),
    ghlDrift(tenantId),
    depositBlockers(tenantId),
    financeBlockers(tenantId),
    scheduleBlockers(tenantId),
    softClaimsCount(tenantId)
  ]);

  const blocks = [
    ...soft, ...drift,
    ...repCalls, ...rateExpired, ...deposit, ...finance, ...schedule,
    ...reAccept, ...cosWaiting,
    ...rateExpiring
  ].sort((a, b) => {
    const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return order[a.severity] - order[b.severity];
  });

  const summary = blocks.reduce((acc, b) => {
    acc[b.severity.toLowerCase()] = (acc[b.severity.toLowerCase()] || 0) + 1;
    return acc;
  }, { p0: 0, p1: 0, p2: 0, p3: 0 });

  return res.status(200).json({
    generated_at: nowIso(),
    tenant_id: tenantId,
    summary,
    blocks
  });
}
