// Ryujin OS - Ad Script Studio CRUD (internal ad-copy library + WYSIWYG scripts).
//
// Backed by the existing proposal_blocks table (no new migration): each ad script
// is one row with block_type='custom_html', audience='internal', is_library=false,
// block_key='adscript:<slug>'. The 'adscript:' prefix + is_library=false keep these
// fully isolated from the proposal section library and the proposal builder.
//
// GET    /api/ad-scripts            - list all ad scripts + reference entries for tenant
// GET    /api/ad-scripts?id=<uuid>  - single
// POST   /api/ad-scripts            - create { slug?, name, kind, category, content, meta }
// PUT    /api/ad-scripts            - update/autosave { id, name?, content?, kind?, category?, meta?, sort_order? }
// DELETE /api/ad-scripts?id=<uuid>  - delete the row
//
// Auth: requireTenant (resolves tenant) + a privileged session OR the service token
// (mirrors api/settings.js). Works for the browser portal session AND the seed script.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';

const PREFIX = 'adscript:';
const KINDS = ['script', 'reference'];
const CATEGORIES = ['script', 'meta_ad', 'google_ad', 'nurture', 'funnel', 'general'];

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'script';
}

// proposal_blocks row -> ad-script shape the frontend speaks
function toScript(row) {
  const c = (row.content && typeof row.content === 'object') ? row.content : {};
  return {
    id: row.id,
    slug: String(row.block_key || '').replace(PREFIX, ''),
    name: row.name || '',
    kind: KINDS.includes(c.kind) ? c.kind : 'script',
    category: CATEGORIES.includes(c.category) ? c.category : 'general',
    content: typeof c.html === 'string' ? c.html : '',
    meta: (c.meta && typeof c.meta === 'object') ? c.meta : {},
    sort_order: Number.isFinite(c.sort_order) ? c.sort_order : 0,
    updated_at: row.updated_at,
  };
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Privileged gate; tenant from the SESSION, never the client x-tenant-id header,
  // so a tenant admin cannot reach another tenant's scripts (the service token
  // resolves its tenant from x-tenant-id, trusted). Same posture as api/settings.js.
  const session = await resolveSession(req);
  if (!isPrivileged(session)) {
    return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  }
  const tenantId = session.tenant_id;

  if (req.method === 'GET') {
    const { id } = req.query;
    if (id) {
      const { data, error } = await supabaseAdmin
        .from('proposal_blocks')
        .select('id, block_key, name, content, updated_at')
        .eq('tenant_id', tenantId).eq('id', id).like('block_key', `${PREFIX}%`)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'not found' });
      return res.json({ script: toScript(data) });
    }
    const { data, error } = await supabaseAdmin
      .from('proposal_blocks')
      .select('id, block_key, name, content, updated_at')
      .eq('tenant_id', tenantId).like('block_key', `${PREFIX}%`)
      .order('updated_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const scripts = (data || []).map(toScript);
    return res.json({ scripts });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const slug = b.slug ? slugify(b.slug) : `${slugify(b.name)}-${Date.now().toString(36).slice(-4)}`;
    const kind = KINDS.includes(b.kind) ? b.kind : 'script';
    const category = CATEGORIES.includes(b.category) ? b.category : (kind === 'reference' ? 'general' : 'script');
    const row = {
      tenant_id: tenantId,
      block_key: `${PREFIX}${slug}`,
      block_type: 'custom_html',
      audience: 'internal',
      is_library: false,
      active: true,
      name: String(b.name).slice(0, 200),
      content: {
        html: typeof b.content === 'string' ? b.content : '',
        kind, category,
        meta: (b.meta && typeof b.meta === 'object') ? b.meta : {},
        sort_order: Number.isFinite(b.sort_order) ? b.sort_order : 0,
      },
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabaseAdmin
      .from('proposal_blocks')
      .upsert(row, { onConflict: 'tenant_id,block_key' })
      .select('id, block_key, name, content, updated_at').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ script: toScript(data) });
  }

  if (req.method === 'PUT') {
    const b = req.body || {};
    if (!b.id) return res.status(400).json({ error: 'id required' });
    // Read current row so we can merge the content JSONB (never blow away fields)
    const { data: cur, error: readErr } = await supabaseAdmin
      .from('proposal_blocks')
      .select('id, content, name').eq('tenant_id', tenantId).eq('id', b.id)
      .like('block_key', `${PREFIX}%`).maybeSingle();
    if (readErr) return res.status(500).json({ error: readErr.message });
    if (!cur) return res.status(404).json({ error: 'not found' });
    const c = (cur.content && typeof cur.content === 'object') ? cur.content : {};
    const nextContent = {
      html: typeof b.content === 'string' ? b.content : (typeof c.html === 'string' ? c.html : ''),
      kind: KINDS.includes(b.kind) ? b.kind : (KINDS.includes(c.kind) ? c.kind : 'script'),
      category: CATEGORIES.includes(b.category) ? b.category : (CATEGORIES.includes(c.category) ? c.category : 'general'),
      meta: (b.meta && typeof b.meta === 'object') ? b.meta : (c.meta || {}),
      sort_order: Number.isFinite(b.sort_order) ? b.sort_order : (Number.isFinite(c.sort_order) ? c.sort_order : 0),
    };
    const updates = { content: nextContent, updated_at: new Date().toISOString() };
    if (typeof b.name === 'string' && b.name.trim()) updates.name = b.name.slice(0, 200);
    const { data, error } = await supabaseAdmin
      .from('proposal_blocks')
      .update(updates).eq('id', b.id).eq('tenant_id', tenantId)
      .select('id, block_key, name, content, updated_at').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ script: toScript(data) });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabaseAdmin
      .from('proposal_blocks')
      .delete().eq('tenant_id', tenantId).eq('id', id).like('block_key', `${PREFIX}%`);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
