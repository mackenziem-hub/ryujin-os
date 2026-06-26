// ═══════════════════════════════════════════════════════════════
// /api/referrals — canonical 5% override tracking.
//
//   GET  /api/referrals?limit=500&status=open|earned|paid|voided
//        Returns rolled-up stats + per-referrer breakdown + raw rows.
//
//   POST /api/referrals
//        Operator manual entry. Body: { referrer_customer_id (req),
//        referred_customer_id?, referred_lead_name?, estimate_id?,
//        commission_rate?, notes? }.
//
//   PATCH /api/referrals?id=<uuid>
//        Update status / mark paid / set commission_amount.
//
// Write path also exists via tag convention `referred_by:<uuid>` on
// estimates (migration 052 backfills + cron promotes future tags).
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';
import { requirePillar } from '../lib/entitlements.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
    const status = req.query.status;

    let q = supabaseAdmin
      .from('referrals')
      .select(`
        id, status, commission_rate, commission_amount, earned_at, paid_at,
        notes, created_at, estimate_id, referred_lead_name,
        referrer:customers!referrals_referrer_customer_id_fkey(id, full_name),
        referred:customers!referrals_referred_customer_id_fkey(id, full_name),
        estimate:estimates(id, state, status, calculated_packages, selected_package, closed_won_at)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) q = q.eq('status', status);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const sellingPrice = (e) => {
      if (!e?.calculated_packages) return 0;
      const tier = (e.selected_package || 'gold').toLowerCase();
      const pkg = e.calculated_packages?.[tier] || {};
      // Precedence mirrors proposal.js: pkg.total is the canonical pre-tax rendered price
      // (carries negotiated/override values); summary.sellingPrice is the raw-engine-shape fallback.
      return pkg.total ?? pkg.summary?.sellingPrice ?? pkg.sellingPrice ?? 0;
    };

    // Compute commission_amount on the fly when not stored (open referrals
    // with a closed_won estimate but the column hasn't been backfilled yet).
    const enriched = (data || []).map(r => {
      const computedCommission = r.commission_amount ?? Math.round(sellingPrice(r.estimate) * (r.commission_rate || 0.05) * 100) / 100;
      return { ...r, commission_amount_computed: computedCommission };
    });

    // Per-referrer rollup.
    const byReferrer = new Map();
    for (const r of enriched) {
      const key = r.referrer?.id || 'unknown';
      if (!byReferrer.has(key)) {
        byReferrer.set(key, {
          referrer_id: key,
          referrer_name: r.referrer?.full_name || 'Unknown',
          total_referrals: 0,
          earned_count: 0,
          paid_count: 0,
          open_count: 0,
          earned_value: 0,
          paid_value: 0,
        });
      }
      const agg = byReferrer.get(key);
      agg.total_referrals++;
      if (r.status === 'open') agg.open_count++;
      if (r.status === 'earned') { agg.earned_count++; agg.earned_value += r.commission_amount_computed; }
      if (r.status === 'paid')   { agg.paid_count++; agg.paid_value += r.commission_amount_computed; }
    }

    const stats = {
      total: enriched.length,
      open: enriched.filter(r => r.status === 'open').length,
      earned: enriched.filter(r => r.status === 'earned').length,
      paid: enriched.filter(r => r.status === 'paid').length,
      voided: enriched.filter(r => r.status === 'voided').length,
      total_earned_value: enriched.filter(r => r.status === 'earned').reduce((s, r) => s + r.commission_amount_computed, 0),
      total_paid_value: enriched.filter(r => r.status === 'paid').reduce((s, r) => s + r.commission_amount_computed, 0),
    };

    return res.status(200).json({
      referrals: enriched,
      by_referrer: Array.from(byReferrer.values()).sort((a, b) => b.earned_value - a.earned_value),
      stats,
    });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.referrer_customer_id) return res.status(400).json({ error: 'referrer_customer_id required' });
    const insert = {
      tenant_id: tenantId,
      referrer_customer_id: body.referrer_customer_id,
      referred_customer_id: body.referred_customer_id || null,
      referred_lead_name: body.referred_lead_name || null,
      estimate_id: body.estimate_id || null,
      commission_rate: body.commission_rate ?? 0.050,
      status: body.status || 'open',
      notes: body.notes || null,
      created_by: body.created_by || null,
    };
    const { data, error } = await supabaseAdmin
      .from('referrals').insert(insert).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ referral: data });
  }

  if (req.method === 'PATCH') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id query param required' });
    const body = req.body || {};
    const allowed = ['status', 'commission_rate', 'commission_amount', 'earned_at', 'paid_at', 'notes', 'estimate_id'];
    const update = {};
    for (const k of allowed) if (k in body) update[k] = body[k];
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'no allowed fields to update' });
    if (update.status === 'paid' && !('paid_at' in update)) update.paid_at = new Date().toISOString();
    if (update.status === 'earned' && !('earned_at' in update)) update.earned_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('referrals').update(update).eq('id', id).eq('tenant_id', tenantId).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ referral: data });
  }

  return res.status(405).json({ error: 'GET, POST, PATCH only' });
}

export default requirePortalSessionAndTenant(requirePillar('customer')(handler));
