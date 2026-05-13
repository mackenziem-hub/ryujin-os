// ═══════════════════════════════════════════════════════════════
// INVENTORY-STATE — bundled payload for /inventory.html (Materials panel).
//
// 9th canonical pillar — vendor/supplier mgmt + per-job material readiness.
// Stub v1: pulls counts from existing merchants/merchant_products schema
// (migrations 004-006); full PO/readiness tables land in Phase 3.
//
// GET /api/inventory-state[?user_id=<uuid>]
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const userId = req.query.user_id || null;
  const today = new Date().toISOString().slice(0, 10);

  // ── Briefing items: source_agent='inventory' (scanner lands in Phase 2) ──
  let briefingQ = supabaseAdmin
    .from('briefing_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('source_agent', 'inventory')
    .eq('for_date', today)
    .is('dismissed_at', null)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(40);
  if (userId) briefingQ = briefingQ.or(`for_user_id.eq.${userId},for_user_id.is.null`);
  const briefing = await briefingQ;

  // ── KPIs: keys prefixed with 'inventory.' ──
  const kpis = await supabaseAdmin
    .from('kpis')
    .select('*')
    .eq('tenant_id', tenantId)
    .like('key', 'inventory.%')
    .order('sort_order', { ascending: true });

  // ── Latest inventory agent run (none yet — Phase 2 will populate) ──
  const latest = await supabaseAdmin
    .from('agent_runs')
    .select('id, agent_slug, trigger, started_at, completed_at, status, summary, emitted_quests, emitted_kpis, emitted_briefs')
    .eq('tenant_id', tenantId)
    .eq('agent_slug', 'inventory')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── Stats from existing schema ──
  const stats = {
    merchants_count: 0,
    products_count: 0,
    po_open: 0,
    po_received_7d: 0,
  };

  const merchants = await supabaseAdmin
    .from('merchants')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  if (merchants.count != null) stats.merchants_count = merchants.count;

  const products = await supabaseAdmin
    .from('merchant_products')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  if (products.count != null) stats.products_count = products.count;

  // purchase_orders table lands in Phase 3 — soft-fail until then
  try {
    const poOpen = await supabaseAdmin
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['draft', 'sent', 'confirmed']);
    if (poOpen.count != null) stats.po_open = poOpen.count;
  } catch { /* table doesn't exist yet */ }

  return res.status(200).json({
    date: today,
    briefing: briefing.data || [],
    kpis: kpis.data || [],
    activity: [],
    stats,
    latest_run: latest.data || null,
    last_updated_at: new Date().toISOString(),
  });
}

export default requireTenant(handler);
