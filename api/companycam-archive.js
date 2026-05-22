// Ryujin OS — CompanyCam Archive browser
// GET /api/companycam-archive                    : list projects (paginated, with search)
// GET /api/companycam-archive?id=X               : single project + its photos
// GET /api/companycam-archive?search=...         : address/name fuzzy search
// POST /api/companycam-archive/import-to-estimate : copy archive photos into estimate_photos
//
// Data lives in companycam_archive_projects + companycam_archive_photos (migration 070).
// Thumbnails are served from CompanyCam's img CDN via url_source. If those URLs ever
// expire we'll fall back to url_archived (set by a future mass-upload-to-Blob job).
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  // POST: import a set of archive photos into an estimate's gallery.
  if (req.method === 'POST') {
    const body = req.body || {};
    const estimateId = body.estimate_id;
    const photoIds = Array.isArray(body.archive_photo_ids) ? body.archive_photo_ids : [];
    const category = ['cover','before','after','damage','material','inspection','site','other','general']
      .includes(String(body.category||'').toLowerCase()) ? String(body.category).toLowerCase() : 'general';

    if (!estimateId) return res.status(400).json({ error: 'estimate_id required' });
    if (!photoIds.length) return res.status(400).json({ error: 'archive_photo_ids required' });

    const { data: est } = await supabaseAdmin
      .from('estimates').select('id').eq('id', estimateId).eq('tenant_id', tenantId).single();
    if (!est) return res.status(404).json({ error: 'estimate not found' });

    const { data: archived } = await supabaseAdmin
      .from('companycam_archive_photos')
      .select('id, url_source, url_archived, filename, captured_at, caption')
      .eq('tenant_id', tenantId)
      .in('id', photoIds);
    if (!archived || !archived.length) return res.status(404).json({ error: 'no matching archive photos' });

    const isCover = category === 'cover';
    if (isCover) {
      await supabaseAdmin.from('estimate_photos').update({ is_cover: false }).eq('estimate_id', estimateId);
    }
    // First photo becomes cover only if cover category requested; others share the role.
    const rows = archived.map((a, i) => ({
      estimate_id: estimateId,
      url: a.url_archived || a.url_source,
      filename: a.filename || `archive-${a.id}.jpg`,
      mime_type: 'image/jpeg',
      caption: a.caption || null,
      category,
      is_cover: isCover && i === 0,
    }));
    const { data: inserted, error } = await supabaseAdmin.from('estimate_photos').insert(rows).select('*');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ ok: true, imported: inserted.length, photos: inserted });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Single project + its photos
  if (req.query?.id) {
    const id = req.query.id;
    const { data: project, error: pErr } = await supabaseAdmin
      .from('companycam_archive_projects')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();
    if (pErr || !project) return res.status(404).json({ error: 'project not found' });

    const { data: photos } = await supabaseAdmin
      .from('companycam_archive_photos')
      .select('id, companycam_photo_id, filename, url_source, url_archived, bytes, captured_at, creator_name, lat, lng, caption, tags')
      .eq('archive_project_id', id)
      .eq('tenant_id', tenantId)
      .order('captured_at', { ascending: false, nullsFirst: false });
    return res.json({ project, photos: photos || [] });
  }

  // Project list with optional search
  const search = (req.query?.search || '').trim().toLowerCase();
  const limit = Math.min(Number(req.query?.limit) || 60, 200);
  const offset = Number(req.query?.offset) || 0;

  let q = supabaseAdmin
    .from('companycam_archive_projects')
    .select('id, companycam_project_id, name, status, archived, address, city, state, lat, lng, creator_name, photo_count, cover_url, created_at_companycam, updated_at_companycam', { count: 'exact' })
    .eq('tenant_id', tenantId);
  if (search) {
    const like = `%${search.replace(/[%_]/g, '\\$&')}%`;
    q = q.or(`name.ilike.${like},address.ilike.${like},city.ilike.${like},creator_name.ilike.${like}`);
  }
  q = q.order('updated_at_companycam', { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ projects: data || [], total: count, limit, offset });
}

export default requirePortalSessionAndTenant(handler);
