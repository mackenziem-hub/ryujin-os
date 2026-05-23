// Ryujin OS - Before/After photo selector
// GET /api/before-after?wo_id=X       -> { before: [...], after: [...] }
// GET /api/before-after?estimate_id=X -> same shape, scoped to one estimate
//
// Unions estimate_photos (caption in {before, after} OR category in
// {before, after}) with project_files (category in {before, after}).
// PR-C (static side-by-side generator) consumes this to populate its
// pair picker. The Photos & Video gallery in job.html also reads it
// to render BEFORE/AFTER badges without re-derivation.
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const tenantId = req.tenant.id;
  const { wo_id, estimate_id } = req.query || {};

  if (!wo_id && !estimate_id) {
    return res.status(400).json({ error: 'wo_id or estimate_id required' });
  }

  // Resolve customer + project from either input
  let customerId = null;
  if (estimate_id) {
    const { data: est } = await supabaseAdmin
      .from('estimates')
      .select('customer_id')
      .eq('tenant_id', tenantId)
      .eq('id', estimate_id)
      .maybeSingle();
    customerId = est?.customer_id || null;
  } else if (wo_id) {
    const { data: wo } = await supabaseAdmin
      .from('workorders')
      .select('linked_estimate_id, customer_name')
      .eq('tenant_id', tenantId)
      .eq('id', wo_id)
      .maybeSingle();
    if (wo?.linked_estimate_id) {
      const { data: est } = await supabaseAdmin
        .from('estimates')
        .select('customer_id')
        .eq('tenant_id', tenantId)
        .eq('id', wo.linked_estimate_id)
        .maybeSingle();
      customerId = est?.customer_id || null;
    }
    if (!customerId && wo?.customer_name) {
      const { data: cust } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('tenant_id', tenantId)
        .ilike('full_name', '%' + wo.customer_name + '%')
        .limit(1)
        .maybeSingle();
      customerId = cust?.id || null;
    }
  }

  if (!customerId) return res.json({ before: [], after: [] });

  // Estimate photos. estimate_photos has both `caption` (free-text) and
  // `category` (added by the photo manager). before/after match on either.
  let estIds = [];
  if (estimate_id) {
    estIds = [estimate_id];
  } else {
    const { data } = await supabaseAdmin
      .from('estimates')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId);
    estIds = (data || []).map(e => e.id);
  }

  let estPhotos = [];
  if (estIds.length) {
    const { data } = await supabaseAdmin
      .from('estimate_photos')
      .select('id, url, filename, mime_type, caption, category, is_cover, uploaded_at, estimate_id')
      .in('estimate_id', estIds)
      .or('caption.eq.before,caption.eq.after,category.eq.before,category.eq.after');
    estPhotos = (data || []).map(r => ({ ...r, source: 'estimate_photos' }));
  }

  // Project files. category column is the source of truth here.
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId);
  const pids = (projects || []).map(p => p.id);

  let projFiles = [];
  if (pids.length) {
    const { data } = await supabaseAdmin
      .from('project_files')
      .select('id, url, thumbnail_url, filename, mime_type, category, caption, is_cover, uploaded_at, captured_at, project_id')
      .eq('tenant_id', tenantId)
      .in('project_id', pids)
      .in('category', ['before', 'after']);
    projFiles = (data || [])
      .filter(r => typeof r.mime_type === 'string' && r.mime_type.startsWith('image/'))
      .map(r => ({ ...r, source: 'project_files' }));
  }

  const all = [...estPhotos, ...projFiles];

  function bucket(row) {
    const cat = String(row.category || '').toLowerCase();
    const cap = String(row.caption || '').toLowerCase();
    if (cat === 'before' || cap === 'before') return 'before';
    if (cat === 'after' || cap === 'after') return 'after';
    return null;
  }

  const before = all.filter(r => bucket(r) === 'before')
    .sort((a, b) => new Date(b.captured_at || b.uploaded_at || 0) - new Date(a.captured_at || a.uploaded_at || 0));
  const after = all.filter(r => bucket(r) === 'after')
    .sort((a, b) => new Date(b.captured_at || b.uploaded_at || 0) - new Date(a.captured_at || a.uploaded_at || 0));

  return res.json({ before, after, counts: { before: before.length, after: after.length } });
}

// Match api/estimate-photos.js auth model: portal session + tenant. The
// returned photo URLs are public Vercel Blob links so a missing auth here
// would leak customer media; tenant header alone is spoofable.
export default requirePortalSessionAndTenant(handler);
