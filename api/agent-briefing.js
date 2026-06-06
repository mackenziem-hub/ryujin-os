// Ryujin OS — Agent Briefing Endpoint
//
// GET /api/agent-briefing?tenant_id=X
//
// Returns structured operator briefing for the Agent cockpit. Single canonical
// source — UI, chat agent, and future automation all consume the same shape.
// Per Bible v0.2 / Manus peer review (May 9 2026).
//
// Severity model:
//   P0 = trust/legal/compliance (claim violations, GHL drift on accepted estimates,
//        contract sent without required insurance claims)
//   P1 = money flow blocked (overdue rep call, deposit pending too long, schedule
//        passed, missing contract, scheduled-without-paysheet, aged COs)
//   P2 = pending acceptance (re-accept needed, CO awaiting decision)
//   P3 = info/convenience (rate hold expiring soon, GHL drift on draft work)

import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

// Manus peer review §1.2 + §2.1: estimates in any of these states are
// commercially committed. GHL sync drift on these is a P0 trust issue.
// `change_order_pending` added per peer review §2.2.
const COMMITTED_STATES = new Set([
  'approved_pending_rep_call',
  'contract_pending',
  'deposit_pending',
  'financing_pending',
  'schedule_pending',
  'scheduled',
  'change_order_pending',          // added per peer review
  'closed_won'
]);

// Paysheet states that mean "active sub-facing work exists on this job"
const ACTIVE_PAYSHEET_STATES = new Set([
  'sent', 'accepted', 'pending_re_accept',
  'completed_owner_marked', 'payable', 'paid'
]);

// Manus peer review §2.3: warn ONCE on module load that change_orders table
// is missing, instead of silently skipping every request. This boolean is
// reset on serverless cold start which is acceptable.
let warnedMissingChangeOrdersTable = false;

function nowIso() { return new Date().toISOString(); }
function hoursAgoIso(h) { return new Date(Date.now() - h * 3600 * 1000).toISOString(); }

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
    .in('state', ['proposal_sent', 'proposal_expired'])
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
    recommended_action: e.state === 'proposal_expired'
      ? 'Re-issue proposal at current material costs (proposal_expired → proposal_sent)'
      : 'Move to proposal_expired and re-issue OR re-confirm rate with rep call',
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
  // Manus peer review §2.1: escalate to P1 if blocking active production OR aged >24h.
  // Need estimate state for the production-block check, plus age math.
  const { data, error } = await supabaseAdmin
    .from('change_orders')
    .select('id, estimate_id, paysheet_id, reason, customer_accept_status, sub_accept_status, status, price_delta_customer, rate_delta_sub, created_at, estimate:estimates(state)')
    .eq('tenant_id', tenantId)
    .in('status', ['pending_customer', 'pending_sub', 'pending_both'])
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) {
    if (error.code === '42P01') {
      // Manus peer review §2.3: warn once, not on every request
      if (!warnedMissingChangeOrdersTable) {
        console.warn('[agent-briefing] change_orders table missing — migration_039 not applied for this tenant. Skipping CO blocks.');
        warnedMissingChangeOrdersTable = true;
      }
      return [];
    }
    console.error('[agent-briefing] changeOrdersAwaiting', error);
    return [];
  }
  const ageThreshold = 24 * 3600 * 1000;
  const now = Date.now();
  return (data || []).map(co => {
    const ageMs = now - new Date(co.created_at).getTime();
    const isAged = ageMs > ageThreshold;
    const blocksProduction = co.estimate?.state === 'change_order_pending' || co.estimate?.state === 'scheduled';
    const baseSeverity = co.customer_accept_status === 'pending'
      ? 'co_pending_customer'
      : 'co_pending_sub';
    const severity = (isAged || blocksProduction) ? 'P1' : 'P2';
    const ageNote = isAged ? ` (aged ${Math.round(ageMs / 3600000)}h)` : '';
    const blockNote = blocksProduction ? ' — blocking production' : '';
    return {
      severity,
      type: severity === 'P1' ? 'co_aged_blocker' : baseSeverity,
      entity: { id: co.id, type: 'change_order', label: co.reason?.slice(0, 60) || 'change order' },
      label: `CO awaiting ${co.customer_accept_status === 'pending' ? 'customer' : 'sub'}${ageNote}${blockNote} · ${co.reason?.slice(0, 80) || ''}`,
      due_at: co.created_at,
      recommended_action: blocksProduction
        ? 'Resolve CO immediately — production cannot resume until status=approved'
        : (co.customer_accept_status === 'pending'
          ? 'Confirm customer received CO link; nudge if >24h'
          : 'Confirm sub received CO link; nudge if >24h'),
      safe_action: 'open_change_order'
    };
  });
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
  return (data || []).map(e => ({
    severity: COMMITTED_STATES.has(e.state) ? 'P0' : 'P3',
    type: 'ghl_drift',
    entity: { id: e.id, type: 'estimate', label: `PU-${e.estimate_number}` },
    label: `GHL ${e.ghl_sync_status} · ${e.customer?.full_name || ''} · ${e.ghl_sync_error?.slice(0, 80) || ''}`,
    due_at: e.last_synced_at,
    recommended_action: 'Open admin → Sync GHL retry; investigate persistent failures',
    safe_action: 'retry_ghl_sync'
  }));
}

async function depositBlockers(tenantId) {
  const dayAgo = hoursAgoIso(24);
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

// ── NEW BLOCK BUILDERS (Manus peer review §2.2) ────────────────────────

async function missingContract(tenantId) {
  // Estimates that have advanced to contract_pending but no contract artifact exists.
  const dayAgo = hoursAgoIso(24);
  const { data, error } = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, customer:customers(full_name), approved_at, contract_status, contract_sent_at')
    .eq('tenant_id', tenantId)
    .eq('state', 'contract_pending')
    .or('contract_status.is.null,contract_status.eq.pending')
    .is('contract_sent_at', null)
    .lt('approved_at', dayAgo)
    .order('approved_at', { ascending: true })
    .limit(50);
  if (error) { console.error('[agent-briefing] missingContract', error); return []; }
  return (data || []).map(e => ({
    severity: 'P1',
    type: 'missing_contract',
    entity: { id: e.id, type: 'estimate', label: `PU-${e.estimate_number}` },
    label: `Contract not sent >24h after approval · ${e.customer?.full_name || ''}`,
    due_at: e.approved_at,
    recommended_action: 'Generate contract PDF and email/SMS to customer',
    safe_action: 'generate_contract'
  }));
}

async function paysheetNotSent(tenantId) {
  // Manus peer review §2.2: scheduled estimate with assigned sub/job but no paysheet
  // in sent/accepted/pending_re_accept/completed/payable/paid.
  // No FK from paysheets→estimates exists; join via tenant + customer/address.
  const { data: estimates, error: e1 } = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, customer_id, customer:customers(full_name, address)')
    .eq('tenant_id', tenantId)
    .eq('state', 'scheduled')
    .limit(100);
  if (e1) { console.error('[agent-briefing] paysheetNotSent estimates', e1); return []; }
  if (!estimates || estimates.length === 0) return [];

  const addresses = estimates.map(e => e.customer?.address).filter(Boolean);
  if (addresses.length === 0) return [];

  const { data: paysheets, error: e2 } = await supabaseAdmin
    .from('paysheets')
    .select('address, state')
    .eq('tenant_id', tenantId)
    .in('address', addresses)
    .in('state', [...ACTIVE_PAYSHEET_STATES]);
  if (e2) { console.error('[agent-briefing] paysheetNotSent paysheets', e2); return []; }

  const addressesWithActivePaysheet = new Set((paysheets || []).map(p => p.address));
  const blocked = estimates.filter(e => e.customer?.address && !addressesWithActivePaysheet.has(e.customer.address));

  return blocked.map(e => ({
    severity: 'P1',
    type: 'paysheet_not_sent',
    entity: { id: e.id, type: 'estimate', label: `PU-${e.estimate_number}` },
    label: `Scheduled, no active paysheet · ${e.customer?.full_name || ''} · ${e.customer?.address || ''}`,
    due_at: null,
    recommended_action: 'Create + send paysheet to assigned sub before crew arrives onsite',
    safe_action: 'create_paysheet'
  }));
}

async function staleAcceptanceToken(tenantId) {
  // Paysheet has a public token but state is non-actionable (cancelled, completed,
  // payable, paid). Token should have been revoked; this surfaces ones that weren't.
  const NON_ACTIONABLE = ['cancelled', 'completed_owner_marked', 'payable', 'paid'];
  const { data, error } = await supabaseAdmin
    .from('paysheets')
    .select('id, job_id, customer_name, subcontractor, state, sub_acceptance_token, superseded_token_at')
    .eq('tenant_id', tenantId)
    .not('sub_acceptance_token', 'is', null)
    .in('state', NON_ACTIONABLE)
    .limit(50);
  if (error) { console.error('[agent-briefing] staleAcceptanceToken', error); return []; }
  return (data || []).map(p => ({
    // Cancelled = P0 (token must be invalidated, owner intent was kill)
    // Completed/payable/paid = P1 (less urgent but still confusing if hit)
    severity: p.state === 'cancelled' ? 'P0' : 'P1',
    type: 'stale_acceptance_token',
    entity: { id: p.id, type: 'paysheet', label: `${p.job_id || 'job'} · ${p.subcontractor || 'sub'}` },
    label: `Stale public token on ${p.state} paysheet · ${p.subcontractor || 'sub'} · ${p.customer_name || ''}`,
    due_at: p.superseded_token_at,
    recommended_action: 'Revoke token (clear sub_acceptance_token column); investigate why pullback didn\'t revoke',
    safe_action: 'revoke_paysheet_token'
  }));
}

async function contractMissingClaims(tenantId) {
  // Bible v0.2 §3: contract sent/signed while required insurance claims are
  // soft/disabled is a P0 compliance issue. Compute as: count of estimates
  // with contract activity + check claim status of gl_2m_liability + wcb_coverage.
  const REQUIRED_KEYS = ['gl_2m_liability', 'wcb_coverage'];

  const { data: claims, error: ce } = await supabaseAdmin
    .from('claims')
    .select('key, status')
    .eq('tenant_id', tenantId)
    .in('key', REQUIRED_KEYS);
  if (ce) { console.error('[agent-briefing] contractMissingClaims claims', ce); return []; }

  const inactiveKeys = (claims || []).filter(c => c.status !== 'active').map(c => c.key);
  if (inactiveKeys.length === 0) return [];

  // Count contracts that have been sent/signed while these claims are inactive
  const { data: contracts, error: te } = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, contract_status, contract_sent_at')
    .eq('tenant_id', tenantId)
    .or('contract_status.eq.sent,contract_status.eq.signed')
    .limit(50);
  if (te) { console.error('[agent-briefing] contractMissingClaims contracts', te); return []; }

  if (!contracts || contracts.length === 0) {
    // Claims are inactive but no contracts have been generated against the gap yet.
    // Still surface as a single forward-looking warning.
    return [{
      severity: 'P0',
      type: 'contract_missing_gl_wcb_claim',
      entity: { id: null, type: 'claims_library', label: 'Insurance claims' },
      label: `Required insurance claims inactive (${inactiveKeys.join(', ')}) — DO NOT issue contracts until restored`,
      due_at: null,
      recommended_action: 'Restore GL/WCB claims to active status before generating any new contract',
      safe_action: 'open_admin_tenant_claims'
    }];
  }

  return [{
    severity: 'P0',
    type: 'contract_missing_gl_wcb_claim',
    entity: { id: null, type: 'claims_library', label: 'Insurance claims' },
    label: `${contracts.length} contract(s) sent/signed while ${inactiveKeys.join(' + ')} are inactive — review for retraction risk`,
    due_at: null,
    recommended_action: 'Audit recent contracts for retracted-claim language; prioritize claim restoration',
    safe_action: 'open_admin_tenant_claims'
  }];
}

// ── Handler ────────────────────────────────────────────────────────────

async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Tenant is derived authoritatively from the authenticated session by
  // requirePortalSessionAndTenant (req.tenant.id), never from the client.
  const tenantId = req.tenant.id;

  // Gather all blocks in parallel
  const [
    repCalls, rateExpired, rateExpiring, reAccept, cosWaiting,
    drift, deposit, finance, schedule, soft,
    missingContractBlocks, paysheetNotSentBlocks, staleTokenBlocks, contractClaimBlocks
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
    softClaimsCount(tenantId),
    missingContract(tenantId),
    paysheetNotSent(tenantId),
    staleAcceptanceToken(tenantId),
    contractMissingClaims(tenantId)
  ]);

  const blocks = [
    // P0 first
    ...soft, ...drift, ...staleTokenBlocks, ...contractClaimBlocks,
    // P1 money + production blockers
    ...repCalls, ...rateExpired, ...deposit, ...finance, ...schedule,
    ...missingContractBlocks, ...paysheetNotSentBlocks,
    // P2 acceptance waits + P3 nudges
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

export default requirePortalSessionAndTenant(handler);
