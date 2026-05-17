// Ryujin OS — Projects CRUD
// GET    /api/projects              — List projects (with filters)
// GET    /api/projects?id=X         — Get single project with files, comments, tickets
// GET    /api/projects?share=TOKEN  — Client portal view (no auth needed)
// POST   /api/projects              — Create project
// PUT    /api/projects              — Update project
import { supabaseAdmin } from '../lib/supabase.js';
import { resolveTenant, requireTenant } from '../lib/tenant.js';
import { gmailSend } from '../lib/google.js';

const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL || 'mackenzie.m@plusultraroofing.com').trim();
const PHOTO_GALLERY_NOTIFIED_TAG = 'owner:photo_gallery_opened';

// Fire once per project the first time its photo-share URL is hit. Mirrors the
// proposal-events first-open pattern: idempotency via a tag on projects.tags.
async function maybeNotifyFirstGalleryOpen(project) {
  try {
    const tags = Array.isArray(project.tags) ? project.tags : [];
    if (tags.includes(PHOTO_GALLERY_NOTIFIED_TAG)) return;

    const newTags = [...tags, PHOTO_GALLERY_NOTIFIED_TAG];
    const { error: tagErr } = await supabaseAdmin
      .from('projects')
      .update({ tags: newTags })
      .eq('id', project.id)
      .eq('tenant_id', project.tenant_id);
    if (tagErr) {
      console.error('[projects] gallery first-open tag write failed', tagErr.message);
      return;
    }

    const customerName = project.customer?.full_name || 'Customer';
    const shareUrl = `https://ryujin-os.vercel.app/photos-share.html?share=${encodeURIComponent(project.share_token || '')}`;
    const backofficeUrl = `https://ryujin-os.vercel.app/job.html?id=${encodeURIComponent(project.customer_id || '')}`;

    const subject = `PHOTO GALLERY OPENED · ${customerName} · ${project.address || project.name}`;
    const body = [
      `${customerName} just opened the photo gallery for the first time.`,
      ``,
      `Project: ${project.name || '—'}`,
      `Address: ${project.address || '—'}`,
      `City:    ${project.city || '—'}`,
      `Opened:  ${new Date().toISOString()}`,
      ``,
      `Customer view: ${shareUrl}`,
      `Back office:   ${backofficeUrl}`,
      ``,
      `Subsequent opens from this customer will NOT re-notify — first-touch signal only.`,
      `— Ryujin OS`
    ].join('\n');

    await gmailSend(NOTIFY_EMAIL, subject, body);
  } catch (e) {
    console.error('[projects] gallery first-open notify failed', e?.message);
  }
}

// Client portal — public access via share token
async function handleShareAccess(req, res) {
  const token = req.query.share;
  const { data: project, error } = await supabaseAdmin
    .from('projects')
    .select(`
      id, tenant_id, customer_id, name, address, city, province, status, created_at,
      share_token, share_expires_at, tags,
      customer:customers(full_name),
      tenant:tenants(name, branding)
    `)
    .eq('share_token', token)
    .single();

  if (error || !project) return res.status(404).json({ error: 'Project not found or link expired' });

  // Check expiry
  if (project.share_expires_at && new Date(project.share_expires_at) < new Date()) {
    return res.status(410).json({ error: 'This share link has expired' });
  }

  // Fire-and-forget owner notification on first open (idempotent via tags)
  maybeNotifyFirstGalleryOpen(project).catch(() => {});

  // Get client-visible files only
  const { data: files } = await supabaseAdmin
    .from('project_files')
    .select('id, url, thumbnail_url, filename, mime_type, category, caption, tags, annotations, annotated_url, uploaded_at, captured_at, latitude, longitude, sort_order, is_cover')
    .eq('project_id', project.id)
    .eq('client_visible', true)
    .order('is_cover', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('captured_at', { ascending: false });

  // Get non-internal comments
  const { data: comments } = await supabaseAdmin
    .from('comments')
    .select('id, body, guest_name, user_id, file_id, created_at')
    .eq('project_id', project.id)
    .eq('is_internal', false)
    .order('created_at', { ascending: true });

  // Get shared inspections
  const { data: inspections } = await supabaseAdmin
    .from('inspections')
    .select('id, title, summary, pdf_url, status, created_at')
    .eq('project_id', project.id)
    .eq('shared_with_client', true);

  return res.json({
    project: {
      name: project.name,
      address: project.address,
      city: project.city,
      province: project.province,
      status: project.status,
      customer: project.customer?.full_name,
      company: project.tenant?.name,
      branding: project.tenant?.branding
    },
    files: files || [],
    comments: comments || [],
    inspections: inspections || [],
    canComment: true
  });
}

// Client comment submission — no auth, just needs share token
async function handleClientComment(req, res) {
  const { share_token, body, guest_name, guest_email, file_id } = req.body || {};
  if (!share_token || !body) return res.status(400).json({ error: 'share_token and body required' });

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id, tenant_id')
    .eq('share_token', share_token)
    .single();

  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { data, error } = await supabaseAdmin
    .from('comments')
    .insert({
      project_id: project.id,
      tenant_id: project.tenant_id,
      guest_name: guest_name || 'Client',
      guest_email: guest_email || null,
      body,
      file_id: file_id || null,
      is_internal: false
    })
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Share token access — no tenant auth needed
  if (req.query.share) return handleShareAccess(req, res);

  // Client comment via share token
  if (req.method === 'POST' && req.body?.share_token) return handleClientComment(req, res);

  // Everything else requires tenant auth
  const tenant = await resolveTenant(req);
  if (!tenant) return res.status(400).json({ error: 'Tenant required' });
  const tenantId = tenant.id;

  // ── Ensure share token (idempotent, used by the photo-share button) ──
  if (req.method === 'POST' && req.query.action === 'ensure-share') {
    const projectId = req.query.id || req.body?.id;
    if (!projectId) return res.status(400).json({ error: 'project id required' });

    const { data: existing, error: e1 } = await supabaseAdmin
      .from('projects')
      .select('id, share_token')
      .eq('id', projectId)
      .eq('tenant_id', tenantId)
      .single();
    if (e1 || !existing) return res.status(404).json({ error: 'Project not found' });

    if (existing.share_token) return res.json({ id: existing.id, share_token: existing.share_token });

    const newToken = `${tenant.slug}-proj-${Date.now().toString(36)}`;
    const { data: updated, error: e2 } = await supabaseAdmin
      .from('projects')
      .update({ share_token: newToken })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId)
      .select('id, share_token')
      .single();
    if (e2) return res.status(500).json({ error: e2.message });
    return res.json(updated);
  }

  // ── GET ──
  if (req.method === 'GET') {
    const { id, status, limit = 50, offset = 0 } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('projects')
        .select(`
          *,
          customer:customers(full_name, phone, email, address),
          estimate:estimates(id, estimate_number, status, roof_pitch, proposal_mode, calculated_packages, selected_package),
          files:project_files(*),
          tickets:tickets(id, ticket_number, title, status, assigned_to, due_date),
          comments:comments(*),
          inspections:inspections(id, title, status, pdf_url, created_at)
        `)
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single();

      if (error) return res.status(404).json({ error: 'Project not found' });
      return res.json(data);
    }

    let query = supabaseAdmin
      .from('projects')
      .select('*, customer:customers(full_name, address)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ projects: data, total: count });
  }

  // ── POST ──
  if (req.method === 'POST') {
    const body = req.body || {};
    const shareToken = `${tenant.slug}-proj-${Date.now().toString(36)}`;

    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({
        tenant_id: tenantId,
        estimate_id: body.estimate_id || null,
        customer_id: body.customer_id || null,
        name: body.name,
        address: body.address,
        city: body.city,
        province: body.province || 'NB',
        status: body.status || 'not_started',
        share_token: shareToken,
        notes: body.notes,
        tags: body.tags || []
      })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await supabaseAdmin.from('activity_log').insert({
      tenant_id: tenantId,
      entity_type: 'project',
      entity_id: data.id,
      action: 'created',
      details: { name: body.name, address: body.address }
    });

    return res.status(201).json(data);
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    const { id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { data, error } = await supabaseAdmin
      .from('projects')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handler;
