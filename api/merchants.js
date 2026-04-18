// Ryujin OS — Merchants & Products API
// GET /api/merchants                         — List merchants
// GET /api/merchants?id=X                    — Get merchant with products
// GET /api/merchants?mode=products           — Browse product catalog (hierarchical)
// GET /api/merchants?mode=search&q=landmark  — Search products
// GET /api/merchants?mode=price&product_id=X — Get best price for a product (resolution chain)
// GET /api/merchants?mode=pickup&estimate_id=X — Generate material pickup list for a job
// POST /api/merchants                        — Create merchant
// POST /api/merchants (mode=product)         — Add product to catalog
// POST /api/merchants (mode=price)           — Set merchant price for a product
// PUT /api/merchants                         — Update merchant, product, or price
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { id, mode, q, product_id, category, estimate_id } = req.query;

    // Single merchant with its products
    if (id) {
      const { data: merchant } = await supabaseAdmin
        .from('merchants').select('*').eq('id', id).single();
      if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

      const { data: products } = await supabaseAdmin
        .from('merchant_products')
        .select('*, product:products(name, brand, unit, category:product_categories(name, path))')
        .eq('merchant_id', id)
        .order('product(name)');

      return res.json({ merchant, products });
    }

    // Browse product catalog (hierarchical categories)
    if (mode === 'products') {
      const { data: categories } = await supabaseAdmin
        .from('product_categories')
        .select('*')
        .order('path');

      let productQuery = supabaseAdmin
        .from('products')
        .select('*, category:product_categories(name, path)')
        .eq('active', true)
        .order('name');

      if (category) productQuery = productQuery.eq('category_id', category);

      const { data: products } = await productQuery;

      return res.json({ categories, products });
    }

    // Search products
    if (mode === 'search' && q) {
      const { data: products } = await supabaseAdmin
        .from('products')
        .select('*, category:product_categories(name, path)')
        .or(`name.ilike.%${q}%,brand.ilike.%${q}%,tags.cs.{${q}}`)
        .eq('active', true)
        .limit(20);

      return res.json({ products });
    }

    // Price resolution for a specific product
    if (mode === 'price' && product_id) {
      // 1. Check tenant's merchant prices
      const { data: merchantPrices } = await supabaseAdmin
        .from('merchant_products')
        .select('*, merchant:merchants(name, city)')
        .eq('product_id', product_id)
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
        .eq('in_stock', true)
        .order('price');

      if (merchantPrices && merchantPrices.length > 0) {
        return res.json({
          source: 'merchant',
          best: merchantPrices[0],
          all: merchantPrices,
          product_id
        });
      }

      // 2. Check regional pricing
      const { data: product } = await supabaseAdmin
        .from('products').select('category_id').eq('id', product_id).single();

      if (product) {
        const { data: regional } = await supabaseAdmin
          .from('regional_pricing')
          .select('*')
          .or(`product_id.eq.${product_id},category_id.eq.${product.category_id}`)
          .order('geo_level'); // most specific first by convention

        if (regional && regional.length > 0) {
          return res.json({ source: 'regional', pricing: regional[0], all: regional, product_id });
        }
      }

      return res.json({ source: 'none', product_id, message: 'No pricing data found. Manual entry required.' });
    }

    // Material pickup list for a job
    if (mode === 'pickup' && estimate_id) {
      const { data: estimate } = await supabaseAdmin
        .from('estimates')
        .select('*')
        .eq('id', estimate_id)
        .eq('tenant_id', tenantId)
        .single();

      if (!estimate) return res.status(404).json({ error: 'Estimate not found' });

      // Get all merchant products for this tenant, grouped by merchant
      const { data: allPrices } = await supabaseAdmin
        .from('merchant_products')
        .select('*, product:products(name, unit, units_per_coverage), merchant:merchants(name, address, city)')
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
        .eq('in_stock', true)
        .order('merchant(name)');

      // Group by merchant
      const byMerchant = {};
      for (const mp of (allPrices || [])) {
        const mName = mp.merchant?.name || 'Unknown';
        if (!byMerchant[mName]) byMerchant[mName] = { merchant: mp.merchant, items: [] };
        byMerchant[mName].items.push({
          product: mp.product?.name,
          unit: mp.product?.unit,
          price: mp.price,
          aisle: mp.aisle,
          sku: mp.sku,
          stock: mp.stock_qty
        });
      }

      return res.json({
        estimate_id,
        address: estimate.address || 'Unknown',
        merchants: byMerchant,
        note: 'Quantities not calculated — use quote engine output for exact material counts.'
      });
    }

    // List all merchants
    const { data, error } = await supabaseAdmin
      .from('merchants')
      .select('*')
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .eq('active', true)
      .order('name');

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ merchants: data });
  }

  // ── POST ──
  if (req.method === 'POST') {
    const body = req.body || {};

    // Add product to catalog
    if (body.mode === 'product') {
      const { data, error } = await supabaseAdmin
        .from('products')
        .insert({
          category_id: body.category_id,
          name: body.name,
          description: body.description,
          unit: body.unit || 'each',
          units_per_coverage: body.units_per_coverage,
          brand: body.brand,
          model: body.model,
          specs: body.specs || {},
          photo_url: body.photo_url,
          tags: body.tags || []
        })
        .select('*')
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json(data);
    }

    // Set merchant price for a product
    if (body.mode === 'price') {
      const { data, error } = await supabaseAdmin
        .from('merchant_products')
        .upsert({
          merchant_id: body.merchant_id,
          product_id: body.product_id,
          tenant_id: tenantId,
          price: body.price,
          sku: body.sku,
          aisle: body.aisle,
          product_url: body.product_url,
          in_stock: body.in_stock !== false,
          stock_qty: body.stock_qty,
          verified_by: 'manual'
        }, { onConflict: 'merchant_id,product_id,tenant_id' })
        .select('*')
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    // Create merchant
    const slug = (body.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const { data, error } = await supabaseAdmin
      .from('merchants')
      .insert({
        tenant_id: tenantId,
        name: body.name,
        slug,
        type: body.type || 'retail',
        address: body.address,
        city: body.city,
        province: body.province,
        postal_code: body.postal_code,
        phone: body.phone,
        website: body.website,
        product_url_pattern: body.product_url_pattern
      })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    const { id, type, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const table = type === 'product' ? 'products'
      : type === 'price' ? 'merchant_products'
      : 'merchants';

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
