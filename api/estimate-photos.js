// Ryujin OS — Estimate Photos (cover + gallery)
// GET    /api/estimate-photos?wo_id=X : Union of estimate_photos + project_files (image/video) for the workorder's customer
// GET    /api/estimate-photos?estimate_id=X : Gallery for one estimate (admin photo manager)
// POST   /api/estimate-photos          : multipart upload (estimate_id, file, is_cover, caption, category)
//                                        OR JSON body { estimate_id, source_url, category, caption, is_cover } to ingest a remote URL
// PATCH  /api/estimate-photos?id=X     : update category / caption / is_cover on an existing photo
// DELETE /api/estimate-photos?id=X
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';
import { put, del } from '@vercel/blob';
import Busboy from 'busboy';
import { promises as dns } from 'node:dns';
import net from 'node:net';

const VALID_CATEGORIES = new Set(['cover', 'before', 'after', 'damage', 'material', 'inspection', 'site', 'other', 'general']);
function normalizeCategory(c) {
  if (!c) return 'general';
  const lower = String(c).trim().toLowerCase();
  return VALID_CATEGORIES.has(lower) ? lower : 'general';
}

// SSRF defense for URL ingest. The literal-hostname blocklist still
// catches localhost / *.internal / explicit private IPs, but an attacker
// can register a public DNS name that resolves to a private or metadata
// address. resolveAndCheck() runs dns.lookup() and rejects if any A/AAAA
// record falls in a blocked range. Called per redirect hop so attacker
// 302s cannot pivot to internal targets after the initial check passes.
function isBlockedIp(ip) {
  if (!ip) return true;
  const v = ip.toLowerCase();
  if (net.isIPv4(v)) {
    return /^127\./.test(v) || /^10\./.test(v) || /^192\.168\./.test(v) ||
           /^172\.(1[6-9]|2[0-9]|3[01])\./.test(v) || /^169\.254\./.test(v) ||
           v === '0.0.0.0' ||
           /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(v); // CGNAT 100.64.0.0/10
  }
  if (net.isIPv6(v)) {
    return v === '::1' || v === '::' ||
           /^fc[0-9a-f]{2}:/i.test(v) || /^fd[0-9a-f]{2}:/i.test(v) ||
           /^fe80:/i.test(v) ||
           /^::ffff:127\./i.test(v) || /^::ffff:10\./i.test(v) ||
           /^::ffff:192\.168\./i.test(v) || /^::ffff:169\.254\./i.test(v) ||
           /^::ffff:172\.(1[6-9]|2[0-9]|3[01])\./i.test(v);
  }
  return true;
}
async function resolveAndCheck(hostname) {
  if (net.isIP(hostname)) {
    return isBlockedIp(hostname)
      ? { blocked: true, reason: `IP ${hostname} in blocked range` }
      : { blocked: false };
  }
  let ips;
  try { ips = await dns.lookup(hostname, { all: true }); }
  catch (e) { return { blocked: true, reason: `DNS lookup failed: ${e.code || e.message}` }; }
  if (!ips || !ips.length) return { blocked: true, reason: 'No DNS records' };
  for (const { address } of ips) {
    if (isBlockedIp(address)) return { blocked: true, reason: `${hostname} resolves to blocked ${address}` };
  }
  return { blocked: false };
}

const MAX_FILE_SIZE = 60 * 1024 * 1024; // bumped to 60MB to cover short cover-video renders
const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif']);
const ALLOWED_VIDEO = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const files = [];
    const fields = {};
    const busboy = Busboy({ headers: req.headers, limits: { files: 5, fileSize: MAX_FILE_SIZE } });
    busboy.on('field', (n, v) => { fields[n] = v; });
    busboy.on('file', (n, stream, info) => {
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => files.push({ buffer: Buffer.concat(chunks), mimeType: info.mimeType, fileName: info.filename }));
    });
    busboy.on('close', () => resolve({ files, fields }));
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  // GET ?wo_id=X. Return unified media list for the workorder. Walks
  // workorder -> linked estimate -> customer -> estimates + projects, then
  // unions estimate_photos (legacy gallery) with image/video project_files
  // (crew captures via /api/files). Used by job.html ?wo= folder view.
  if (req.method === 'GET' && req.query?.wo_id) {
    const woId = req.query.wo_id;
    const { data: wo, error: woErr } = await supabaseAdmin
      .from('workorders')
      .select('id, tenant_id, linked_estimate_id, customer_name')
      .eq('id', woId)
      .eq('tenant_id', tenantId)
      .single();
    if (woErr || !wo) return res.status(404).json({ error: 'Workorder not found for this tenant' });

    // workorders table has no customer_id column. Resolve via linked estimate.
    let customerId = null;
    if (wo.linked_estimate_id) {
      const { data: est } = await supabaseAdmin
        .from('estimates').select('customer_id').eq('id', wo.linked_estimate_id).eq('tenant_id', tenantId).single();
      customerId = est?.customer_id || null;
    }
    // Last-ditch fallback: match by customer_name when no estimate link exists.
    if (!customerId && wo.customer_name) {
      const { data: cust } = await supabaseAdmin
        .from('customers').select('id').eq('tenant_id', tenantId).ilike('full_name', wo.customer_name).limit(1).maybeSingle();
      customerId = cust?.id || null;
    }

    // Estimate gallery: every estimate row for this customer
    let estimatePhotos = [];
    if (customerId) {
      const { data: estIds } = await supabaseAdmin
        .from('estimates').select('id').eq('tenant_id', tenantId).eq('customer_id', customerId);
      const ids = (estIds || []).map(e => e.id);
      if (ids.length) {
        const { data: rows } = await supabaseAdmin
          .from('estimate_photos')
          .select('id, url, filename, mime_type, caption, is_cover, uploaded_at, estimate_id')
          .in('estimate_id', ids)
          .order('uploaded_at', { ascending: false });
        estimatePhotos = (rows || []).map(r => ({ ...r, source: 'estimate_photos' }));
      }
    }

    // Project files: crew captures keyed by project belonging to this customer.
    // project_files has its own tenant_id column, so apply a direct tenant
    // predicate as defense-in-depth (belt-and-suspenders alongside the
    // project_id IN filter resolved through tenant-scoped projects).
    let projectFiles = [];
    if (customerId) {
      const { data: projs } = await supabaseAdmin
        .from('projects').select('id').eq('tenant_id', tenantId).eq('customer_id', customerId);
      const pids = (projs || []).map(p => p.id);
      if (pids.length) {
        const { data: rows } = await supabaseAdmin
          .from('project_files')
          .select('id, url, thumbnail_url, filename, mime_type, category, caption, captured_at, uploaded_at, sort_order, is_cover, project_id')
          .eq('tenant_id', tenantId)
          .in('project_id', pids)
          .order('uploaded_at', { ascending: false });
        projectFiles = (rows || [])
          .filter(r => typeof r.mime_type === 'string' && (r.mime_type.startsWith('image/') || r.mime_type.startsWith('video/')))
          .map(r => ({ ...r, source: 'project_files' }));
      }
    }

    // Union, newest first. Same shape so client renders uniformly.
    const photos = [...estimatePhotos, ...projectFiles].sort((a, b) => {
      const da = new Date(a.captured_at || a.uploaded_at || 0).getTime();
      const db = new Date(b.captured_at || b.uploaded_at || 0).getTime();
      return db - da;
    });
    return res.json({ photos, counts: { estimate_photos: estimatePhotos.length, project_files: projectFiles.length } });
  }

  // GET ?estimate_id=X returns the single-estimate gallery for the admin photo manager.
  if (req.method === 'GET' && req.query?.estimate_id) {
    const estimateId = req.query.estimate_id;
    const { data: est } = await supabaseAdmin
      .from('estimates').select('id').eq('id', estimateId).eq('tenant_id', tenantId).single();
    if (!est) return res.status(404).json({ error: 'Estimate not found for this tenant' });
    const { data: rows } = await supabaseAdmin
      .from('estimate_photos')
      .select('id, url, filename, mime_type, category, caption, is_cover, uploaded_at, estimate_id')
      .eq('estimate_id', estimateId)
      .order('is_cover', { ascending: false })
      .order('uploaded_at', { ascending: false });
    return res.json({ photos: rows || [] });
  }

  if (req.method === 'POST') {
    // JSON body? Branch to URL-ingest path. Accepts a public image URL
    // (Drive direct-link, EagleView aerial, Higgsfield render, anything
    // resolvable from Vercel's outbound IP) and stores it in Blob just
    // like a direct upload would.
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      const body = req.body || {};
      const estimateId = body.estimate_id;
      const sourceUrl = body.source_url;
      if (!estimateId) return res.status(400).json({ error: 'estimate_id required' });
      if (!sourceUrl) return res.status(400).json({ error: 'source_url required' });

      const { data: est } = await supabaseAdmin
        .from('estimates').select('id').eq('id', estimateId).eq('tenant_id', tenantId).single();
      if (!est) return res.status(404).json({ error: 'Estimate not found for this tenant' });

      const category = normalizeCategory(body.category);
      const caption = body.caption || null;
      const isCover = body.is_cover === true || body.is_cover === 'true' || category === 'cover';

      // SSRF guard: validate scheme + reject private IPs / metadata services /
      // localhost. Without this, a tenant slug holder could trick the
      // server into fetching internal endpoints (cloud metadata, intranet
      // services, file://) and persisting the response to Blob.
      let parsedUrl;
      try { parsedUrl = new URL(sourceUrl); } catch { return res.status(400).json({ error: 'Invalid source_url' }); }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ error: 'source_url must be http(s)' });
      }
      const host = parsedUrl.hostname.toLowerCase();
      const blockedHost =
        host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') ||
        host === '0.0.0.0' || host === '::' || host === '[::]' ||
        /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^fc[0-9a-f]{2}:/i.test(host) || /^fd[0-9a-f]{2}:/i.test(host) ||
        host === 'metadata.google.internal';
      if (blockedHost) return res.status(400).json({ error: 'source_url host not allowed' });

      // Normalize common share-URL shapes that don't serve raw image bytes:
      //   Google Drive /file/d/<id>/view  -> /uc?id=<id>
      //   drive.google.com/open?id=<id>   -> /uc?id=<id>
      let fetchUrl = sourceUrl;
      const driveFile = sourceUrl.match(/drive\.google\.com\/file\/d\/([^/]+)/);
      const driveOpen = sourceUrl.match(/drive\.google\.com\/(?:open|uc)\?[^#]*id=([^&]+)/);
      if (driveFile) fetchUrl = `https://drive.google.com/uc?export=download&id=${driveFile[1]}`;
      else if (driveOpen) fetchUrl = `https://drive.google.com/uc?export=download&id=${driveOpen[1]}`;

      // Bound the fetch: 30s wall-clock, reject upfront if Content-Length
      // exceeds the cap, and abort mid-stream if running byte total grows
      // past it (some hosts omit Content-Length). Redirects are followed
      // manually so each hop's hostname is re-validated against the
      // SSRF blocklist (auto-follow could land on a private IP without
      // the original URL ever pointing at one).
      const isBlockedHost = (h) => {
        h = h.toLowerCase();
        return h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') ||
               h === '0.0.0.0' || h === '::' || h === '[::]' ||
               /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
               /^172\.(1[6-9]|2[0-9]|3[01])\./.test(h) || /^169\.254\./.test(h) ||
               /^fc[0-9a-f]{2}:/i.test(h) || /^fd[0-9a-f]{2}:/i.test(h) ||
               h === 'metadata.google.internal';
      };
      // DNS pre-check on the initial hostname (after URL normalization).
      // Closes the public-name-resolving-to-private-IP SSRF gap that pure
      // string matching cannot catch.
      const initialCheck = await resolveAndCheck(new URL(fetchUrl).hostname);
      if (initialCheck.blocked) return res.status(400).json({ error: `source_url blocked: ${initialCheck.reason}` });

      let buffer, mime;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);
      try {
        let currentUrl = fetchUrl;
        let r;
        for (let hop = 0; hop < 6; hop++) {
          r = await fetch(currentUrl, { signal: controller.signal, redirect: 'manual' });
          if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
            const next = new URL(r.headers.get('location'), currentUrl);
            if (next.protocol !== 'http:' && next.protocol !== 'https:') {
              clearTimeout(timeoutId);
              return res.status(400).json({ error: `Redirect to non-http(s): ${next.protocol}` });
            }
            if (isBlockedHost(next.hostname)) {
              clearTimeout(timeoutId);
              return res.status(400).json({ error: `Redirect to blocked host: ${next.hostname}` });
            }
            const hopCheck = await resolveAndCheck(next.hostname);
            if (hopCheck.blocked) {
              clearTimeout(timeoutId);
              return res.status(400).json({ error: `Redirect blocked: ${hopCheck.reason}` });
            }
            currentUrl = next.toString();
            continue;
          }
          break;
        }
        if (!r || (r.status >= 300 && r.status < 400)) {
          clearTimeout(timeoutId);
          return res.status(400).json({ error: 'Too many redirects on source_url' });
        }
        if (!r.ok) { clearTimeout(timeoutId); return res.status(400).json({ error: `Could not fetch source_url (${r.status})` }); }
        mime = (r.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
        const declared = Number(r.headers.get('content-length') || 0);
        if (declared && declared > MAX_FILE_SIZE) {
          clearTimeout(timeoutId);
          controller.abort();
          return res.status(413).json({ error: `Remote file exceeds 60MB (declared ${(declared/1e6).toFixed(1)}MB)` });
        }
        // Streaming read with byte cap.
        const chunks = [];
        let total = 0;
        const reader = r.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > MAX_FILE_SIZE) {
            try { await reader.cancel(); } catch {}
            controller.abort();
            clearTimeout(timeoutId);
            return res.status(413).json({ error: 'Remote file exceeds 60MB' });
          }
          chunks.push(value);
        }
        buffer = Buffer.concat(chunks);
      } catch (e) {
        clearTimeout(timeoutId);
        const msg = e.name === 'AbortError' ? 'Fetch timed out or aborted (30s cap)' : `Fetch failed: ${e.message}`;
        return res.status(400).json({ error: msg });
      }
      clearTimeout(timeoutId);
      if (!ALLOWED_IMAGE.has(mime) && !ALLOWED_VIDEO.has(mime)) {
        return res.status(415).json({ error: `Unsupported remote type: ${mime}` });
      }

      if (isCover) {
        await supabaseAdmin.from('estimate_photos').update({ is_cover: false }).eq('estimate_id', estimateId);
      }
      const guessExt = mime.split('/')[1]?.split(';')[0] || 'jpg';
      const filename = (body.filename || `url-ingest-${Date.now()}.${guessExt}`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const blobPath = `tenants/${req.tenant.slug}/estimates/${estimateId}/${Date.now()}-${filename}`;
      const blob = await put(blobPath, buffer, { access: 'public', contentType: mime });
      const { data: row, error } = await supabaseAdmin
        .from('estimate_photos')
        .insert({ estimate_id: estimateId, url: blob.url, filename, mime_type: mime, is_cover: isCover, caption, category })
        .select('*')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ photos: [row] });
    }

    // Multipart upload (existing path). Now reads category off the form.
    const { files, fields } = await parseMultipart(req);
    if (!files.length) return res.status(400).json({ error: 'No files provided' });

    const estimateId = fields.estimate_id;
    if (!estimateId) return res.status(400).json({ error: 'estimate_id required' });

    const { data: est } = await supabaseAdmin
      .from('estimates').select('id').eq('id', estimateId).eq('tenant_id', tenantId).single();
    if (!est) return res.status(404).json({ error: 'Estimate not found for this tenant' });

    const category = normalizeCategory(fields.category);
    const isCover = fields.is_cover === 'true' || fields.is_cover === '1' || category === 'cover';
    const caption = fields.caption || null;
    const results = [];

    if (isCover) {
      await supabaseAdmin.from('estimate_photos').update({ is_cover: false }).eq('estimate_id', estimateId);
    }

    for (const f of files) {
      const isVideo = ALLOWED_VIDEO.has(f.mimeType);
      if (!ALLOWED_IMAGE.has(f.mimeType) && !isVideo) {
        results.push({ filename: f.fileName, error: `Unsupported type: ${f.mimeType}` });
        continue;
      }
      if (isVideo) {
        await supabaseAdmin.from('estimate_photos').delete()
          .eq('estimate_id', estimateId).eq('caption', 'cover_video');
      }
      const safeName = f.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const blobPath = `tenants/${req.tenant.slug}/estimates/${estimateId}/${Date.now()}-${safeName}`;
      const blob = await put(blobPath, f.buffer, { access: 'public', contentType: f.mimeType });
      const { data: row, error } = await supabaseAdmin
        .from('estimate_photos')
        .insert({ estimate_id: estimateId, url: blob.url, filename: f.fileName, mime_type: f.mimeType, is_cover: isCover, caption, category })
        .select('*')
        .single();
      if (error) { results.push({ filename: f.fileName, error: error.message }); continue; }
      results.push(row);
    }

    return res.status(201).json({ photos: results });
  }

  // PATCH relabels an existing photo without re-uploading.
  if (req.method === 'PATCH' || req.method === 'PUT') {
    const id = req.query?.id;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });
    const body = req.body || {};
    const { data: existing } = await supabaseAdmin
      .from('estimate_photos')
      .select('id, estimate_id, estimate:estimates!inner(tenant_id)')
      .eq('id', id).single();
    if (!existing || existing.estimate.tenant_id !== tenantId) return res.status(404).json({ error: 'Photo not found' });

    const patch = {};
    if (body.category !== undefined) patch.category = normalizeCategory(body.category);
    if (body.caption !== undefined) patch.caption = body.caption || null;
    if (body.is_cover !== undefined) {
      patch.is_cover = body.is_cover === true || body.is_cover === 'true';
      if (patch.is_cover) {
        await supabaseAdmin.from('estimate_photos').update({ is_cover: false }).eq('estimate_id', existing.estimate_id);
      }
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No fields to update' });

    const { data: row, error } = await supabaseAdmin
      .from('estimate_photos').update(patch).eq('id', id).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ photo: row });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });
    const { data: photo } = await supabaseAdmin
      .from('estimate_photos')
      .select('url, estimate:estimates!inner(tenant_id)')
      .eq('id', id)
      .single();
    if (!photo || photo.estimate.tenant_id !== tenantId) return res.status(404).json({ error: 'Photo not found' });
    try { await del(photo.url); } catch (e) { /* blob gone or unreachable — ok */ }
    await supabaseAdmin.from('estimate_photos').delete().eq('id', id);
    return res.json({ deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requirePortalSessionAndTenant(handler);
