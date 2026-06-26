// ═══════════════════════════════════════════════════════════════
// SALES-PORTAL — read-only dashboard data for a salesperson.
//
// MVP scope: filters all estimates by the `sales_owner:<slug>` tag
// (per the commission tagging schema established in Session 66).
// Returns pipeline, commissions, follow-ups, recent activity.
//
// Auth: tenant header (admin-shared for now). Magic-link auth for
// remote salesperson access lands when needed — track it with a
// future migration.
//
// GET /api/sales-portal?owner=darcy
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

const COMMISSION_RATES = { 0: 0, 10: 0.10, 15: 0.15, 20: 0.20 };
const FOLLOWUP_GAP_DAYS = 3;

function ratePctFromTags(tags) {
  if (!Array.isArray(tags)) return 0;
  const t = tags.find(x => typeof x === 'string' && x.startsWith('commission_rate:'));
  if (!t) return 0;
  const n = parseInt(t.split(':')[1]);
  return COMMISSION_RATES[n] ?? 0;
}

function reasonFromTags(tags) {
  if (!Array.isArray(tags)) return null;
  const t = tags.find(x => typeof x === 'string' && x.startsWith('commission_reason:'));
  return t ? t.split(':')[1] : null;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const owner = (req.query.owner || '').toLowerCase().trim();
  if (!owner) return res.status(400).json({ error: 'owner required (e.g. ?owner=darcy)' });

  // Pull all estimates tagged with this sales_owner
  // tags is a text[] in Postgres — use containment via cs (contains)
  const { data, error } = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, status, state, proposal_mode, tags, calculated_packages, selected_package, created_at, updated_at, approved_at, scheduled_at, closed_won_at, customer:customers(full_name, email, phone, address)')
    .eq('tenant_id', tenantId)
    .contains('tags', [`sales_owner:${owner}`])
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });

  const list = data || [];
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);

  // ── Pipeline by stage ──
  const stages = {
    draft: [], sent: [], approved: [], scheduled: [], won: [], lost: []
  };
  for (const e of list) {
    const s = e.state || e.status || '';
    if (s === 'proposal_draft' || s === 'draft') stages.draft.push(e);
    else if (s === 'proposal_sent') stages.sent.push(e);
    else if (s === 'approved_pending_rep_call') stages.approved.push(e);
    else if (s === 'contract_pending' || s === 'deposit_pending' || s === 'financing_pending' || s === 'schedule_pending') stages.approved.push(e);
    else if (s === 'scheduled') stages.scheduled.push(e);
    else if (s === 'closed_won' || s === 'signed') stages.won.push(e);
    else if (s === 'closed_lost' || s === 'lost') stages.lost.push(e);
  }

  // ── Commission ledger ──
  // For each won estimate, commission = sellingPrice (selected package) * rate
  function sellingPrice(e) {
    const tier = (e.selected_package || 'gold').toLowerCase();
    const pkg = e.calculated_packages?.[tier] || {};
    // Precedence mirrors proposal.js: pkg.total is the canonical pre-tax rendered price
    // (carries negotiated/override values); summary.sellingPrice is the raw-engine-shape fallback.
    return pkg.total ?? pkg.summary?.sellingPrice ?? pkg.sellingPrice ?? 0;
  }
  let commissionPending = 0, commissionSignedThisMonth = 0, commissionLifetime = 0;
  const commissionByEstimate = list.map(e => {
    const rate = ratePctFromTags(e.tags);
    const price = sellingPrice(e);
    const amount = Math.round(price * rate);
    return {
      id: e.id,
      estimate_number: e.estimate_number,
      customer: e.customer?.full_name || '—',
      state: e.state || e.status,
      rate_pct: Math.round(rate * 100),
      reason: reasonFromTags(e.tags),
      selling_price: Math.round(price),
      commission: amount,
      closed_at: e.closed_won_at,
      approved_at: e.approved_at
    };
  });
  for (const c of commissionByEstimate) {
    if (c.state === 'closed_won' || c.state === 'signed') {
      commissionLifetime += c.commission;
      if (c.closed_at && new Date(c.closed_at) >= monthStart) commissionSignedThisMonth += c.commission;
    } else if (c.state === 'proposal_sent' || c.state === 'approved_pending_rep_call' || c.state === 'contract_pending') {
      commissionPending += c.commission;
    }
  }

  // ── Follow-ups (proposal_sent + stale) ──
  const followUps = stages.sent.filter(e => {
    const updated = e.updated_at ? new Date(e.updated_at).getTime() : 0;
    return updated > 0 && (now - updated) / 86400000 >= FOLLOWUP_GAP_DAYS;
  }).map(e => ({
    id: e.id,
    estimate_number: e.estimate_number,
    customer: e.customer?.full_name || '—',
    phone: e.customer?.phone || null,
    email: e.customer?.email || null,
    address: e.customer?.address || null,
    days_stale: Math.round((now - new Date(e.updated_at).getTime()) / 86400000),
    selling_price: Math.round(sellingPrice(e))
  }));

  // ── Recent activity timeline (last 20 events) ──
  const events = [];
  for (const e of list) {
    if (e.created_at) events.push({ at: e.created_at, kind: 'created', estimate_number: e.estimate_number, customer: e.customer?.full_name });
    if (e.approved_at) events.push({ at: e.approved_at, kind: 'approved', estimate_number: e.estimate_number, customer: e.customer?.full_name });
    if (e.scheduled_at) events.push({ at: e.scheduled_at, kind: 'scheduled', estimate_number: e.estimate_number, customer: e.customer?.full_name });
    if (e.closed_won_at) events.push({ at: e.closed_won_at, kind: 'won', estimate_number: e.estimate_number, customer: e.customer?.full_name });
  }
  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  const timeline = events.slice(0, 20);

  // ── Counts/stats ──
  const stats = {
    totalEstimates: list.length,
    inFlight: stages.sent.length + stages.approved.length + stages.scheduled.length,
    won: stages.won.length,
    lost: stages.lost.length,
    closeRate: (stages.won.length + stages.lost.length > 0)
      ? Math.round(stages.won.length / (stages.won.length + stages.lost.length) * 100)
      : null,
    pipelineValue: stages.sent.concat(stages.approved).concat(stages.scheduled).reduce((s, e) => s + sellingPrice(e), 0)
  };

  return res.status(200).json({
    owner,
    stats,
    commission: {
      pending: commissionPending,
      signed_this_month: commissionSignedThisMonth,
      lifetime: commissionLifetime,
      by_estimate: commissionByEstimate
    },
    pipeline: {
      sent: stages.sent.map(e => ({ id: e.id, estimate_number: e.estimate_number, customer: e.customer?.full_name, selling_price: Math.round(sellingPrice(e)), updated_at: e.updated_at })),
      approved: stages.approved.map(e => ({ id: e.id, estimate_number: e.estimate_number, customer: e.customer?.full_name, selling_price: Math.round(sellingPrice(e)), approved_at: e.approved_at })),
      scheduled: stages.scheduled.map(e => ({ id: e.id, estimate_number: e.estimate_number, customer: e.customer?.full_name, selling_price: Math.round(sellingPrice(e)), scheduled_at: e.scheduled_at })),
      won: stages.won.map(e => ({ id: e.id, estimate_number: e.estimate_number, customer: e.customer?.full_name, selling_price: Math.round(sellingPrice(e)), closed_at: e.closed_won_at }))
    },
    followUps,
    timeline
  });
}

export default requirePortalSessionAndTenant(handler);
