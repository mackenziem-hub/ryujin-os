// Ryujin OS · Custom Proposals CRUD
//
// GET    /api/custom-proposals               -> list for tenant
// GET    /api/custom-proposals?slug=<slug>   -> fetch one by slug (used by renderer + accept)
// POST   /api/custom-proposals               -> create a new one (auth required)
// PATCH  /api/custom-proposals?slug=<slug>   -> update (status, accepted_at, etc.)
//
// Backed by the custom_proposals table (migration 067).
//
// Auth:
//   - GET single by slug is PUBLIC (the renderer serves customer-facing pages)
//   - GET list is tenant-auth required (admin)
//   - POST and PATCH are tenant-auth required (admin form)

import { supabaseAdmin } from '../lib/supabase.js';
import { resolveTenant } from '../lib/tenant.js';

const FIELDS = `
  id, slug, quote_id,
  customer_name, customer_email, customer_phone, address, ghl_contact_id,
  sales_rep, sales_rep_phone, sales_rep_email,
  scope_title, scope_long, scope_grid, deliverables, exclusions,
  redecking_risk, redecking_sheet_price, redecking_notice_text,
  subtotal, hst_pct, hst_amount, total_incl_hst, deposit_pct, deposit, balance,
  warranty_years, warranty_text,
  cover_url,
  issued_date, valid_days, status,
  accepted_by, accepted_at,
  created_at, updated_at
`;

function bad(res, code, msg, extra = {}) {
  return res.status(code).json({ error: msg, ...extra });
}

function computePricing({ subtotal, hst_pct = 15, deposit_pct = 30 }) {
  const sub = Number(subtotal);
  if (!Number.isFinite(sub) || sub <= 0) throw new Error('subtotal must be a positive number');
  const hp = Number(hst_pct);
  const dp = Number(deposit_pct);
  const hst_amount = Math.round((sub * (hp / 100)) * 100) / 100;
  const total_incl_hst = Math.round((sub + hst_amount) * 100) / 100;
  const deposit = Math.round((total_incl_hst * (dp / 100)) * 100) / 100;
  const balance = Math.round((total_incl_hst - deposit) * 100) / 100;
  return { hst_amount, total_incl_hst, deposit, balance };
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function uniqueSlug(base) {
  let attempt = base;
  for (let i = 0; i < 50; i++) {
    const { data } = await supabaseAdmin
      .from('custom_proposals')
      .select('slug')
      .eq('slug', attempt)
      .maybeSingle();
    if (!data) return attempt;
    i === 0 ? attempt = `${base}-2` : attempt = `${base}-${i + 2}`;
  }
  throw new Error('could not generate unique slug after 50 attempts');
}

async function handleGetSingle(req, res, slug) {
  const { data, error } = await supabaseAdmin
    .from('custom_proposals')
    .select(FIELDS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) return bad(res, 500, 'db_error', { detail: error.message });
  if (!data) return bad(res, 404, 'not_found', { slug });
  return res.status(200).json(data);
}

async function handleList(req, res) {
  const tenant = await resolveTenant(req);
  if (!tenant) return bad(res, 400, 'tenant_required');
  const { data, error } = await supabaseAdmin
    .from('custom_proposals')
    .select(FIELDS)
    .eq('tenant_id', tenant.id)
    .order('issued_date', { ascending: false });
  if (error) return bad(res, 500, 'db_error', { detail: error.message });
  return res.status(200).json({ proposals: data || [] });
}

async function handleCreate(req, res) {
  const tenant = await resolveTenant(req);
  if (!tenant) return bad(res, 400, 'tenant_required');

  const body = req.body && typeof req.body === 'object' ? req.body : (() => {
    try { return JSON.parse(req.body || '{}'); } catch { return {}; }
  })();

  const customer_name = String(body.customer_name || '').trim();
  const address = String(body.address || '').trim();
  if (!customer_name) return bad(res, 400, 'customer_name_required');
  if (!address) return bad(res, 400, 'address_required');

  let { subtotal, hst_pct, deposit_pct } = body;
  let pricing;
  try { pricing = computePricing({ subtotal, hst_pct, deposit_pct }); }
  catch (e) { return bad(res, 400, 'pricing_invalid', { detail: e.message }); }

  // Slug: form-supplied → fall back to address+lastname
  let slug = String(body.slug || '').trim();
  if (!slug) {
    const lastName = customer_name.split(/\s+/).slice(-1)[0] || customer_name;
    const addrPart = address.split(',')[0];
    slug = slugify(`${addrPart} ${lastName}`);
  } else {
    slug = slugify(slug);
  }
  slug = await uniqueSlug(slug);

  // Quote ID: form-supplied → fall back to sequential
  let quote_id = String(body.quote_id || '').trim();
  if (!quote_id) {
    const lastName = customer_name.split(/\s+/).slice(-1)[0] || 'X';
    const initials = lastName.slice(0, 2).toUpperCase();
    const num = address.match(/\d+/)?.[0] || '00';
    quote_id = `PU-2026-${initials}${num}`;
  }

  const row = {
    tenant_id: tenant.id,
    slug,
    quote_id,
    customer_name,
    customer_email: body.customer_email || null,
    customer_phone: body.customer_phone || null,
    address,
    ghl_contact_id: body.ghl_contact_id || null,
    sales_rep: body.sales_rep || 'Mackenzie Mazerolle',
    sales_rep_phone: body.sales_rep_phone || '(506) 616-4607',
    sales_rep_email: body.sales_rep_email || 'mackenzie.m@plusultraroofing.com',
    scope_title: body.scope_title || 'Custom Partial Reroof',
    scope_long: body.scope_long || null,
    scope_grid: Array.isArray(body.scope_grid) ? body.scope_grid : [],
    deliverables: Array.isArray(body.deliverables) ? body.deliverables : [],
    exclusions: Array.isArray(body.exclusions) ? body.exclusions : [],
    redecking_risk: Boolean(body.redecking_risk),
    redecking_sheet_price: Number(body.redecking_sheet_price ?? 85.00),
    redecking_notice_text: body.redecking_notice_text || null,
    subtotal: Number(subtotal),
    hst_pct: Number(hst_pct ?? 15),
    hst_amount: pricing.hst_amount,
    total_incl_hst: pricing.total_incl_hst,
    deposit_pct: Number(deposit_pct ?? 30),
    deposit: pricing.deposit,
    balance: pricing.balance,
    warranty_years: Number(body.warranty_years ?? 15),
    warranty_text: body.warranty_text || null,
    cover_url: body.cover_url || null,
    issued_date: body.issued_date || new Date().toISOString().slice(0, 10),
    valid_days: Number(body.valid_days ?? 30),
    status: body.status || 'draft',
    created_by: tenant.user_id || null
  };

  const { data, error } = await supabaseAdmin
    .from('custom_proposals')
    .insert(row)
    .select(FIELDS)
    .single();
  if (error) return bad(res, 500, 'create_failed', { detail: error.message });

  return res.status(201).json({
    ok: true,
    proposal: data,
    url: `/proposals/custom/${data.slug}`,
    accept_url: `/proposals/custom/${data.slug}`
  });
}

async function handleUpdate(req, res, slug) {
  const tenant = await resolveTenant(req);
  if (!tenant) return bad(res, 400, 'tenant_required');

  const body = req.body && typeof req.body === 'object' ? req.body : (() => {
    try { return JSON.parse(req.body || '{}'); } catch { return {}; }
  })();

  const ALLOWED = [
    'status', 'accepted_by', 'accepted_at', 'accepted_payload',
    'customer_email', 'customer_phone', 'ghl_contact_id',
    'cover_url', 'scope_long', 'scope_grid', 'deliverables', 'exclusions',
    'redecking_risk', 'redecking_sheet_price', 'redecking_notice_text',
    'warranty_text', 'valid_days'
  ];
  const patch = {};
  for (const k of ALLOWED) if (k in body) patch[k] = body[k];
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('custom_proposals')
    .update(patch)
    .eq('tenant_id', tenant.id)
    .eq('slug', slug)
    .select(FIELDS)
    .maybeSingle();
  if (error) return bad(res, 500, 'update_failed', { detail: error.message });
  if (!data) return bad(res, 404, 'not_found', { slug });
  return res.status(200).json({ ok: true, proposal: data });
}

export default async function handler(req, res) {
  const slug = req.query?.slug ? String(req.query.slug).trim() : '';

  if (req.method === 'GET') {
    if (slug) return handleGetSingle(req, res, slug);
    return handleList(req, res);
  }
  if (req.method === 'POST') return handleCreate(req, res);
  if (req.method === 'PATCH') {
    if (!slug) return bad(res, 400, 'slug_required_for_patch');
    return handleUpdate(req, res, slug);
  }
  res.setHeader('Allow', 'GET, POST, PATCH');
  return bad(res, 405, 'method_not_allowed');
}
