// Ryujin OS - Ad Script Studio CRUD (internal ad-copy library + WYSIWYG scripts).
//
// Backed by the existing proposal_blocks table (no new migration): each ad script
// is one row with block_type='custom_html', audience='internal', is_library=false,
// block_key='adscript:<slug>'. The 'adscript:' prefix + is_library=false keep these
// fully isolated from the proposal section library and the proposal builder.
//
// VERSIONING (added 2026-06-23, still no migration): the content JSONB now carries
//   content.versions      = [{ id, label, source, html }, ...]   (>=1, ordered)
//   content.activeVersion = id of the version that is "published" / exported
//   content.html          = mirror of the active version's html (back-compat for
//                           api/ad-script-export.js, copy, and any old reader)
// Legacy rows that only have content.html auto-wrap to a single 'v1' version on read.
//
// GET    /api/ad-scripts            - list all ad scripts + reference entries for tenant
// GET    /api/ad-scripts?id=<uuid>  - single
// POST   /api/ad-scripts            - create { slug?, name, kind, category, content|versions, activeVersion?, meta }
// PUT    /api/ad-scripts            - update/autosave; body may carry:
//                                       { id, name? }                      rename
//                                       { id, content, versionId? }        write a version's html (default: active)
//                                       { id, activeVersion }              switch the published version
//                                       { id, addVersion:{label,source,html}, makeActive? }
//                                       { id, deleteVersion:<versionId> }  (keeps >=1)
//                                       { id, versionId, versionSource }   edit a version's provenance line
//                                       { id, kind?, category?, meta?, sort_order? }
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

// Coerce any stored content object into a clean { versions, activeVersion, html }.
// Always returns at least one version. Never throws.
function normalizeVersions(c) {
  const src = (c && typeof c === 'object') ? c : {};
  let versions = Array.isArray(src.versions)
    ? src.versions.filter((v) => v && typeof v === 'object')
    : [];
  versions = versions.map((v, i) => ({
    id: (typeof v.id === 'string' && v.id) ? v.id : `v${i + 1}`,
    label: (typeof v.label === 'string' && v.label)
      ? v.label
      : ((typeof v.id === 'string' && v.id) ? v.id : `v${i + 1}`),
    source: typeof v.source === 'string' ? v.source : '',
    html: typeof v.html === 'string' ? v.html : '',
  }));
  if (!versions.length) {
    versions = [{
      id: 'v1',
      label: 'v1',
      source: typeof src.source === 'string' ? src.source : '',
      html: typeof src.html === 'string' ? src.html : '',
    }];
  }
  let activeVersion = typeof src.activeVersion === 'string' ? src.activeVersion : versions[0].id;
  if (!versions.some((v) => v.id === activeVersion)) activeVersion = versions[0].id;
  const active = versions.find((v) => v.id === activeVersion) || versions[0];
  return { versions, activeVersion, html: active.html };
}

function nextVersionId(versions) {
  let max = 0;
  versions.forEach((v) => {
    const m = /^v(\d+)$/.exec(v.id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `v${max + 1}`;
}

// proposal_blocks row -> ad-script shape the frontend speaks
function toScript(row) {
  const c = (row.content && typeof row.content === 'object') ? row.content : {};
  const { versions, activeVersion, html } = normalizeVersions(c);
  return {
    id: row.id,
    slug: String(row.block_key || '').replace(PREFIX, ''),
    name: row.name || '',
    kind: KINDS.includes(c.kind) ? c.kind : 'script',
    category: CATEGORIES.includes(c.category) ? c.category : 'general',
    content: html, // active version html (back-compat with the single-html frontend path)
    versions,
    activeVersion,
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
    // Accept either an explicit versions[] (seed / clone) or a single content string.
    const seed = Array.isArray(b.versions)
      ? { versions: b.versions, activeVersion: b.activeVersion }
      : { html: typeof b.content === 'string' ? b.content : '', source: typeof b.source === 'string' ? b.source : '' };
    const { versions, activeVersion, html } = normalizeVersions(seed);
    const row = {
      tenant_id: tenantId,
      block_key: `${PREFIX}${slug}`,
      block_type: 'custom_html',
      audience: 'internal',
      is_library: false,
      active: true,
      name: String(b.name).slice(0, 200),
      content: {
        html, versions, activeVersion,
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
    const norm = normalizeVersions(c);
    let versions = norm.versions.map((v) => ({ ...v }));
    let activeVersion = norm.activeVersion;

    // 1) add a new version
    if (b.addVersion && typeof b.addVersion === 'object') {
      const nid = nextVersionId(versions);
      versions.push({
        id: nid,
        label: (typeof b.addVersion.label === 'string' && b.addVersion.label) ? b.addVersion.label : nid,
        source: typeof b.addVersion.source === 'string' ? b.addVersion.source : '',
        html: typeof b.addVersion.html === 'string' ? b.addVersion.html : '',
      });
      if (b.makeActive !== false) activeVersion = nid;
    }
    // 2) delete a version (always keep at least one)
    if (typeof b.deleteVersion === 'string' && versions.length > 1) {
      versions = versions.filter((v) => v.id !== b.deleteVersion);
      if (!versions.some((v) => v.id === activeVersion)) activeVersion = versions[0].id;
    }
    // 3) switch the active/published version
    if (typeof b.activeVersion === 'string' && versions.some((v) => v.id === b.activeVersion)) {
      activeVersion = b.activeVersion;
    }
    // 4) write html into a version (default: the active one)
    if (typeof b.content === 'string') {
      const targetId = (typeof b.versionId === 'string' && versions.some((v) => v.id === b.versionId))
        ? b.versionId : activeVersion;
      const idx = versions.findIndex((v) => v.id === targetId);
      if (idx >= 0) versions[idx] = { ...versions[idx], html: b.content };
    }
    // 5) edit a version's provenance line
    if (typeof b.versionSource === 'string' && typeof b.versionId === 'string') {
      const idx = versions.findIndex((v) => v.id === b.versionId);
      if (idx >= 0) versions[idx] = { ...versions[idx], source: b.versionSource };
    }

    const active = versions.find((v) => v.id === activeVersion) || versions[0];
    const nextContent = {
      html: active.html, versions, activeVersion,
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
