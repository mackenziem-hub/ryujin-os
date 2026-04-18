// Ryujin OS — Projects CRUD
// GET    /api/projects              — List projects (with filters)
// GET    /api/projects?id=X         — Get single project with files, comments, tickets
// GET    /api/projects?share=TOKEN  — Client portal view (no auth needed)
// POST   /api/projects              — Create project
// PUT    /api/projects              — Update project
import { supabaseAdmin } from '../lib/supabase.js';
import { resolveTenant, requireTenant } from '../lib/tenant.js';

// Client portal — public access via share token
async function handleShareAccess(req, res) {
  const token = req.query.share;
  const { data: project, error } = await supabaseAdmin
    .from('projects')
    .select(`
      id, name, address, city, province, status, created_at,
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

  // Get client-visible files only
  const { data: files } = await supabaseAdmin
    .from('project_files')
    .select('id, url, thumbnail_url, filename, mime_type, category, caption, tags, annotations, annotated_url, uploaded_at')
    .eq('project_id', project.id)
    .eq('client_visible', true)
    .order('sort_order', { ascending: true });

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
