// ═══════════════════════════════════════════════════════════════
// FINANCE-STATE — bundled payload for /finance.html (panel dashboard).
//
// Cashflow agent runs daily and populates KPIs (collected_90d, outstanding,
// signed_90d, collected_7d, payments_matched/received). This endpoint adds
// real-time stats from the underlying tables.
//
// GET /api/finance-state[?user_id=<uuid>]
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const userId = req.query.user_id || null;
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

  // Briefing — finance agent uses agent_slug='finance' (mapped to cashflow runner)
  let briefingQ = supabaseAdmin
    .from('briefing_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('source_agent', 'finance')
    .eq('for_date', today)
    .is('dismissed_at', null)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(40);
  if (userId) briefingQ = briefingQ.or(`for_user_id.eq.${userId},for_user_id.is.null`);
  const briefing = await briefingQ;

  // KPIs prefixed 'finance.'
  const kpis = await supabaseAdmin
    .from('kpis')
    .select('*')
    .eq('tenant_id', tenantId)
    .like('key', 'finance.%')
    .order('sort_order', { ascending: true });

  // Latest finance run
  const latest = await supabaseAdmin
    .from('agent_runs')
    .select('id, agent_slug, trigger, started_at, completed_at, status, summary')
    .eq('tenant_id', tenantId)
    .eq('agent_slug', 'finance')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Stats
  const stats = {
    receivables_total: 0, receivables_overdue: 0,
    deposits_pending: 0, deposits_cleared_30d: 0,
    payables_total: 0, paysheets_pending: 0,
    collected_7d: 0, collected_30d: 0, collected_90d: 0,
    unmatched_payments: 0,
    pl_revenue_30d: 0, pl_signed_30d: 0
  };

  // Receivables: estimates with state in deposit_pending / contract_pending / financing_pending
  // OR closed_won but not yet fully paid (heuristic: closed_won_at set, no associated payment match)
  try {
    const ests = await supabaseAdmin
      .from('estimates')
      .select('id, state, status, calculated_packages, selected_package, closed_won_at, deposit_status, deposit_amount, deposit_cleared_at, rate_hold_expires_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(500);
    if (!ests.error) {
      const now = Date.now();
      const sellingPrice = (e) => {
        const tier = (e.selected_package || 'gold').toLowerCase();
        const pkg = e.calculated_packages?.[tier] || {};
        return pkg.sellingPrice || pkg.total || 0;
      };
      for (const e of ests.data || []) {
        const s = e.state || e.status || '';
        // Pending deposits → AR
        if (e.deposit_status === 'pending') {
          stats.deposits_pending += (e.deposit_amount ? e.deposit_amount / 100 : 0); // amount stored in cents per migration_038
        }
        if (e.deposit_status === 'cleared' && e.deposit_cleared_at && e.deposit_cleared_at >= thirtyDaysAgo) {
          stats.deposits_cleared_30d += (e.deposit_amount ? e.deposit_amount / 100 : 0);
        }
        // Closed_won = full receivable (gross)
        if (s === 'closed_won' || s === 'signed') {
          if (e.closed_won_at && e.closed_won_at >= thirtyDaysAgo) {
            stats.pl_signed_30d += sellingPrice(e);
          }
          // Add to AR if rate_hold not yet expired (still in collection window)
          if (e.rate_hold_expires_at && new Date(e.rate_hold_expires_at).getTime() > now) {
            // Already "collected" via deposit usually, skip the gross
          }
        }
      }
    }
  } catch { /* soft-fail */ }

  // Payments — last 7d / 30d / 90d collected
  try {
    const payments = await supabaseAdmin
      .from('payments')
      .select('id, amount, payment_date, matched_estimate_id, status')
      .eq('tenant_id', tenantId)
      .gte('payment_date', ninetyDaysAgo)
      .limit(500);
    if (!payments.error) {
      for (const p of payments.data || []) {
        const amt = p.amount ? parseFloat(p.amount) : 0;
        if (p.payment_date >= sevenDaysAgo) stats.collected_7d += amt;
        if (p.payment_date >= thirtyDaysAgo) stats.collected_30d += amt;
        stats.collected_90d += amt;
        if (!p.matched_estimate_id) stats.unmatched_payments++;
      }
    }
  } catch { /* table may not exist — soft-fail */ }

  // Paysheets pending
  try {
    const ps = await supabaseAdmin
      .from('paysheets')
      .select('id, status, state, total_pay')
      .eq('tenant_id', tenantId)
      .limit(500);
    if (!ps.error) {
      for (const p of ps.data || []) {
        const s = (p.state || p.status || '').toLowerCase();
        if (s === 'pending_approval' || s === 'submitted' || s === 'approved') {
          stats.paysheets_pending++;
          stats.payables_total += (p.total_pay ? parseFloat(p.total_pay) : 0);
        }
      }
    }
  } catch { /* soft-fail */ }

  stats.receivables_total = Math.round(stats.deposits_pending + stats.payables_total);
  stats.receivables_total = Math.round(stats.deposits_pending);

  // Round all monetary fields
  for (const k of ['receivables_total','receivables_overdue','deposits_pending','deposits_cleared_30d','payables_total','collected_7d','collected_30d','collected_90d','pl_revenue_30d','pl_signed_30d']) {
    stats[k] = Math.round(stats[k] || 0);
  }

  // Activity
  const activity = [];
  try {
    const recentPayments = await supabaseAdmin
      .from('payments')
      .select('id, amount, payment_date, customer_name, matched_estimate_id')
      .eq('tenant_id', tenantId)
      .order('payment_date', { ascending: false })
      .limit(10);
    for (const p of recentPayments.data || []) {
      activity.push({
        at: p.payment_date,
        kind: 'payment',
        label: `${p.customer_name || 'unknown'} · $${parseFloat(p.amount || 0).toFixed(2)}${p.matched_estimate_id ? '' : ' (unmatched)'}`,
        ref_id: p.id
      });
    }
  } catch { /* soft-fail */ }

  try {
    const finRuns = await supabaseAdmin
      .from('agent_runs')
      .select('id, started_at, summary')
      .eq('tenant_id', tenantId)
      .eq('agent_slug', 'finance')
      .order('started_at', { ascending: false })
      .limit(3);
    for (const r of finRuns.data || []) {
      activity.push({ at: r.started_at, kind: 'agent run', label: r.summary || 'Cashflow scan', ref_id: r.id });
    }
  } catch { /* soft-fail */ }

  activity.sort((a, b) => new Date(b.at) - new Date(a.at));

  return res.status(200).json({
    date: today,
    briefing: briefing.data || [],
    kpis: kpis.data || [],
    activity: activity.slice(0, 20),
    stats,
    latest_run: latest.data || null,
    last_updated_at: new Date().toISOString()
  });
}

export default requireTenant(handler);
