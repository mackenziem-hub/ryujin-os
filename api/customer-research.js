// Ryujin OS — Customer research / talking-points store
// Pre-call enrichment: public-web research on a customer (their business, area,
// recent local news, public presence) distilled into talking points + interests
// for pre-call prep. INTERNAL prep only — never outbound to the customer.
//
// GET  /api/customer-research?id=<ghlContactId>   -> { research } | { research: null }   (session or service)
// GET  /api/customer-research?queue=1             -> { pending: [...] }                   (privileged: the local worker polls this)
// POST /api/customer-research { ghl_contact_id, customer_id? }                            -> enqueue (button / auto)
// POST /api/customer-research { ghl_contact_id, result: {summary, talking_points[], interests[], sources[]} }  -> write result + clear queue (privileged: the worker)
//
// Storage = Vercel Blob (no DB migration needed). Two prefixes:
//   crm-research-v/{tenant}/{ghlId}.json        the distilled research doc
//   crm-research-queue-v/{tenant}/{ghlId}.json  a pending marker the worker drains
// The local worker (scheduled on Mac's machine) drains the queue AND auto-detects
// newly booked inspections, runs the web research via headless Claude + WebSearch,
// and POSTs the result back here. Mirrors the api/artifact-seen.js Blob idiom.
import { put, list, del } from '@vercel/blob';
import { requirePortalSessionAndTenant, isPrivileged } from '../lib/portalAuth.js';

const RESULT_PREFIX = 'crm-research-v/';
const QUEUE_PREFIX = 'crm-research-queue-v/';
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 48 * 1024;

function bad(res, code, msg, extra = {}) { return res.status(code).json({ error: msg, ...extra }); }
function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}
function resultKey(tenantId, ghlId) { return `${RESULT_PREFIX}${tenantId}/${ghlId}.json`; }
function queueKey(tenantId, ghlId) { return `${QUEUE_PREFIX}${tenantId}/${ghlId}.json`; }

async function readBlobJson(key) {
  const { blobs } = await list({ prefix: key, limit: 1 });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url + (blobs[0].url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) return null;
  return r.json();
}
async function writeBlobJson(key, obj) {
  const payload = JSON.stringify(obj);
  if (payload.length > MAX_BYTES) { const e = new Error('too_large'); e.code = 413; throw e; }
  await put(key, payload, { access: 'public', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 0, allowOverwrite: true });
}

// Trust only well-formed research from the worker; cap array sizes.
function sanitizeResult(r) {
  if (!r || typeof r !== 'object') return null;
  const arr = (v, n, len) => Array.isArray(v) ? v.slice(0, n).map(x => String(typeof x === 'string' ? x : (x?.point || x?.text || '')).slice(0, len)).filter(Boolean) : [];
  return {
    summary: r.summary ? String(r.summary).slice(0, 2000) : '',
    talking_points: arr(r.talking_points || r.points, 12, 300),
    interests: arr(r.interests, 12, 60),
    sources: Array.isArray(r.sources) ? r.sources.slice(0, 20).map(s => String(typeof s === 'string' ? s : (s?.url || s?.title || '')).slice(0, 300)).filter(Boolean) : [],
    researched_at: new Date().toISOString(),
    researched_by: r.researched_by ? String(r.researched_by).slice(0, 60) : null,
  };
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  const tenantId = req.tenant.id;
  const priv = isPrivileged(req.session);

  if (req.method === 'GET') {
    if (req.query.queue) {
      if (!priv) return bad(res, 403, 'forbidden');
      try {
        const { blobs } = await list({ prefix: `${QUEUE_PREFIX}${tenantId}/`, limit: 200 });
        const pending = [];
        for (const b of blobs) {
          const r = await fetch(b.url + '?t=' + Date.now(), { cache: 'no-store' }).then(x => x.ok ? x.json() : null).catch(() => null);
          if (r) pending.push(r);
        }
        pending.sort((a, b) => String(a.requestedAt || '').localeCompare(String(b.requestedAt || '')));
        return res.status(200).json({ pending, count: pending.length });
      } catch (e) { return bad(res, 500, 'queue_read_failed', { detail: e.message }); }
    }
    const ghlId = String(req.query.id || '').trim();
    if (!SAFE_ID.test(ghlId)) return bad(res, 400, 'bad_id');
    try {
      const research = await readBlobJson(resultKey(tenantId, ghlId));
      return res.status(200).json({ research: research || null });
    } catch (e) { return bad(res, 500, 'read_failed', { detail: e.message }); }
  }

  if (req.method === 'POST') {
    const b = parseBody(req);
    const ghlId = String(b.ghl_contact_id || b.id || '').trim();
    if (!SAFE_ID.test(ghlId)) return bad(res, 400, 'bad_id');

    // Worker writing a completed result (privileged only).
    if (b.result) {
      if (!priv) return bad(res, 403, 'forbidden');
      const clean = sanitizeResult(b.result);
      if (!clean) return bad(res, 400, 'bad_result');
      if (b.researched_by) clean.researched_by = String(b.researched_by).slice(0, 60);
      try {
        await writeBlobJson(resultKey(tenantId, ghlId), clean);
        // Clear the queue marker now that it is done.
        try { const { blobs } = await list({ prefix: queueKey(tenantId, ghlId), limit: 1 }); if (blobs.length) await del(blobs[0].url); } catch { /* best effort */ }
        return res.status(200).json({ ok: true, research: clean });
      } catch (e) { if (e.code === 413) return bad(res, 413, 'too_large'); return bad(res, 500, 'write_failed', { detail: e.message }); }
    }

    // Enqueue a research request (session or service).
    try {
      const marker = {
        ghl_contact_id: ghlId,
        customer_id: (b.customer_id && String(b.customer_id).slice(0, 64)) || null,
        reason: (b.reason && String(b.reason).slice(0, 40)) || 'on_demand',
        requestedAt: new Date().toISOString(),
        requestedBy: (req.session && req.session.email) || 'unknown',
      };
      await writeBlobJson(queueKey(tenantId, ghlId), marker);
      return res.status(202).json({ ok: true, queued: marker });
    } catch (e) { return bad(res, 500, 'enqueue_failed', { detail: e.message }); }
  }

  res.setHeader('Allow', 'GET, POST');
  return bad(res, 405, 'method_not_allowed');
}

export default requirePortalSessionAndTenant(handler);
