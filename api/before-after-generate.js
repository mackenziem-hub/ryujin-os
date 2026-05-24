// Ryujin OS - Before/After static post generator
// POST /api/before-after-generate
//
// Body: {
//   before_id: uuid,
//   after_id: uuid,
//   before_source: 'estimate_photos' | 'project_files',
//   after_source: 'estimate_photos' | 'project_files',
//   format: 'square' | 'landscape',
//   address: string,                  // burned on bottom strip
//   product: string,                  // burned under address
//   wo_id?: uuid,                     // optional, used for blob path slug
// }
//
// Resolves each photo (tenant-scoped, cross-tenant rejected), pulls its
// blob URL, composites via lib/beforeAfterRenderer.js, uploads the result
// to Vercel Blob at:
//   tenants/{slug}/before-after/{hash}-{format}.jpg
// The hash is derived from the input ids so re-generating the same pair
// overwrites instead of duplicating.
//
// Returns { url, format, size, width, height }.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { put } from '@vercel/blob';
import crypto from 'node:crypto';
import { renderBeforeAfterPair } from '../lib/beforeAfterRenderer.js';

async function resolvePhotoUrl(tenantId, id, source) {
  if (!id) return { error: 'photo id required' };
  if (source === 'estimate_photos') {
    const { data } = await supabaseAdmin
      .from('estimate_photos')
      .select('url, estimate:estimates!inner(tenant_id)')
      .eq('id', id)
      .maybeSingle();
    if (!data) return { error: 'photo not found' };
    if (data.estimate.tenant_id !== tenantId) return { error: 'photo not found' };
    return { url: data.url };
  }
  if (source === 'project_files') {
    const { data } = await supabaseAdmin
      .from('project_files')
      .select('url, tenant_id')
      .eq('id', id)
      .maybeSingle();
    if (!data) return { error: 'photo not found' };
    if (data.tenant_id !== tenantId) return { error: 'photo not found' };
    return { url: data.url };
  }
  return { error: 'unknown source' };
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
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

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const tenantId = req.tenant.id;
  let body;
  try { body = await readJsonBody(req); }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const {
    before_id,
    after_id,
    before_source = 'estimate_photos',
    after_source = 'estimate_photos',
    format = 'square',
    address = '',
    product = '',
    wo_id = null,
  } = body || {};

  if (!before_id || !after_id) return res.status(400).json({ error: 'before_id and after_id required' });
  if (!['square', 'landscape'].includes(format)) return res.status(400).json({ error: 'format must be square or landscape' });

  const [beforeRes, afterRes] = await Promise.all([
    resolvePhotoUrl(tenantId, before_id, before_source),
    resolvePhotoUrl(tenantId, after_id, after_source),
  ]);
  if (beforeRes.error) return res.status(404).json({ error: 'before: ' + beforeRes.error });
  if (afterRes.error) return res.status(404).json({ error: 'after: ' + afterRes.error });

  let rendered;
  try {
    rendered = await renderBeforeAfterPair({
      beforeUrl: beforeRes.url,
      afterUrl: afterRes.url,
      address,
      product,
      format,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Render failed: ' + e.message });
  }

  // Idempotent path: same inputs -> same hash -> same blob key. Bump the
  // RENDERER_VERSION suffix whenever the overlay/SVG changes so a fresh
  // upload writes to a new URL (Vercel Blob's CDN caches by URL and even
  // allowOverwrite re-uploads can serve stale bytes for many minutes).
  const RENDERER_VERSION = 'v4';
  const hash = crypto
    .createHash('sha1')
    .update([before_id, after_id, format, RENDERER_VERSION].join('|'))
    .digest('hex')
    .slice(0, 16);
  const slug = wo_id ? wo_id.slice(0, 8) : 'job';
  const blobPath = `tenants/${req.tenant.slug}/before-after/${hash}-${slug}-${format}.jpg`;

  let blob;
  try {
    blob = await put(blobPath, rendered.buffer, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Blob upload failed: ' + e.message });
  }

  return res.json({
    url: blob.url,
    format,
    size: rendered.buffer.length,
    width: rendered.width,
    height: rendered.height,
  });
}

export default requireTenant(handler);

// Larger body limit for the JSON payload (still well under the streaming
// readJsonBody 256KB cap; this just relaxes Vercel's default 4.5MB).
export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
