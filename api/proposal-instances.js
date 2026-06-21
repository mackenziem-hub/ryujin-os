// Ryujin OS - v2 proposal instances: list + clone (the proposal manager surface).
//
// GET  /api/proposal-instances             - list this tenant's v2 proposals
//        ?status=draft|sent|accepted|...     filter by lifecycle bucket
//        ?q=<text>                           search customer name / address / slug
//        ?limit=<n>                          cap (default 200, max 500)
// POST /api/proposal-instances             - CLONE an existing instance into a new DRAFT
//        { cloneFrom:<slug>, customer?:{name,address,email,phone}, recommended? }
//
// Clone copies the FROZEN data_snapshot of the source verbatim, applies optional
// shallow edits (customer identity + recommended tier), and inserts a NEW draft
// instance with a fresh slug + share token. The source row is never touched, so
// sent proposals stay frozen (feedback_no_changes_to_sent_proposals). This is the
// UI replacement for the one-shot _proposal-clone script, so Cat can replicate a
// proposal (e.g. for a neighbour) without running a script.
//
// Auth: Bearer service token + x-tenant-id (requireTenant), same gate as
// /api/proposal-templates and /api/proposal-materialize. No em dashes.
import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

function kebab(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'proposal';
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise(resolve => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function clone(v) { return v ? JSON.parse(JSON.stringify(v)) : v; }

// Project a heavy instance record down to a light list row. Avoids shipping the
// full data_snapshot to the browser; name/address come from the frozen variables,
// the headline price from the recommended (or lowest) pricing tier.
function toRow(r) {
  const vars = r.variables || {};
  const cust = vars.customer || {};
  const pricing = r.pricing_snapshot || {};
  const sel = r.product_selection || {};
  const recommended = sel.recommended || pricing.recommended || null;
  const tiers = Array.isArray(pricing.tiers) ? pricing.tiers : [];
  let total = null;
  if (recommended) {
    const t = tiers.find(x => x && (x.id === recommended || x.tier === recommended));
    if (t) total = num(t.total) || null;
  }
  if (total == null && tiers.length) {
    const totals = tiers.map(t => num(t && t.total)).filter(Boolean);
    if (totals.length) total = Math.min(...totals);
  }
  return {
    slug: r.slug,
    shareToken: r.share_token || null,
    customer: cust.name || vars.name || vars.customerName || '(no name)',
    address: cust.address || vars.address || '',
    status: r.status || 'draft',
    recommended,
    total,
    mode: pricing.mode || sel.mode || null,
    viewCount: num(r.view_count),
    lastViewedAt: r.last_viewed_at || null,
    sentAt: r.sent_at || null,
    createdAt: r.created_at || null,
    updatedAt: r.updated_at || null,
    estimateId: r.estimate_id || null,
    url: '/p/' + r.slug,
    pdfUrl: r.slug ? ('/api/proposal-v2-pdf?slug=' + encodeURIComponent(r.slug)) : null
  };
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
    let query = supabaseAdmin
      .from('proposal_instances')
      .select('slug, share_token, estimate_id, status, product_selection, pricing_snapshot, variables, view_count, last_viewed_at, sent_at, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    let rows = (data || []).map(toRow);
    if (q) rows = rows.filter(r => (r.customer + ' ' + r.address + ' ' + r.slug).toLowerCase().includes(q));
    const counts = { total: rows.length, byStatus: {} };
    for (const r of rows) counts.byStatus[r.status] = (counts.byStatus[r.status] || 0) + 1;
    return res.json({ ok: true, counts, proposals: rows });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const cloneFrom = String(body.cloneFrom || body.slug || '').trim();
    if (!cloneFrom) return res.status(400).json({ error: 'Need { cloneFrom: <slug> } to clone' });

    // Load the source instance, scoped to this tenant.
    const { data: src, error: srcErr } = await supabaseAdmin
      .from('proposal_instances')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('slug', cloneFrom)
      .maybeSingle();
    if (srcErr) return res.status(500).json({ error: srcErr.message });
    if (!src) return res.status(404).json({ error: 'Source proposal not found: ' + cloneFrom });

    // Deep copy every snapshot field so nothing aliases the source row.
    const snap = clone(src.data_snapshot) || null;
    const variables = clone(src.variables) || {};
    const productSelection = clone(src.product_selection) || {};
    const pricingSnapshot = clone(src.pricing_snapshot) || {};
    const sections = clone(src.sections) || [];

    // Optional shallow edits: customer identity + recommended tier.
    const cust = (body.customer && typeof body.customer === 'object') ? body.customer : null;
    if (cust) {
      variables.customer = { ...(variables.customer || {}), ...cust };
      if (cust.name) variables.name = cust.name;
      if (snap) {
        snap.customer = { ...(snap.customer || {}), ...cust };
        snap.variables = { ...(snap.variables || {}) };
        snap.variables.customer = { ...(snap.variables.customer || {}), ...cust };
        if (cust.name) snap.variables.name = cust.name;
      }
    }
    const recommended = body.recommended ? String(body.recommended) : null;
    if (recommended) {
      productSelection.recommended = recommended;
      if (pricingSnapshot && typeof pricingSnapshot === 'object') pricingSnapshot.recommended = recommended;
      if (snap && snap.products) snap.products.recommended = recommended;
    }

    const shareToken = randomBytes(12).toString('hex');
    const base = kebab(
      (cust && cust.address) ||
      (variables.customer && variables.customer.address) ||
      (snap && snap.customer && snap.customer.address) ||
      (variables.customer && variables.customer.name) ||
      cloneFrom
    );
    const slug = `${base}-${shareToken.slice(0, 6)}`;
    if (snap && snap.meta) { snap.meta.instanceSlug = slug; snap.meta.status = 'draft'; }

    const now = new Date().toISOString();
    const row = {
      tenant_id: tenantId,
      slug,
      share_token: shareToken,
      estimate_id: src.estimate_id || null,
      template_id: src.template_id || null,
      customer_id: src.customer_id || null,
      ghl_contact_id: src.ghl_contact_id || null,
      sections,
      product_selection: productSelection,
      variables,
      pricing_snapshot: pricingSnapshot,
      data_snapshot: snap,
      renderer_version: src.renderer_version || 'v2',
      status: 'draft',
      sent_at: null,
      locked_at: now
    };
    const { data: inserted, error } = await supabaseAdmin
      .from('proposal_instances')
      .insert(row)
      .select('id, slug, share_token, status')
      .single();
    if (error) return res.status(500).json({ error: 'Clone failed', message: error.message });
    return res.status(201).json({
      ok: true,
      instanceId: inserted.id,
      slug: inserted.slug,
      shareToken: inserted.share_token,
      status: inserted.status,
      url: '/p/' + inserted.slug,
      clonedFrom: cloneFrom
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
