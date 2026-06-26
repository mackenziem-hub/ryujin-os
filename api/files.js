// Ryujin OS - Project Files (Photos/Videos/Docs)
// GET    /api/files?project_id=X    - List files for a project
// POST   /api/files                 - Upload file(s) to a project
// PUT    /api/files                 - Update file metadata (caption, tags, annotations, visibility)
// DELETE /api/files?id=X            - Delete a file (Vercel Blob cleanup too)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';
import { put, del } from '@vercel/blob';
import Busboy from 'busboy';
import exifr from 'exifr';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB (video support)
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
  'video/mp4', 'video/quicktime', 'video/webm',
  'application/pdf'
]);

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const files = [];
    const fields = {};
    // Allow up to 20 slots: 10 originals + 10 client-generated thumbnails (named thumb_0..thumb_9)
    const busboy = Busboy({ headers: req.headers, limits: { files: 20, fileSize: MAX_FILE_SIZE } });

    busboy.on('field', (name, val) => { fields[name] = val; });
    busboy.on('file', (name, stream, info) => {
      const chunks = [];
      let truncated = false;
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('limit', () => { truncated = true; });
      stream.on('end', () => {
        files.push({ fieldName: name, buffer: Buffer.concat(chunks), mimeType: info.mimeType, fileName: info.filename, truncated });
      });
    });
    busboy.on('close', () => resolve({ files, fields }));
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

// bodyParser is disabled at the handler level (multipart needs raw stream), so JSON
// bodies on PUT/DELETE arrive unparsed. Read the stream once and JSON.parse it.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 256 * 1024) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// Read EXIF DateTimeOriginal + GPS from an image buffer. Returns nulls on any parse failure.
async function extractExif(buffer) {
  try {
    const exif = await exifr.parse(buffer, ['DateTimeOriginal', 'GPSLatitude', 'GPSLongitude']);
    return {
      captured_at: exif?.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal.toISOString() : null,
      latitude: typeof exif?.GPSLatitude === 'number' ? Number(exif.GPSLatitude.toFixed(7)) : null,
      longitude: typeof exif?.GPSLongitude === 'number' ? Number(exif.GPSLongitude.toFixed(7)) : null
    };
  } catch {
    return { captured_at: null, latitude: null, longitude: null };
  }
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  // ── GET ──
  if (req.method === 'GET') {
    const { project_id, category, client_visible, id } = req.query;

    // Single-file fetch by id, used by the annotator page which only
    // knows the file id, not the parent project. Tenant-scoped.
    if (id) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return res.status(400).json({ error: 'Invalid file id format' });
      }
      const { data, error } = await supabaseAdmin
        .from('project_files')
        .select('*, uploaded_by_user:users!project_files_uploaded_by_fkey(name)')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (error) {
        console.error('[files] GET by id error:', error);
        return res.status(500).json({ error: 'Database error' });
      }
      if (!data) return res.status(404).json({ error: 'File not found' });
      return res.json(data);
    }

    if (!project_id) return res.status(400).json({ error: 'project_id or id required' });

    let query = supabaseAdmin
      .from('project_files')
      .select('*, uploaded_by_user:users!project_files_uploaded_by_fkey(name)')
      .eq('tenant_id', tenantId)
      .eq('project_id', project_id)
      .order('sort_order', { ascending: true })
      .order('uploaded_at', { ascending: false });

    if (category) query = query.eq('category', category);
    if (client_visible === 'true') query = query.eq('client_visible', true);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Union in estimate_photos for the project's linked estimate so legacy
    // CompanyCam archive photos + the sub-portal → estimate_photos bridge (PR
    // #63) surface here too. Mobile gallery + job page both consume this
    // endpoint and silently miss photos when keyed only by project_id.
    let estimatePhotos = [];
    if (category !== 'document') {
      const { data: proj } = await supabaseAdmin
        .from('projects')
        .select('estimate_id')
        .eq('id', project_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (proj?.estimate_id) {
        let epQuery = supabaseAdmin
          .from('estimate_photos')
          .select('id, url, filename, mime_type, caption, category, is_cover, uploaded_at, estimate_id')
          .eq('estimate_id', proj.estimate_id)
          .order('uploaded_at', { ascending: false });
        if (category) epQuery = epQuery.eq('category', category);
        const { data: ep } = await epQuery;
        // Normalize to project_files shape so consumers don't have to branch.
        // Mark with source='estimate_photos' + read_only=true so any mutation
        // UI can disable patch/delete on these rows (they live in a different
        // table and aren't writable through /api/files).
        estimatePhotos = (ep || []).map(r => ({
          id: r.id,
          project_id,
          tenant_id: tenantId,
          url: r.url,
          filename: r.filename,
          mime_type: r.mime_type,
          caption: r.caption,
          category: r.category,
          is_cover: r.is_cover,
          uploaded_at: r.uploaded_at,
          client_visible: true,
          sort_order: 999999,
          source: 'estimate_photos',
          read_only: true,
        }));
      }
    }

    const merged = [...(data || []), ...estimatePhotos];
    return res.json({ files: merged });
  }

  // ── POST (Upload) ──
  if (req.method === 'POST') {
    // Register-by-URL (JSON): the browser streamed a large file (drone video)
    // straight to Vercel Blob via the client upload token, then posts the
    // resulting Blob URL here so we only create the DB row (no re-streaming
    // bytes through this function, so no 4.5MB payload limit). Multipart path
    // below still handles small photos/clips.
    if ((req.headers['content-type'] || '').includes('application/json')) {
      let body;
      try { body = await readJsonBody(req); }
      catch (e) { return res.status(400).json({ error: 'Invalid JSON body' }); }
      const { project_id, url, filename, mime_type, file_size, category, thumbnail_url } = body || {};
      if (!project_id || !url) return res.status(400).json({ error: 'project_id and url required' });
      // Only accept a Vercel Blob URL, never an arbitrary external link.
      if (!/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//i.test(String(url))) {
        return res.status(400).json({ error: 'url must be a Vercel Blob URL' });
      }
      if (mime_type && !ALLOWED_TYPES.has(mime_type)) {
        return res.status(400).json({ error: `Unsupported type: ${mime_type}` });
      }
      const { data: project } = await supabaseAdmin
        .from('projects').select('id').eq('id', project_id).eq('tenant_id', tenantId).single();
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const { data: rec, error } = await supabaseAdmin
        .from('project_files')
        .insert({
          project_id,
          tenant_id: tenantId,
          // uploaded_by is a users.id UUID FK — coerce anything else to null so a
          // stray name can't 500 the insert.
          uploaded_by: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.uploaded_by || '')) ? body.uploaded_by : null,
          url: String(url),
          thumbnail_url: thumbnail_url || null,
          filename: (filename || 'upload').substring(0, 120),
          mime_type: mime_type || 'application/octet-stream',
          file_size: Number.isFinite(file_size) ? file_size : null,
          category: category || 'general',
          client_visible: false
        })
        .select('*')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ files: [rec] });
    }

    const { files, fields } = await parseMultipart(req);
    if (files.length === 0) return res.status(400).json({ error: 'No files provided' });

    const projectId = fields.project_id;
    if (!projectId) return res.status(400).json({ error: 'project_id required in form data' });

    // Verify project belongs to tenant
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('tenant_id', tenantId)
      .single();

    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Separate originals from client-generated thumbnails (named thumb_0, thumb_1, ...)
    const originals = files.filter(f => !/^thumb_\d+$/.test(f.fieldName));
    const thumbsByIndex = new Map();
    for (const f of files) {
      const m = /^thumb_(\d+)$/.exec(f.fieldName);
      if (m) thumbsByIndex.set(Number(m[1]), f);
    }

    const results = [];
    const ts = Date.now();

    for (let i = 0; i < originals.length; i++) {
      const f = originals[i];

      if (f.truncated) {
        results.push({ fileName: f.fileName, error: 'File exceeds 50MB limit' });
        continue;
      }
      if (!ALLOWED_TYPES.has(f.mimeType)) {
        results.push({ fileName: f.fileName, error: `Unsupported type: ${f.mimeType}` });
        continue;
      }

      const clean = (f.fileName || 'upload').replace(/[^\w.\-]/g, '_').substring(0, 80);
      const blobPath = `${req.tenant.slug}/projects/${projectId}/${ts}-${i}-${clean}`;

      const blob = await put(blobPath, f.buffer, {
        access: 'public',
        contentType: f.mimeType
      });

      // Upload paired client-generated thumbnail if present (image uploads only)
      let thumbnailUrl = null;
      const thumb = thumbsByIndex.get(i);
      if (thumb && !thumb.truncated && thumb.buffer.length > 0) {
        try {
          const thumbPath = `${req.tenant.slug}/projects/${projectId}/thumbs/${ts}-${i}-${clean}.jpg`;
          const thumbBlob = await put(thumbPath, thumb.buffer, {
            access: 'public',
            contentType: thumb.mimeType || 'image/jpeg'
          });
          thumbnailUrl = thumbBlob.url;
        } catch (e) {
          // Thumb is a nice-to-have; never fail the original upload over it
          console.warn('[files] thumbnail upload failed:', e?.message);
        }
      }

      // EXIF: only for images, server-side fallback. Photos taken via the rear-camera capture
      // typically lose EXIF when re-encoded by the canvas thumbnailer; this is the safety net
      // for direct-from-gallery uploads where EXIF survives.
      let exif = { captured_at: null, latitude: null, longitude: null };
      if (f.mimeType?.startsWith('image/')) {
        exif = await extractExif(f.buffer);
      }

      // Captured_at / lat / lng can also be passed as form fields (client-side geolocation
      // overrides null EXIF - phones do not write GPS to capture-mode photos in Safari).
      const formCapturedAt = fields[`captured_at_${i}`] || fields.captured_at || null;
      const formLat = parseFloat(fields[`latitude_${i}`] ?? fields.latitude);
      const formLng = parseFloat(fields[`longitude_${i}`] ?? fields.longitude);

      const { data: fileRecord, error: fErr } = await supabaseAdmin
        .from('project_files')
        .insert({
          project_id: projectId,
          tenant_id: tenantId,
          uploaded_by: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(fields.uploaded_by || '')) ? fields.uploaded_by : null,
          url: blob.url,
          thumbnail_url: thumbnailUrl,
          filename: f.fileName,
          mime_type: f.mimeType,
          file_size: f.buffer.length,
          category: fields.category || 'general',
          caption: fields.caption || null,
          client_visible: fields.client_visible === 'true',
          captured_at: exif.captured_at || formCapturedAt || null,
          latitude: exif.latitude ?? (Number.isFinite(formLat) ? formLat : null),
          longitude: exif.longitude ?? (Number.isFinite(formLng) ? formLng : null)
        })
        .select('*')
        .single();

      if (fErr) {
        results.push({ fileName: f.fileName, error: fErr.message });
      } else {
        results.push(fileRecord);
      }
    }

    return res.json({ files: results });
  }

  // ── PUT (Update metadata) ──
  if (req.method === 'PUT') {
    let body;
    try { body = await readJsonBody(req); }
    catch (e) { return res.status(400).json({ error: 'Invalid JSON body' }); }
    const { id, ...updates } = body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Only allow safe fields to be updated
    const allowed = ['caption', 'category', 'tags', 'annotations', 'annotated_url', 'client_visible', 'is_cover', 'sort_order'];
    const safeUpdates = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) safeUpdates[key] = updates[key];
    }

    // Single-cover rule: if this update sets is_cover=true, clear is_cover on every other
    // file in the same project first. We look up the project_id from the target row.
    if (safeUpdates.is_cover === true) {
      const { data: target } = await supabaseAdmin
        .from('project_files')
        .select('project_id')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();
      if (target?.project_id) {
        await supabaseAdmin
          .from('project_files')
          .update({ is_cover: false })
          .eq('tenant_id', tenantId)
          .eq('project_id', target.project_id)
          .neq('id', id);
      }
    }

    const { data, error } = await supabaseAdmin
      .from('project_files')
      .update(safeUpdates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // ── DELETE ──
  // Mirrors api/estimate-photos.js DELETE: fetch row first to get the Blob
  // URLs (original + thumbnail), best-effort delete from Blob, then delete
  // the DB row. Without the Blob delete the file orphans in storage (the
  // DB row is the only reference back to the URL).
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });

    const { data: row } = await supabaseAdmin
      .from('project_files')
      .select('id, url, thumbnail_url')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!row) return res.status(404).json({ error: 'File not found' });

    if (row.url) { try { await del(row.url); } catch {} }
    if (row.thumbnail_url) { try { await del(row.thumbnail_url); } catch {} }

    const { error } = await supabaseAdmin
      .from('project_files')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// Auth split: customer galleries legitimately read client-visible files with no
// session (customer-showcase.html, photos-share). Keep ONLY that path public and
// tenant-scoped. Every other read (by id, by project without client_visible, by
// category) and every write (POST/PUT/DELETE) requires a real session. Closes the
// unauthenticated read-by-id + destructive-write exposure without breaking galleries.
// Public path is ONLY a project-scoped, client-visible listing (the gallery query
// customer-showcase.html runs). Read-by-id is excluded: the GET ?id= branch returns
// the row tenant-scoped with NO client_visible filter, so an anonymous id read would
// leak internal (client_visible=false) files. id reads require a session.
const publicGalleryRead = (req) =>
  req.method === 'GET' && req.query &&
  req.query.client_visible === 'true' &&
  !!req.query.project_id && !req.query.id;

export default function (req, res) {
  if (req.method === 'OPTIONS') return handler(req, res);
  return publicGalleryRead(req)
    ? requireTenant(handler)(req, res)
    : requirePortalSessionAndTenant(handler)(req, res);
}

export const config = { api: { bodyParser: false } };
