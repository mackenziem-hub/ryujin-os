// Ryujin OS — Marketing Clips API
//
// GET    /api/marketing                    — List clips for tenant (optional ?status=)
// GET    /api/marketing?id=X               — Fetch single clip
// POST   /api/marketing                    — Multipart upload: video + fields → creates clip, kicks render
// PUT    /api/marketing                    — { id, ...updates } — edit metadata / reschedule
// DELETE /api/marketing?id=X               — Delete clip
//
// Upload body (multipart):
//   file             — video (mp4/mov/webm, max 200MB)
//   title            — optional, defaults to filename
//   description      — optional
//   platforms        — comma-separated: "facebook,youtube,gbp"
//   scheduled_at     — ISO 8601; if omitted, "next available slot" is computed
//   hashtags         — comma-separated
//   created_by       — user id (optional)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { put } from '@vercel/blob';
import Busboy from 'busboy';
import { nextOpenSlotForTenant } from '../lib/scheduling.js';

const MAX_MEDIA_SIZE = 200 * 1024 * 1024; // 200 MB
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']);
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']);
const EDITABLE_FIELDS = ['title', 'description', 'hashtags', 'target_platforms', 'scheduled_at', 'caption_style', 'emphasis_indices'];

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const files = [];
    const fields = {};
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_MEDIA_SIZE } });
    busboy.on('field', (name, val) => { fields[name] = val; });
    busboy.on('file', (name, stream, info) => {
      const chunks = [];
      let truncated = false;
      stream.on('data', (c) => chunks.push(c));
      stream.on('limit', () => { truncated = true; });
      stream.on('end', () => {
        files.push({ buffer: Buffer.concat(chunks), mimeType: info.mimeType, fileName: info.filename, truncated });
      });
    });
    busboy.on('close', () => resolve({ files, fields }));
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

function splitCsv(s) {
  if (!s) return [];
  return String(s).split(',').map((x) => x.trim()).filter(Boolean);
}

// Accepts JSON array, CSV, or single string. Used for brand_ids on multipart.
function parseList(s) {
  if (!s) return [];
  const t = String(s).trim();
  if (t.startsWith('[')) {
    try { const arr = JSON.parse(t); return Array.isArray(arr) ? arr.map(String) : []; } catch { /* fall through */ }
  }
  return splitCsv(t);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolves a list of brand identifiers (uuids OR slugs) to brand uuids
// for the given tenant. Unknown identifiers are silently dropped.
async function resolveBrandIds(tenantId, idents) {
  const uuids = idents.filter((s) => UUID_RE.test(s));
  const slugs = idents.filter((s) => !UUID_RE.test(s));
  const results = new Set(uuids);
  if (slugs.length) {
    const { data } = await supabaseAdmin
      .from('brands').select('id, slug')
      .eq('tenant_id', tenantId).in('slug', slugs);
    (data || []).forEach((row) => results.add(row.id));
  }
  // Tenant-scope check on the uuid path: drop any uuid that doesn't belong.
  if (uuids.length) {
    const { data } = await supabaseAdmin
      .from('brands').select('id')
      .eq('tenant_id', tenantId).in('id', uuids);
    const allowed = new Set((data || []).map((r) => r.id));
    for (const id of uuids) if (!allowed.has(id)) results.delete(id);
  }
  return [...results];
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return null;
  return JSON.parse(text);
}

// JSON registration path — client uploaded direct to Blob, now create the
// clip row from the URL + metadata. Mirrors the multipart path's logic.
async function handleJsonRegister(req, res, tenantId, tenantSlug) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Bad JSON: ' + e.message });
  }
  if (!body || !body.source_url) {
    return res.status(400).json({ error: 'Missing source_url (did the Blob upload complete?)' });
  }

  const isVideo = ALLOWED_VIDEO_TYPES.has(body.source_mime_type);
  const isPhoto = ALLOWED_IMAGE_TYPES.has(body.source_mime_type);
  if (!isVideo && !isPhoto) {
    return res.status(415).json({ error: `Unsupported media type: ${body.source_mime_type}` });
  }

  const scheduledAt = body.scheduled_at?.trim?.() || await computeNextSlot(tenantId);

  const brandInput = Array.isArray(body.brand_ids)
    ? body.brand_ids.map(String)
    : parseList(body.brand_ids || body.brands);
  const brandIds = brandInput.length ? await resolveBrandIds(tenantId, brandInput) : [];

  // Caption overrides: map of brand_id → approved caption from the review
  // flow. Stored on the clip and used by the publisher in preference to AI
  // auto-gen at fan-out time.
  const captionOverrides = (body.caption_overrides && typeof body.caption_overrides === 'object')
    ? body.caption_overrides : {};

  const clipBase = {
    tenant_id: tenantId,
    created_by: body.created_by || null,
    source_url: body.source_url,
    source_filename: body.source_filename || null,
    source_mime_type: body.source_mime_type || null,
    source_size_bytes: body.source_size_bytes || null,
    title: body.title?.trim?.() || body.source_filename || null,
    description: body.description?.trim?.() || null,
    hashtags: parseList(body.hashtags),
    target_platforms: parseList(body.platforms || body.target_platforms),
    scheduled_at: scheduledAt,
    is_photo: isPhoto,
    caption_overrides: captionOverrides,
  };

  if (isPhoto) {
    clipBase.rendered_url = body.source_url;
    clipBase.thumbnail_url = body.source_url;
    clipBase.status = 'ready';
  } else {
    clipBase.status = 'queued';
  }

  const { data: clip, error } = await supabaseAdmin
    .from('marketing_clips').insert(clipBase).select('*').single();
  if (error) return res.status(500).json({ error: error.message });

  if (brandIds.length) {
    const links = brandIds.map((brand_id) => ({ clip_id: clip.id, brand_id }));
    const { error: linkErr } = await supabaseAdmin.from('marketing_clip_brands').insert(links);
    if (linkErr) console.error('[marketing] brand link insert failed:', linkErr.message);
  }

  if (isVideo) kickoffRender(req, tenantSlug, clip.id);

  return res.status(202).json({ clip, brand_ids: brandIds });
}

function flattenBrands(clip) {
  if (!clip) return clip;
  const links = Array.isArray(clip.brands) ? clip.brands : [];
  return { ...clip, brands: links.map((l) => l.brand).filter(Boolean) };
}

async function computeNextSlot(tenantId) {
  // Prime-time slot resolver: 9am / 1pm / 7pm AT, spread across pending clips
  // so multiple uploads don't pile at the same moment.
  const slot = await nextOpenSlotForTenant(tenantId);
  return slot.toISOString();
}

function baseUrl(req) {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return `${proto}://${host}`;
}

function kickoffRender(req, tenantSlug, clipId) {
  const url = `${baseUrl(req)}/api/marketing-render?id=${clipId}`;
  // fire-and-forget — upload handler returns immediately; render runs in its own invocation
  fetch(url, {
    method: 'POST',
    headers: {
      'x-tenant-id': tenantSlug,
      'x-internal-key': (process.env.INTERNAL_RENDER_KEY || '').trim(),
    },
  }).catch((e) => console.error('[marketing] render kickoff failed', e?.message));
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;
  const tenantSlug = req.tenant.slug;

  // ── GET ──
  if (req.method === 'GET') {
    const { id, status } = req.query;
    if (id) {
      const { data, error } = await supabaseAdmin
        .from('marketing_clips')
        .select('*, brands:marketing_clip_brands(brand:brands(id,slug,name))')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();
      if (error) return res.status(404).json({ error: 'Clip not found' });
      return res.json(flattenBrands(data));
    }
    let q = supabaseAdmin
      .from('marketing_clips')
      .select('*, brands:marketing_clip_brands(brand:brands(id,slug,name))')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ clips: (data || []).map(flattenBrands) });
  }

  // ── POST (Upload + create clip) ──
  if (req.method === 'POST') {
    // JSON body path: client-side direct-to-Blob upload already happened
    // (via /api/marketing-upload-token), now register the clip row.
    const ctype = String(req.headers['content-type'] || '');
    if (ctype.startsWith('application/json')) {
      return handleJsonRegister(req, res, tenantId, tenantSlug);
    }

    let parsed;
    try {
      parsed = await parseMultipart(req);
    } catch (e) {
      return res.status(400).json({ error: `Multipart parse failed: ${e.message}` });
    }
    const { files, fields } = parsed;
    if (!files.length) return res.status(400).json({ error: 'No video file provided (field: file)' });

    const f = files[0];
    if (f.truncated) return res.status(413).json({ error: `File exceeds ${MAX_MEDIA_SIZE / 1024 / 1024}MB limit` });

    const isVideo = ALLOWED_VIDEO_TYPES.has(f.mimeType);
    const isPhoto = ALLOWED_IMAGE_TYPES.has(f.mimeType);
    if (!isVideo && !isPhoto) {
      return res.status(415).json({ error: `Unsupported media type: ${f.mimeType}. Allowed: mp4/mov/webm or jpeg/png/heic/webp` });
    }

    // Store source in Blob
    const ts = Date.now();
    const fallbackName = isPhoto ? 'photo.jpg' : 'video.mp4';
    const clean = (f.fileName || fallbackName).replace(/[^\w.\-]/g, '_').substring(0, 80);
    const blobPath = `${tenantSlug}/marketing/sources/${ts}-${clean}`;
    const blob = await put(blobPath, f.buffer, { access: 'public', contentType: f.mimeType });

    // Compute scheduled slot
    const scheduledAt = fields.scheduled_at?.trim() || await computeNextSlot(tenantId);

    // Brand multi-select. Accept JSON array OR CSV. Each value is a brand UUID
    // OR a brand slug — we resolve slugs to ids server-side so the mobile UI
    // can pass either.
    const brandInput = parseList(fields.brand_ids || fields.brands);
    const brandIds = brandInput.length ? await resolveBrandIds(tenantId, brandInput) : [];

    // Photos skip the renderer — source IS the rendered output, status='ready'.
    // Videos go through Whisper/Haiku/ffmpeg and start in 'queued'.
    const clipBase = {
      tenant_id: tenantId,
      created_by: fields.created_by || null,
      source_url: blob.url,
      source_filename: f.fileName,
      source_mime_type: f.mimeType,
      source_size_bytes: f.buffer.length,
      title: fields.title?.trim() || f.fileName,
      description: fields.description?.trim() || null,
      hashtags: splitCsv(fields.hashtags),
      target_platforms: splitCsv(fields.platforms),
      scheduled_at: scheduledAt,
      is_photo: isPhoto,
    };

    if (isPhoto) {
      clipBase.rendered_url = blob.url;
      clipBase.thumbnail_url = blob.url;
      clipBase.status = 'ready';
    } else {
      clipBase.status = 'queued';
    }

    const { data: clip, error } = await supabaseAdmin
      .from('marketing_clips').insert(clipBase).select('*').single();
    if (error) return res.status(500).json({ error: error.message });

    // Persist brand selections
    if (brandIds.length) {
      const links = brandIds.map((brand_id) => ({ clip_id: clip.id, brand_id }));
      const { error: linkErr } = await supabaseAdmin
        .from('marketing_clip_brands').insert(links);
      if (linkErr) console.error('[marketing] brand link insert failed:', linkErr.message);
    }

    // Fire-and-forget render (videos only)
    if (isVideo) kickoffRender(req, tenantSlug, clip.id);

    return res.status(202).json({ clip, brand_ids: brandIds });
  }

  // ── PUT (Update metadata / reschedule / edit captions / change brands) ──
  if (req.method === 'PUT') {
    const { id, brand_ids, ...rest } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const updates = {};
    for (const k of EDITABLE_FIELDS) {
      if (rest[k] !== undefined) updates[k] = rest[k];
    }

    if (Object.keys(updates).length) {
      const { error } = await supabaseAdmin
        .from('marketing_clips').update(updates)
        .eq('id', id).eq('tenant_id', tenantId);
      if (error) return res.status(500).json({ error: error.message });
    }

    // Replace brand links if brand_ids provided (array of uuids/slugs)
    if (Array.isArray(brand_ids)) {
      const resolved = await resolveBrandIds(tenantId, brand_ids.map(String));
      await supabaseAdmin.from('marketing_clip_brands').delete().eq('clip_id', id);
      if (resolved.length) {
        await supabaseAdmin.from('marketing_clip_brands').insert(
          resolved.map((brand_id) => ({ clip_id: id, brand_id }))
        );
      }
    }

    const { data: clip } = await supabaseAdmin
      .from('marketing_clips')
      .select('*, brands:marketing_clip_brands(brand:brands(id,slug,name))')
      .eq('id', id).eq('tenant_id', tenantId).single();
    return res.json(flattenBrands(clip));
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });
    const { error } = await supabaseAdmin
      .from('marketing_clips')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);

export const config = { api: { bodyParser: false } };
