// Ryujin OS — AI roof-render generator (Higgsfield img2img)
// POST /api/generate-render  body { estimate_id, roof_type, base_image_url? }
//   -> creates a Higgsfield image-to-image job that re-roofs the home photo in the
//      chosen material, polls for completion, stores the result in Blob, and saves
//      it as an estimate_photo. Returns { photo }.
// GET  /api/generate-render?estimate_id=X&job_id=Y&roof_type=Z
//   -> re-polls a job that was still rendering on the POST and finalizes it.
//
// Requires HIGGSFIELD_API_KEY in the environment. Optional overrides:
//   HIGGSFIELD_API_URL   (default https://api.higgsfield.ai)
//   HIGGSFIELD_IMG_MODEL (default nano-banana)
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';
import { put } from '@vercel/blob';

// img2img prompts. The "keep EVERYTHING ELSE identical" framing is the reliable
// pattern for surgical roof swaps (see reference_higgsfield_img2img_character_removal).
const KEEP = 'Keep EVERYTHING ELSE identical and unchanged: walls, siding, windows, doors, chimneys, gutters, trees, landscaping, driveway, sky, lighting, and the exact camera angle. Photorealistic, natural light, high resolution.';
const ROOF_PROMPTS = {
  shingle: `Replace ONLY the roof covering with brand-new architectural asphalt shingles in a rich weathered-charcoal colour, crisp straight courses and a clean ridge cap. ${KEEP}`,
  community_barn: `Replace ONLY the roof covering with brand-new ribbed agricultural-style metal roofing (Community Barn / Ameri-Cana ribbed profile) in a classic deep charcoal with visible vertical ribs. ${KEEP}`,
  metal: `Replace ONLY the roof covering with brand-new metal roofing in a clean charcoal grey with crisp vertical seams. ${KEEP}`,
  euro_clay: `Replace ONLY the roof covering with European clay-tile-imitation metal roofing in warm terracotta clay-red tones, the look of barrel clay tiles, crisp and new. ${KEEP}`,
  standing_seam: `Replace ONLY the roof covering with premium hidden-fastener standing-seam metal roofing in matte black, clean tall vertical seams, architectural and high-end. ${KEEP}`,
};
// Maps a roof_type to the estimate_photos category it is saved under.
const TYPE_CATEGORY = {
  shingle: 'after', community_barn: 'after', metal: 'after', euro_clay: 'after', standing_seam: 'after',
};

const API_URL = (process.env.HIGGSFIELD_API_URL || 'https://api.higgsfield.ai').trim().replace(/\/+$/, '');
const IMG_MODEL = (process.env.HIGGSFIELD_IMG_MODEL || 'nano-banana').trim();

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Higgsfield response shapes vary; dig the finished image URL out defensively.
function extractImageUrl(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const direct = obj.result_url || obj.output_url || obj.image_url || obj.url || obj.asset_url;
  if (typeof direct === 'string' && /^https?:\/\//.test(direct)) return direct;
  const arrays = [obj.output, obj.images, obj.results, obj.assets, obj.result && obj.result.images];
  for (const arr of arrays) {
    if (Array.isArray(arr) && arr.length) {
      const first = arr[0];
      if (typeof first === 'string' && /^https?:\/\//.test(first)) return first;
      if (first && typeof first === 'object') {
        const u = first.url || first.image_url || first.result_url || first.asset_url;
        if (typeof u === 'string' && /^https?:\/\//.test(u)) return u;
      }
    }
  }
  if (obj.result && typeof obj.result === 'object') return extractImageUrl(obj.result);
  if (obj.data && typeof obj.data === 'object') return extractImageUrl(obj.data);
  return null;
}
function extractJobId(obj) {
  return (obj && (obj.id || obj.job_id || (obj.data && (obj.data.id || obj.data.job_id)))) || null;
}
function extractStatus(obj) {
  return String((obj && (obj.status || (obj.data && obj.data.status))) || '').toLowerCase();
}

async function pollJob(jobId, key, maxMs) {
  const deadline = Date.now() + maxMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await fetch(`${API_URL}/v1/generations/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const text = await r.text();
    try { last = text ? JSON.parse(text) : {}; } catch { last = { raw: text }; }
    const status = extractStatus(last);
    const url = extractImageUrl(last);
    if (url && (!status || ['completed', 'succeeded', 'success', 'done', 'ready'].includes(status))) return { url, body: last };
    if (['failed', 'error', 'canceled', 'cancelled'].includes(status)) return { error: last.error || `job ${status}`, body: last };
    await sleep(3000);
  }
  return { pending: true, body: last };
}

// Pull the result image into Blob + persist as an estimate_photo.
async function finalize({ estimateId, slug, roofType, imageUrl }) {
  const r = await fetch(imageUrl);
  if (!r.ok) throw new Error(`could not fetch render (${r.status})`);
  const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  const buf = Buffer.from(await r.arrayBuffer());
  const ext = (mime.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
  const blobPath = `tenants/${slug}/estimates/${estimateId}/render-${roofType}-${Date.now()}.${ext}`;
  const blob = await put(blobPath, buf, { access: 'public', contentType: mime });
  const caption = `${roofType.replace(/_/g, ' ')} render`;
  const { data: row, error } = await supabaseAdmin
    .from('estimate_photos')
    .insert({ estimate_id: estimateId, url: blob.url, filename: `render-${roofType}.${ext}`, mime_type: mime, caption, category: TYPE_CATEGORY[roofType] || 'after', is_cover: false })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return row;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;
  const key = (process.env.HIGGSFIELD_API_KEY || '').trim();
  if (!key) {
    return res.status(501).json({ error: 'AI render generation is not configured yet. Add HIGGSFIELD_API_KEY in the Vercel environment to enable it.' });
  }

  const q = req.query || {};
  const body = req.method === 'POST' ? (req.body || {}) : {};
  const estimateId = body.estimate_id || q.estimate_id;
  const roofType = body.roof_type || q.roof_type;
  if (!estimateId) return res.status(400).json({ error: 'estimate_id required' });
  if (!roofType || !ROOF_PROMPTS[roofType]) {
    return res.status(400).json({ error: `roof_type must be one of: ${Object.keys(ROOF_PROMPTS).join(', ')}` });
  }

  // Tenant scoping + a base photo to re-roof.
  const { data: est } = await supabaseAdmin
    .from('estimates').select('id, tenant_id').eq('id', estimateId).eq('tenant_id', tenantId).single();
  if (!est) return res.status(404).json({ error: 'Estimate not found for this tenant' });
  const slug = req.tenant.slug;

  // GET = re-poll an in-flight job and finalize it.
  if (req.method === 'GET') {
    const jobId = q.job_id;
    if (!jobId) return res.status(400).json({ error: 'job_id required for polling' });
    const out = await pollJob(jobId, key, 45000);
    if (out.error) return res.status(502).json({ error: 'Render failed: ' + out.error });
    if (out.pending) return res.status(202).json({ status: 'pending', job_id: jobId });
    const photo = await finalize({ estimateId, slug, roofType, imageUrl: out.url });
    return res.status(201).json({ photo });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Resolve the base image: explicit, else the estimate's cover/first photo.
  let baseImage = body.base_image_url;
  if (!baseImage) {
    const { data: ph } = await supabaseAdmin
      .from('estimate_photos').select('url, is_cover, uploaded_at')
      .eq('estimate_id', estimateId).order('is_cover', { ascending: false }).order('uploaded_at', { ascending: false }).limit(1);
    baseImage = ph && ph[0] && ph[0].url;
  }
  if (!baseImage) return res.status(400).json({ error: 'No base photo to render from. Upload a home photo first or pass base_image_url.' });

  // Create the Higgsfield job.
  let create;
  try {
    const r = await fetch(`${API_URL}/v1/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'image-to-image',
        model: IMG_MODEL,
        prompt: ROOF_PROMPTS[roofType],
        input_image: baseImage,
        reference_image_urls: [baseImage],
        width: 1600,
        height: 1066,
      }),
    });
    const text = await r.text();
    try { create = text ? JSON.parse(text) : {}; } catch { create = { raw: text }; }
    if (!r.ok) return res.status(502).json({ error: `Higgsfield create failed (${r.status}): ${(create.error || text || '').toString().slice(0, 200)}` });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach Higgsfield: ' + e.message });
  }

  // Some configs return the image inline on create; handle that fast path.
  const inlineUrl = extractImageUrl(create);
  if (inlineUrl) {
    const photo = await finalize({ estimateId, slug, roofType, imageUrl: inlineUrl });
    return res.status(201).json({ photo });
  }

  const jobId = extractJobId(create);
  if (!jobId) return res.status(502).json({ error: 'Higgsfield did not return a job id. Raw: ' + JSON.stringify(create).slice(0, 200) });

  const out = await pollJob(jobId, key, 45000);
  if (out.error) return res.status(502).json({ error: 'Render failed: ' + out.error });
  if (out.pending) return res.status(202).json({ status: 'pending', job_id: jobId });
  const photo = await finalize({ estimateId, slug, roofType, imageUrl: out.url });
  return res.status(201).json({ photo });
}

export default requirePortalSessionAndTenant(handler);
export const config = { maxDuration: 60 };
