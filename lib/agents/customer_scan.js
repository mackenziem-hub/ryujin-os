// ═══════════════════════════════════════════════════════════════
// CUSTOMER AGENT — proposal lifecycle, follow-up gaps, review asks.
//
// Returns the same { agent, role, timestamp, findings, tasks, stats }
// shape as the existing agents in api/agents/_shared.js so it slots
// straight into persistAgentRun.
//
// Reads from estimates + customers + (eventually) proposal_views table.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../supabase.js';
import { isWonEstimate, wonAt } from '../customerLtvCalc.js';

const FOLLOWUP_GAP_DAYS = 3;        // proposal sent + no movement → gap
const SIGNED_NO_REVIEW_DAYS = 14;   // job signed + this many days = ask for Google review

const formatDays = (ms) => `${Math.floor(ms / 86400000)}d`;

export async function runCustomerScan({ tenantSlug = 'plus-ultra' } = {}) {
  const report = {
    agent: 'Customer',
    role: 'Customer relationship + proposal lifecycle',
    timestamp: new Date().toISOString(),
    findings: [],
    tasks: [],
    stats: {}
  };

  // Resolve tenant id
  const t = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .maybeSingle();
  if (t.error || !t.data) {
    report.findings.push(`Tenant lookup failed for slug=${tenantSlug}: ${t.error?.message || 'not found'}`);
    return report;
  }
  const tenantId = t.data.id;

  const now = Date.now();

  // ── Pull recent estimates with customer ──
  const ests = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, customer_id, status, state, proposal_mode, share_token, created_at, updated_at, approved_at, accepted_at, schedule_due_by, scheduled_at, closed_won_at, customer:customers(full_name, email, phone)')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(200);

  if (ests.error) {
    report.findings.push(`Estimate fetch failed: ${ests.error.message}`);
    return report;
  }
  const list = ests.data || [];
  report.stats.estimatesScanned = list.length;

  // ── Lifecycle counts ──
  const buckets = {
    draft: 0, sent: 0, approved: 0, contractPending: 0, depositPending: 0,
    scheduled: 0, won: 0, lost: 0, other: 0
  };
  for (const e of list) {
    const s = e.state || e.status || '';
    if (s === 'proposal_draft' || s === 'draft') buckets.draft++;
    else if (s === 'proposal_sent') buckets.sent++;
    else if (s === 'approved_pending_rep_call') buckets.approved++;
    else if (s === 'contract_pending') buckets.contractPending++;
    else if (s === 'deposit_pending' || s === 'financing_pending') buckets.depositPending++;
    else if (s === 'scheduled' || s === 'schedule_pending') buckets.scheduled++;
    else if (s === 'closed_won') buckets.won++;
    else if (s === 'closed_lost' || s === 'lost') buckets.lost++;
    else buckets.other++;
  }
  report.stats.lifecycle = buckets;
  report.findings.push(`Lifecycle: ${buckets.sent} sent · ${buckets.approved} approved · ${buckets.scheduled} scheduled · ${buckets.won} won · ${buckets.lost} lost`);

  // ── Follow-up gaps: proposal_sent for > FOLLOWUP_GAP_DAYS with no further movement ──
  const sentStale = list.filter(e => {
    if ((e.state || e.status) !== 'proposal_sent') return false;
    const updated = e.updated_at ? new Date(e.updated_at).getTime() : 0;
    return updated > 0 && (now - updated) / 86400000 >= FOLLOWUP_GAP_DAYS;
  });
  report.stats.followUpGaps = sentStale.length;
  if (sentStale.length > 0) {
    const names = sentStale.slice(0, 5).map(e => e.customer?.full_name || `est ${e.estimate_number || e.id.slice(0,8)}`).join(', ');
    report.findings.push(`${sentStale.length} proposal${sentStale.length === 1 ? '' : 's'} sent ${FOLLOWUP_GAP_DAYS}+ days ago with no movement: ${names}`);
    report.tasks.push({
      title: `Follow up on ${sentStale.length} stale proposal${sentStale.length === 1 ? '' : 's'}`,
      description: `Customers waiting after proposal_sent ${FOLLOWUP_GAP_DAYS}+ days:\n${sentStale.map(e => `• ${e.customer?.full_name || 'unknown'} — est ${e.estimate_number || e.id.slice(0,8)} — ${formatDays(now - new Date(e.updated_at).getTime())} ago`).join('\n')}`,
      priority: sentStale.length >= 3 ? 'high' : 'medium'
    });
  }

  // ── Approved but rep call not happened (rep_call_due_at passed) ──
  const approvedNoCall = list.filter(e => (e.state === 'approved_pending_rep_call'));
  if (approvedNoCall.length > 0) {
    report.findings.push(`${approvedNoCall.length} approved proposal${approvedNoCall.length === 1 ? '' : 's'} awaiting rep call`);
    report.tasks.push({
      title: `Call ${approvedNoCall.length} approved customer${approvedNoCall.length === 1 ? '' : 's'} to confirm next steps`,
      description: approvedNoCall.map(e => `• ${e.customer?.full_name || 'unknown'} — ${e.customer?.phone || 'no phone'}`).join('\n'),
      priority: 'high'
    });
  }

  // ── Signed jobs that haven't been asked for a review ──
  // Dedupe stamps (migration 098): customers asked within the last 90 days
  // are excluded. Queried separately and soft-failed so a missing column
  // degrades to the old no-dedupe heuristic instead of killing the scan.
  const reviewSentByCustomer = {};
  const stamps = await supabaseAdmin
    .from('customers')
    .select('id, review_request_sent_at')
    .eq('tenant_id', tenantId)
    .not('review_request_sent_at', 'is', null)
    .limit(2000);
  if (!stamps.error) {
    for (const c of stamps.data || []) reviewSentByCustomer[c.id] = c.review_request_sent_at;
  }

  // Won predicate + won-date come from lib/customerLtvCalc.js: live won rows
  // carry status='accepted' with accepted_at (none have state='closed_won'
  // or status='signed'), so the old narrower filter matched 0 rows in prod.
  const wonOld = list.filter(e => {
    if (!isWonEstimate(e)) return false;
    const wonTs = wonAt(e);
    const closedAt = wonTs ? new Date(wonTs).getTime() : 0;
    if (!closedAt) return false;
    const days = (now - closedAt) / 86400000;
    if (days < SIGNED_NO_REVIEW_DAYS || days > SIGNED_NO_REVIEW_DAYS + 30) return false;
    const sentAt = e.customer_id ? reviewSentByCustomer[e.customer_id] : null;
    if (sentAt && (now - new Date(sentAt).getTime()) < 90 * 86400000) return false;
    return true;
  });
  report.stats.reviewAsksReady = wonOld.length;
  if (wonOld.length > 0) {
    report.findings.push(`${wonOld.length} signed job${wonOld.length === 1 ? '' : 's'} ready for Google review ask (${SIGNED_NO_REVIEW_DAYS}+ days post-close)`);
    report.tasks.push({
      title: `Send Google review ask to ${wonOld.length} customer${wonOld.length === 1 ? '' : 's'}`,
      description: `Use g.page/plusultra/review link. Signed customers ${SIGNED_NO_REVIEW_DAYS}+ days post-close:\n${wonOld.map(e => `• ${e.customer?.full_name || 'unknown'} — ${e.customer?.email || 'no email'}`).join('\n')}`,
      priority: 'medium'
    });
  }

  return report;
}
