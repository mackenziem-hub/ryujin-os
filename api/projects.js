// Ryujin OS — Projects CRUD
// GET    /api/projects              — List projects (with filters)
// GET    /api/projects?id=X         — Get single project with files, comments, tickets
// GET    /api/projects?share=TOKEN  — Client portal view (no auth needed)
// POST   /api/projects              — Create project
// PUT    /api/projects              — Update project
import { supabaseAdmin } from '../lib/supabase.js';
import { resolveTenant, requireTenant } from '../lib/tenant.js';
import { resolveSession } from '../lib/portalAuth.js';
import { gmailSend } from '../lib/google.js';
import { syncProjectFromWorkorder, resolveProjectIdFromWorkorder } from '../lib/projectSync.js';
import { publicBase } from '../lib/publicUrl.js';

const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL || 'mackenzie.m@plusultraroofing.com').trim();
const PHOTO_GALLERY_NOTIFIED_TAG = 'owner:photo_gallery_opened';

// ── Lifecycle stage derivation (drives the field-app Jobs sort + crew/sub gating) ──
// The lifecycle is spread across project.status (production state) + the linked
// estimate's sold/sent status + the schedule. Ladder:
//   draft -> quoted -> signed -> scheduled -> in_production -> complete
// A pre-sale "booked" stage lives in GHL/inspection, not on the project row, so it
// is not derived here; in-house crew see all stages regardless.
function deriveStage(p) {
  const ps = String(p.status || '').toLowerCase();
  if (ps === 'complete') return 'complete';
  if (ps === 'active' || ps === 'paused' || ps === 'punch_list') return 'in_production';
  const es = String(p.estimate?.status || '').toLowerCase();
  if (es === 'accepted') return p.scheduled_start ? 'scheduled' : 'signed';
  if (es === 'proposal_sent') return 'quoted';
  return 'draft';
}

const normPhone = (s) => String(s || '').replace(/\D/g, '').slice(-10);
// In-house pseudo-subs that must NOT cause an in-house user to be assignment-gated.
const IN_HOUSE_SUB_NAMES = new Set(['plus ultra crew', 'mackenzie mazerolle']);

// Resolve the set of project ids a non-office (crew/sub) session may see, or null
// when the session is in-house staff so they are NOT assignment-filtered (see all).
//
// SECURITY: this gate FAILS CLOSED. An external subcontractor must never see a job
// that is not assigned to their sub. Order matters:
//   1. Match the user to an ACTIVE subcontractor record (phone, then exact first-name
//      token). A positive match = external sub and TAKES PRECEDENCE over email domain,
//      so a sub provisioned with a company-domain login is still gated.
//   2. No sub match + email domain == the tenant owner's domain = in-house -> see all.
//   3. Neither -> fail closed (empty Set = sees none, never all).
// Any DB error returns an empty Set, never null. A sub on a work order is by
// definition a sold/assigned job, so the WO assignment is the gate (no stage floor).
// NOTE: the caller fetches one large page then filters here; correct while the
// tenant's project count stays within that page (Plus Ultra ~31, field-app page 500).
async function externalSubProjectFilter(session, tenantId) {
  try {
    const { data: u, error: uErr } = await supabaseAdmin
      .from('users').select('id, name, phone, email').eq('id', session.user_id).maybeSingle();
    if (uErr) return new Set(); // cannot load identity -> fail closed

    // 1. Resolve an ACTIVE external subcontractor for this user (phone, then exact
    //    first-name token), BEFORE the email-domain signal.
    const { data: subs, error: sErr } = await supabaseAdmin
      .from('subcontractors').select('id, name, phone, active, archived_at').eq('tenant_id', tenantId);
    if (sErr) return new Set();
    const candidates = (subs || []).filter(
      (s) => s && s.active !== false && !s.archived_at &&
        !IN_HOUSE_SUB_NAMES.has(String(s.name || '').trim().toLowerCase())
    );
    const uPhone = normPhone(u?.phone);
    let sub = uPhone ? candidates.find((s) => normPhone(s.phone) === uPhone) : null;
    if (!sub) {
      // Exact first-name TOKEN match (word boundary), never a substring -> 'ryan'
      // must not bind to a sub named 'Bryan'.
      const fn = String(u?.name || session.name || '').trim().toLowerCase().split(/\s+/)[0];
      if (fn.length >= 3) {
        sub = candidates.find((s) => String(s.name || '').toLowerCase().split(/[^a-z0-9]+/).includes(fn)) || null;
      }
    }

    if (sub) {
      // External sub -> only their assigned jobs: estimate-linked projects (batch) +
      // the canonical WO->project resolver (estimate->customer->address) for work
      // orders with no estimate link (field-app address-only jobs).
      const { data: wos, error: wErr } = await supabaseAdmin
        .from('workorders')
        .select('id, wo_number, status, start_date, linked_estimate_id, customer_name, address')
        .eq('tenant_id', tenantId).eq('subcontractor_id', sub.id);
      if (wErr) return new Set();
      const ids = new Set();
      const estIds = [...new Set((wos || []).map((w) => w.linked_estimate_id).filter(Boolean))];
      if (estIds.length) {
        const { data: byEst, error: eErr } = await supabaseAdmin
          .from('projects').select('id').eq('tenant_id', tenantId).in('estimate_id', estIds);
        if (eErr) return new Set();
        for (const p of (byEst || [])) ids.add(p.id);
      }
      for (const wo of (wos || [])) {
        if (wo.linked_estimate_id) continue;
        try {
          const { projectId } = await resolveProjectIdFromWorkorder(tenantId, wo);
          if (projectId) ids.add(projectId);
        } catch { /* skip this WO; never widen visibility on error */ }
      }
      return ids;
    }

    // 2. No sub record -> positive in-house signal (staff email domain) -> see all.
    const email = String(u?.email || session.email || '').toLowerCase();
    const emailDomain = email.includes('@') ? email.split('@').pop() : '';
    const { data: owner, error: oErr } = await supabaseAdmin
      .from('users').select('email').eq('tenant_id', tenantId).eq('role', 'owner').limit(1).maybeSingle();
    if (oErr) return new Set(); // cannot establish staff domain -> fail closed
    const ownerEmail = String(owner?.email || '').toLowerCase();
    const staffDomain = ownerEmail.includes('@') ? ownerEmail.split('@').pop() : '';
    if (staffDomain && emailDomain && emailDomain === staffDomain) return null; // in-house -> see all

    // 3. Neither a known sub nor a recognized staff member -> fail closed.
    return new Set();
  } catch {
    return new Set(); // any unexpected failure -> fail closed (see none)
  }
}

// Fire once per project the first time its photo-share URL is hit. Mirrors the
// proposal-events first-open pattern: idempotency via a tag on projects.tags.
async function maybeNotifyFirstGalleryOpen(project) {
  try {
    const tags = Array.isArray(project.tags) ? project.tags : [];
    if (tags.includes(PHOTO_GALLERY_NOTIFIED_TAG)) return;

    // Atomic claim: only the request that flips the tag into place proceeds
    // to send the email. Filtering on `not.cs.` (NOT contains) means concurrent
    // requests find 0 rows once one has won, defeating the duplicate-email race.
    const newTags = [...tags, PHOTO_GALLERY_NOTIFIED_TAG];
    const { data: claimed, error: tagErr } = await supabaseAdmin
      .from('projects')
      .update({ tags: newTags })
      .eq('id', project.id)
      .eq('tenant_id', project.tenant_id)
      .not('tags', 'cs', `{${PHOTO_GALLERY_NOTIFIED_TAG}}`)
      .select('id');
    if (tagErr) {
      console.error('[projects] gallery first-open tag write failed', tagErr.message);
      return;
    }
    if (!claimed || claimed.length === 0) return; // Lost the race; someone else is sending

    const customerName = project.customer?.full_name || 'Customer';
    const shareUrl = `${publicBase()}/photos-share.html?share=${encodeURIComponent(project.share_token || '')}`;
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

// Merge estimate_photos + project_files into one customer gallery list:
// cover first, then newest (captured_at, else uploaded_at). Only the first
// cover keeps its flag so the gallery never renders two "Cover" tags.
// Exported for unit testing.
export function mergeGalleryPhotos(estimatePhotos = [], projectFiles = []) {
  const ts = f => new Date(f.captured_at || f.uploaded_at || 0).getTime();
  const all = [...estimatePhotos, ...projectFiles];
  // Pick a single cover (newest among covers) and demote the rest BEFORE sorting,
  // so the gallery never shows two "Cover" tags and a demoted cover falls back
  // into date order rather than sticking near the top.
  const covers = all.filter(f => f.is_cover);
  const winnerId = covers.length
    ? covers.reduce((best, f) => (ts(f) > ts(best) ? f : best), covers[0]).id
    : null;
  const normalized = all.map(f => (f.is_cover && f.id !== winnerId) ? { ...f, is_cover: false } : f);
  return normalized.sort((a, b) => {
    const ca = a.is_cover ? 1 : 0, cb = b.is_cover ? 1 : 0;
    if (cb !== ca) return cb - ca;
    return ts(b) - ts(a);
  });
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

  // All job photos for this customer: estimate_photos (proposal/inspection)
  // unioned with image/video project_files (crew captures), mirroring the
  // job.html grid. client_visible is intentionally ignored so the gallery
  // shows everything the owner sees on the job (owner's choice 2026-06-04).
  const tId = project.tenant_id;
  const customerId = project.customer_id;
  let estimatePhotos = [];
  let projectFiles = [];
  if (customerId) {
    const { data: estIds } = await supabaseAdmin
      .from('estimates').select('id').eq('tenant_id', tId).eq('customer_id', customerId);
    const eids = (estIds || []).map(e => e.id);
    if (eids.length) {
      const { data: rows } = await supabaseAdmin
        .from('estimate_photos')
        .select('id, url, filename, mime_type, caption, category, is_cover, uploaded_at')
        .in('estimate_id', eids)
        .order('uploaded_at', { ascending: false });
      estimatePhotos = (rows || []).map(r => ({
        id: r.id, url: r.url, thumbnail_url: null, filename: r.filename,
        mime_type: r.mime_type, category: r.category, caption: r.caption,
        tags: null, annotations: null, annotated_url: null,
        uploaded_at: r.uploaded_at, captured_at: null, latitude: null, longitude: null,
        sort_order: 0, is_cover: r.is_cover, source: 'estimate_photos',
      }));
    }
    const { data: projs } = await supabaseAdmin
      .from('projects').select('id').eq('tenant_id', tId).eq('customer_id', customerId);
    const pids = (projs || []).map(p => p.id);
    if (pids.length) {
      const { data: rows } = await supabaseAdmin
        .from('project_files')
        .select('id, url, thumbnail_url, filename, mime_type, category, caption, tags, annotations, annotated_url, uploaded_at, captured_at, latitude, longitude, sort_order, is_cover')
        .eq('tenant_id', tId)
        .in('project_id', pids)
        .order('uploaded_at', { ascending: false });
      projectFiles = (rows || [])
        .filter(r => typeof r.mime_type === 'string' && (r.mime_type.startsWith('image/') || r.mime_type.startsWith('video/')))
        .map(r => ({ ...r, source: 'project_files' }));
    }
  }
  const files = mergeGalleryPhotos(estimatePhotos, projectFiles);

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

  // Operator-session gate (security hardening 2026-06-24). Previously every branch
  // below ran on the tenant header alone, so anyone with the public slug could
  // transition job state, mint indefinite public photo-gallery tokens (ensure-share),
  // and rewrite the customer-facing gallery hero/address (PUT). Require a valid
  // session for all mutations and the bulk list, and bind it to the resolved tenant
  // (no cross-tenant header spoof). The public `?share=` gallery + client-comment
  // branches already returned above; `GET ?id=` stays tenant-scoped so the
  // client-facing customer-showcase page (no session) keeps working.
  let session = null;
  const isMutation = req.method === 'POST' || req.method === 'PUT';
  const isListRead = req.method === 'GET' && !req.query.id;
  if (isMutation || isListRead) {
    session = await resolveSession(req);
    if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
    if (session.tenant_id && session.tenant_id !== tenantId) {
      return res.status(403).json({ error: 'tenant_mismatch' });
    }
  }

  // ── Backfill / reconcile project state from work orders ──
  // POST /api/projects?action=sync-from-workorders
  // Walks every non-cancelled work order and advances its linked project's
  // status + schedule (forward-only, idempotent). Heals the historical
  // projects-orphan drift and serves as the write-enabled reconciler that the
  // read-only reconcile agent could only flag. Session-gated above.
  if (req.method === 'POST' && req.query.action === 'sync-from-workorders') {
    // dryRun returns the resolved project + match path per WO WITHOUT writing,
    // so a real sweep can be eyeballed first (especially the weaker name/customer
    // matches, which never drive a status change anyway).
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true' || req.body?.dryRun === true;
    const { data: wos, error } = await supabaseAdmin
      .from('workorders')
      .select('id, wo_number, status, start_date, linked_estimate_id, customer_name')
      .eq('tenant_id', tenantId)
      .neq('status', 'cancelled');
    if (error) return res.status(500).json({ error: error.message });
    const results = [];
    for (const wo of (wos || [])) {
      if (dryRun) {
        const { projectId, resolvedBy } = await resolveProjectIdFromWorkorder(tenantId, wo);
        if (projectId) results.push({ wo_number: wo.wo_number, wo_status: wo.status, projectId, resolvedBy });
      } else {
        const r = await syncProjectFromWorkorder(tenantId, wo);
        if (r.synced) results.push({ wo_number: wo.wo_number, projectId: r.projectId, resolvedBy: r.resolvedBy, updates: r.updates });
      }
    }
    return res.json({ scanned: (wos || []).length, affected: results.length, dryRun, results });
  }

  // ── State transition (Start / Pause / Complete / Reset) ──
  // POST /api/projects?action=state-transition  body: { id, transition }
  // Used by the Jobs card v2 action buttons.
  if (req.method === 'POST' && req.query.action === 'state-transition') {
    const { id, transition } = (req.body || {});
    if (!id || !transition) return res.status(400).json({ error: 'id and transition required' });
    const allowed = ['start', 'pause', 'complete', 'reset', 'punch_list'];
    if (!allowed.includes(transition)) return res.status(400).json({ error: 'invalid transition' });

    // Look up current state so 'start' on a previously-paused job preserves
    // the original started_at (resume should NOT clobber the first-start
    // timestamp — Codex round flagged this).
    const { data: current } = await supabaseAdmin
      .from('projects')
      .select('id, status, started_at')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();
    if (!current) return res.status(404).json({ error: 'Project not found' });

    const updates = { updated_at: new Date().toISOString() };
    if (transition === 'start') {
      updates.status = 'active';
      // Only stamp started_at if the job has never been started. Resume
      // from paused → keep the original timestamp.
      if (!current.started_at) updates.started_at = new Date().toISOString();
    }
    if (transition === 'pause')      { updates.status = 'paused'; }
    if (transition === 'complete')   { updates.status = 'complete';    updates.progress_pct = 100; }
    if (transition === 'punch_list') { updates.status = 'punch_list'; }
    if (transition === 'reset')      { updates.status = 'not_started'; updates.started_at = null; updates.progress_pct = null; }

    const { data, error } = await supabaseAdmin
      .from('projects')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, status, started_at, progress_pct')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await supabaseAdmin.from('activity_log').insert({
      tenant_id: tenantId,
      entity_type: 'project',
      entity_id: id,
      action: `state_${transition}`,
      details: { transition, new_status: updates.status }
    });

    return res.json(data);
  }

  // ── Job-folder notes (field app). Reuses the comments table; team-visible
  //    (is_internal=true so they never surface on the client share gallery).
  //    guest_name carries the author label so the list needs no users join. ──
  if (req.query.action === 'notes' && req.method === 'GET') {
    // Self-gate: the generic isListRead gate above is bypassed when ?id= is also
    // present, so this internal-notes branch must require its own session.
    const session = await resolveSession(req);
    if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
    // Bind to the caller's own tenant so a signed-in user can't read another
    // tenant's notes by passing that tenant's slug in the header.
    if (session.tenant_id && session.tenant_id !== tenantId) {
      return res.status(403).json({ error: 'tenant_mismatch' });
    }
    const pid = req.query.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    const { data, error } = await supabaseAdmin
      .from('comments')
      .select('id, body, guest_name, user_id, created_at')
      .eq('project_id', pid)
      .eq('tenant_id', tenantId)
      .eq('is_internal', true)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ notes: data || [] });
  }
  if (req.query.action === 'add-note' && req.method === 'POST') {
    const session = await resolveSession(req);
    const { project_id, body } = (req.body || {});
    if (!project_id || !body || !String(body).trim()) {
      return res.status(400).json({ error: 'project_id and body required' });
    }
    // Confirm the project lives in this tenant before attaching a note (the generic
    // mutation gate binds the SESSION to the tenant, but project_id is caller-supplied).
    const { data: proj } = await supabaseAdmin
      .from('projects').select('id').eq('id', project_id).eq('tenant_id', tenantId).maybeSingle();
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    const uid = session?.user_id && session.user_id !== 'service-internal' ? session.user_id : null;
    const { data, error } = await supabaseAdmin
      .from('comments')
      .insert({
        project_id,
        tenant_id: tenantId,
        body: String(body).trim(),
        user_id: uid,
        guest_name: session?.name || 'Crew',
        is_internal: true
      })
      .select('id, body, guest_name, user_id, created_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // ── Ensure share token (idempotent, used by the photo-share button) ──
  if (req.method === 'POST' && req.query.action === 'ensure-share') {
    const projectId = req.query.id;
    if (!projectId) return res.status(400).json({ error: 'project id required' });

    const { data: existing, error: e1 } = await supabaseAdmin
      .from('projects')
      .select('id, share_token, share_expires_at')
      .eq('id', projectId)
      .eq('tenant_id', tenantId)
      .single();
    if (e1 || !existing) return res.status(404).json({ error: 'Project not found' });

    const expired = existing.share_expires_at && new Date(existing.share_expires_at) < new Date();

    // Photo galleries are intended to be indefinite. If we're reusing an existing
    // (unexpired) token but it still carries a future expiry from the legacy client
    // portal flow, clear that expiry so the freshly-minted gallery URL doesn't
    // 410 on a date the customer can't see coming.
    if (existing.share_token && !expired) {
      if (existing.share_expires_at) {
        await supabaseAdmin
          .from('projects')
          .update({ share_expires_at: null })
          .eq('id', existing.id)
          .eq('tenant_id', tenantId);
      }
      return res.json({
        id: existing.id,
        share_token: existing.share_token,
        share_url: `${publicBase()}/photos-share.html?share=${encodeURIComponent(existing.share_token)}`,
      });
    }

    // Either no token or token's expiry has lapsed — mint a fresh one and clear the expiry.
    const newToken = `${tenant.slug}-proj-${Date.now().toString(36)}`;
    const { data: updated, error: e2 } = await supabaseAdmin
      .from('projects')
      .update({ share_token: newToken, share_expires_at: null })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId)
      .select('id, share_token')
      .single();
    if (e2) return res.status(500).json({ error: e2.message });
    return res.json({
      ...updated,
      share_url: `${publicBase()}/photos-share.html?share=${encodeURIComponent(updated.share_token)}`,
    });
  }

  // ── GET ──
  if (req.method === 'GET') {
    const { id, status, customer_id, estimate_id, limit = 50, offset = 0 } = req.query;

    // ── Resolve a work order to its linked project ──
    // The field app's Up next strip and Schedule calendar carry a WO id but open
    // the project's photo-first folder, so they need the project id. Reuses the
    // same matching the project/work-order sync relies on (estimate link first,
    // then customer, then address).
    if (req.query.resolve_wo) {
      const woKey = String(req.query.resolve_wo).trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(woKey);
      let woQ = supabaseAdmin
        .from('workorders')
        .select('id, wo_number, status, start_date, linked_estimate_id, customer_name, address')
        .eq('tenant_id', tenantId);
      woQ = isUuid ? woQ.eq('id', woKey) : woQ.eq('wo_number', woKey);
      const { data: wo } = await woQ.maybeSingle();
      if (!wo) return res.json({ project_id: null });
      const { projectId } = await resolveProjectIdFromWorkorder(tenantId, wo);
      return res.json({ project_id: projectId || null });
    }

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
        // This read is reachable with only the tenant slug (customer-showcase, no
        // session), so the embedded comments must exclude internal crew notes
        // (is_internal=true). Crew read their notes via the session-gated
        // ?action=notes path instead.
        .eq('comments.is_internal', false)
        .single();

      if (error) return res.status(404).json({ error: 'Project not found' });
      return res.json(data);
    }

    let query = supabaseAdmin
      .from('projects')
      .select(`
        *,
        customer:customers(full_name, address, phone),
        crew_lead:users!projects_crew_lead_id_fkey(id, name, avatar_url),
        estimate:estimates!projects_estimate_id_fkey(estimate_number, status, final_accepted_total)
      `, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (status) query = query.eq('status', status);
    // Address/name search so the field-app folder browser can reach jobs beyond
    // the newest page instead of only client-filtering the first batch. Strip
    // commas/percent so the value can't break the PostgREST or() filter syntax.
    if (req.query.search) {
      // Whitelist to word chars, spaces and hyphens so no PostgREST filter
      // metacharacter ( , % * ( ) \ : " ' ) can break or alter the or() expression.
      const s = String(req.query.search).replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
      if (s) {
        let orExpr = `address.ilike.%${s}%,name.ilike.%${s}%`;
        // Also resolve jobs by their customer's name (the field assistant lets
        // crews say "open Smith's job"). Look up matching customer ids in-tenant
        // and fold them into the or() so customer-name search works server-side
        // at any scale, not just over the client's loaded page.
        const { data: custs } = await supabaseAdmin
          .from('customers').select('id').eq('tenant_id', tenantId).ilike('full_name', `%${s}%`).limit(50);
        const ids = (custs || []).map(c => c.id).filter(Boolean);
        if (ids.length) orExpr += `,customer_id.in.(${ids.join(',')})`;
        query = query.or(orExpr);
      }
    }
    // Scoped lookups (e.g. job.html resolving a job's project for the customer
    // share link). Avoids paging the full, newest-first capped list.
    if (customer_id) query = query.eq('customer_id', customer_id);
    if (estimate_id) query = query.eq('estimate_id', estimate_id);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Resolve crew_members uuid[] → {id, name, avatar_url} per project +
    // mark live = (status === 'active'). One round-trip for all crew ids.
    const crewIds = new Set();
    for (const p of (data || [])) for (const uid of (p.crew_members || [])) crewIds.add(uid);
    const crewById = {};
    if (crewIds.size > 0) {
      const cr = await supabaseAdmin
        .from('users')
        .select('id, name, avatar_url')
        .in('id', [...crewIds]);
      for (const u of (cr.data || [])) crewById[u.id] = u;
    }
    const enriched = (data || []).map(p => {
      // Build crew list from crew_members[]; if empty, fall back to the
      // crew_lead so projects with only a lead assigned still show one
      // avatar instead of "No crew assigned".
      let crew = (p.crew_members || []).map(id => crewById[id]).filter(Boolean);
      if (crew.length === 0 && p.crew_lead) crew = [p.crew_lead];
      return {
        ...p,
        live: (p.status || '').toLowerCase() === 'active',
        stage: deriveStage(p),
        crew,
      };
    });

    // Field-app Jobs visibility gate. Office roles (owner/admin/manager/estimator)
    // and in-house crew see everything; an EXTERNAL subcontractor sees ONLY the jobs
    // assigned to their sub via a work order (never another customer's job). Applied
    // post-query in JS so the SQL above stays shared with every other caller, and the
    // count returned reflects what the caller can actually see.
    let visible = enriched;
    let visibleTotal = count; // unfiltered callers keep the true DB count
    const role = String(session?.role || '').toLowerCase();
    const OFFICE_ROLES = new Set(['owner', 'admin', 'manager', 'estimator']);
    if (session && session.user_id !== 'service-internal' && !OFFICE_ROLES.has(role)) {
      const subSet = await externalSubProjectFilter(session, tenantId);
      if (subSet) { visible = enriched.filter((p) => subSet.has(p.id)); visibleTotal = visible.length; }
    }

    return res.json({ projects: visible, total: visibleTotal });
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
