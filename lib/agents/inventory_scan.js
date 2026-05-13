// ═══════════════════════════════════════════════════════════════
// INVENTORY AGENT — Catherine's pillar (Materials).
//
// 9th canonical pillar. Surfaces supplier-coordination + catalog-health
// signals from existing merchants/merchant_products schema (migration
// 004-006). PO/readiness deeper signals land in Phase 3 once
// purchase_orders + job_material_readiness tables exist.
//
// Returns the same { agent, role, timestamp, findings, tasks, stats }
// shape as customer_scan / service_scan so it slots into persistAgentRun
// alongside the rest of the agent fleet.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../supabase.js';

const STALE_PRICE_DAYS = 90;        // last_verified_at older than this = stale
const VERY_STALE_PRICE_DAYS = 180;  // urgent threshold
const HIGH_STALE_RATIO = 0.30;      // >30% of catalog stale = warning finding

export async function runInventoryScan({ tenantSlug = 'plus-ultra' } = {}) {
  const report = {
    agent: 'Inventory',
    role: 'Suppliers, catalog health, material coordination (Catherine\'s pillar)',
    timestamp: new Date().toISOString(),
    findings: [],
    tasks: [],
    stats: {}
  };

  // Resolve tenant
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
  const staleCutoff = new Date(now - STALE_PRICE_DAYS * 86400000).toISOString();
  const veryStaleCutoff = new Date(now - VERY_STALE_PRICE_DAYS * 86400000).toISOString();

  // ── Merchants (tenant + platform-wide) ──
  const ms = await supabaseAdmin
    .from('merchants')
    .select('id, name, slug, type, city, active, updated_at')
    .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
    .order('name', { ascending: true })
    .limit(500);

  if (ms.error) {
    report.findings.push(`merchants fetch failed: ${ms.error.message}`);
    return report;
  }
  const merchants = ms.data || [];

  const stats = report.stats = {
    merchants_total: merchants.length,
    merchants_active: 0,
    merchants_inactive: 0,
    merchants_no_catalog: 0,
    products_total: 0,
    products_in_stock: 0,
    products_out_of_stock: 0,
    products_missing_lead_time: 0,
    products_stale_price: 0,
    products_very_stale_price: 0,
    stale_price_pct: 0,
    suppliers_with_stale_catalog: 0
  };

  for (const m of merchants) {
    if (m.active === false) stats.merchants_inactive++;
    else stats.merchants_active++;
  }

  // ── Merchant products (this tenant's catalog) ──
  const mp = await supabaseAdmin
    .from('merchant_products')
    .select('id, merchant_id, price, in_stock, lead_time_days, last_verified_at, auto_update')
    .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
    .limit(5000);

  if (mp.error) {
    report.findings.push(`merchant_products fetch failed: ${mp.error.message}`);
    // Continue with merchant-only findings
  }

  const products = mp.data || [];
  stats.products_total = products.length;

  const merchantHasProducts = new Set();
  const staleProductsByMerchant = new Map(); // merchant_id → count

  for (const p of products) {
    if (p.merchant_id) merchantHasProducts.add(p.merchant_id);
    if (p.in_stock === true) stats.products_in_stock++;
    else if (p.in_stock === false) stats.products_out_of_stock++;
    if (p.lead_time_days == null) stats.products_missing_lead_time++;

    if (p.last_verified_at) {
      if (p.last_verified_at < veryStaleCutoff) {
        stats.products_very_stale_price++;
        stats.products_stale_price++;
        staleProductsByMerchant.set(p.merchant_id, (staleProductsByMerchant.get(p.merchant_id) || 0) + 1);
      } else if (p.last_verified_at < staleCutoff) {
        stats.products_stale_price++;
        staleProductsByMerchant.set(p.merchant_id, (staleProductsByMerchant.get(p.merchant_id) || 0) + 1);
      }
    } else {
      // Never verified = treat as stale
      stats.products_stale_price++;
      staleProductsByMerchant.set(p.merchant_id, (staleProductsByMerchant.get(p.merchant_id) || 0) + 1);
    }
  }

  for (const m of merchants) {
    if (!merchantHasProducts.has(m.id)) stats.merchants_no_catalog++;
  }

  if (stats.products_total > 0) {
    stats.stale_price_pct = Math.round((stats.products_stale_price / stats.products_total) * 1000) / 10;
  }

  // Suppliers with majority-stale catalog (>50% of their products stale)
  const productsPerMerchant = new Map();
  for (const p of products) {
    if (p.merchant_id) productsPerMerchant.set(p.merchant_id, (productsPerMerchant.get(p.merchant_id) || 0) + 1);
  }
  for (const [mid, staleCount] of staleProductsByMerchant) {
    const total = productsPerMerchant.get(mid) || 0;
    if (total >= 3 && staleCount / total > 0.5) stats.suppliers_with_stale_catalog++;
  }

  // ── Purchase orders (soft-fail until table lands in Phase 3) ──
  try {
    const poOpen = await supabaseAdmin
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['draft', 'sent', 'confirmed']);
    if (poOpen.count != null) stats.po_open = poOpen.count;
  } catch { /* purchase_orders table doesn't exist yet */ }

  // ── Findings + tasks ──
  report.findings.push(
    `Suppliers: ${stats.merchants_active} active, ${stats.merchants_inactive} inactive, ${stats.merchants_no_catalog} without catalog · Products: ${stats.products_total} (${stats.products_in_stock} in stock)`
  );

  if (stats.products_very_stale_price > 0) {
    report.findings.push(
      `${stats.products_very_stale_price} products last priced ${VERY_STALE_PRICE_DAYS}+ days ago — pricing drift risk on quotes`
    );
    report.tasks.push({
      title: `Refresh pricing on ${stats.products_very_stale_price} very-stale catalog products`,
      description: `Products in merchant_products with last_verified_at > ${VERY_STALE_PRICE_DAYS} days. Quote engine fall-through uses these — drift means margin error. Walk top 10 first.`,
      priority: stats.products_very_stale_price >= 50 ? 'high' : 'medium'
    });
  } else if (stats.products_stale_price > 0 && stats.products_total > 0 && stats.stale_price_pct >= HIGH_STALE_RATIO * 100) {
    report.findings.push(
      `${stats.products_stale_price} of ${stats.products_total} products (${stats.stale_price_pct}%) priced ${STALE_PRICE_DAYS}+ days ago`
    );
    report.tasks.push({
      title: `Pricing refresh batch — ${stats.products_stale_price} products`,
      description: `Catalog freshness ${stats.stale_price_pct}% stale. Sets up next quote cycle for accurate margins.`,
      priority: 'medium'
    });
  }

  if (stats.products_out_of_stock >= 5) {
    report.findings.push(
      `${stats.products_out_of_stock} products marked out-of-stock — may block jobs in flight`
    );
    report.tasks.push({
      title: `Reconcile ${stats.products_out_of_stock} out-of-stock catalog products`,
      description: `Walk the OOS list. For each: verify with supplier (still OOS? ETA?), or update in_stock=true if back. Affects material orders.`,
      priority: 'medium'
    });
  }

  if (stats.products_missing_lead_time >= 10) {
    report.findings.push(
      `${stats.products_missing_lead_time} products missing lead_time_days — material order timing flying blind`
    );
    report.tasks.push({
      title: `Backfill lead times for ${stats.products_missing_lead_time} products`,
      description: `Lead time drives material order timing. Ask supplier per product family (asphalt = X days, metal = Y, EPS = Z).`,
      priority: 'normal'
    });
  }

  if (stats.suppliers_with_stale_catalog > 0) {
    report.findings.push(
      `${stats.suppliers_with_stale_catalog} supplier${stats.suppliers_with_stale_catalog === 1 ? '' : 's'} with majority-stale catalog (>50% of their products)`
    );
    report.tasks.push({
      title: `Re-engage ${stats.suppliers_with_stale_catalog} dormant supplier${stats.suppliers_with_stale_catalog === 1 ? '' : 's'}`,
      description: `These suppliers haven't been price-refreshed in months. Either drop them or call for a fresh quote sheet.`,
      priority: 'normal'
    });
  }

  if (stats.merchants_no_catalog > 0 && stats.merchants_no_catalog < merchants.length) {
    report.findings.push(
      `${stats.merchants_no_catalog} suppliers in directory but no catalog products`
    );
  }

  return report;
}
