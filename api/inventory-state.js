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

  // Purchase orders (migration 063). Soft-fails before migration applied.
  let recentPos = [];
  try {
    const poOpen = await supabaseAdmin
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['draft', 'sent', 'confirmed', 'partial']);
    if (poOpen.count != null) stats.po_open = poOpen.count;

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const poReceived = await supabaseAdmin
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'received')
      .gte('actual_delivery_date', sevenDaysAgo);
    if (poReceived.count != null) stats.po_received_7d = poReceived.count;

    const todayDate = new Date().toISOString().slice(0, 10);
    const poOverdue = await supabaseAdmin
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['sent', 'confirmed', 'partial'])
      .lt('expected_delivery_date', todayDate);
    if (poOverdue.count != null) stats.po_overdue = poOverdue.count;

    const recent = await supabaseAdmin
      .from('purchase_orders')
      .select('id, po_number, status, total_amount, expected_delivery_date, created_at, merchant:merchants(name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (!recent.error) recentPos = recent.data || [];
  } catch { /* purchase_orders table doesn't exist yet — migration 063 pending */ }

  // ── Activity timeline: recent PO events ──
  const activity = recentPos.map(po => ({
    at: po.created_at,
    kind: `PO ${po.status}`,
    label: `${po.po_number} · ${po.merchant?.name || 'supplier'} · $${(po.total_amount || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    ref_id: po.id,
  }));

  return res.status(200).json({
    date: today,
    briefing: briefing.data || [],
    kpis: kpis.data || [],
    activity,
    stats,
    recent_pos: recentPos,
    latest_run: latest.data || null,
    last_updated_at: new Date().toISOString(),
  });
}

export default requireTenant(handler);
