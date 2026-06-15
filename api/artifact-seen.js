// Ryujin OS · Artifact Seen-map (per-user "what have I already opened" state for
// the fleet-wide unread "!" RPG badge)
//
// GET  /api/artifact-seen   -> this user's seen map { seen: { <artifactId>: <iso> } }
// POST /api/artifact-seen   -> mark artifact(s) seen, merge into the map
//        body { id, seenAt? }      mark one artifact (seenAt defaults to now)
//        body { seen: { id:iso } } bulk-merge (used to reconcile a local cache up)
//
// WHY: Mac wants a yellow quest-marker "!" on any nav item / Builders Hall tile /
// index entry / artifact whose content changed since he last opened it. The badge
// shows when an artifact's updatedAt is newer than this user's lastSeenAt for that
// artifact. lastSeenAt is per-user and must follow him across machines, so it is
// stored server-side. This mirrors the /api/artifact-layout (WS-A0) + /api/fleet
// (PR #434) + mockup-verdicts Blob pattern: a Vercel Blob channel with its own
// isolated prefix, one deterministic blob per (tenant,user). No migration.
//
// The badge component reads this once on load (after an instant localStorage paint)
// and writes back when Mac opens an artifact. Merge-only on write so two tabs never
// clobber each other's progress; the map only ever moves forward in time per id.
//
// Auth: requirePortalSessionAndTenant. Scoped to session.user_id within the tenant.
// The service token resolves to a shared 'service-internal' user, which is fine (the
// fleet does not personally read artifacts; only a real operator clears badges).

import { put, list } from '@vercel/blob';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

const PREFIX = 'ryujin-artifact-seen-v/';
const SAFE = /^[A-Za-z0-9._:-]{1,160}$/;
const MAX_IDS = 400;             // a user will never legitimately track this many artifacts
const MAX_BYTES = 64 * 1024;     // hard cap on a stored seen blob

function bad(res, code, msg, extra = {}) {
  return res.status(code).json({ error: msg, ...extra });
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

function userKey(req) {
  const uid = String((req.session && req.session.user_id) || 'anon')
    .slice(0, 80).replace(/[^A-Za-z0-9._:-]/g, '_');
  return `${PREFIX}${req.tenant.id}/${uid}.json`;
}

async function fetchBlobJson(url) {
  const resp = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!resp.ok) throw new Error(`blob fetch HTTP ${resp.status}`);
  return await resp.json();
}

// Keep only id->ISO pairs we trust. ids must be safe; values must parse as a date.
// Caps the map size by keeping the most recently seen entries.
function sanitizeSeen(seen) {
  const out = {};
  if (!seen || typeof seen !== 'object') return out;
  const entries = [];
  for (const id of Object.keys(seen)) {
    if (!SAFE.test(id)) continue;
    const t = Date.parse(seen[id]);
    if (!Number.isFinite(t)) continue;
    entries.push([id, new Date(t).toISOString(), t]);
  }
  // newest-seen first, then clamp to MAX_IDS so an unbounded client can't grow the blob
  entries.sort((a, b) => b[2] - a[2]);
  for (const [id, iso] of entries.slice(0, MAX_IDS)) out[id] = iso;
  return out;
}

async function readSeen(req) {
  const key = userKey(req);
  const { blobs } = await list({ prefix: key, limit: 1 });
  if (!blobs.length) return {};
  const data = await fetchBlobJson(blobs[0].url);
  return sanitizeSeen(data && data.seen);
}

async function writeSeen(req, seen) {
  const row = { seen, version: 1, updated_at: new Date().toISOString() };
  const payload = JSON.stringify(row);
  if (payload.length > MAX_BYTES) { const e = new Error('seen_too_large'); e.code = 413; throw e; }
  await put(userKey(req), payload, {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
  return row;
}

async function handleGet(req, res) {
  try {
    const seen = await readSeen(req);
    return res.status(200).json({ seen });
  } catch (e) {
    return bad(res, 500, 'read_failed', { detail: e.message });
  }
}

async function handlePost(req, res) {
  const b = parseBody(req);
  // Build the incoming patch: a single {id,seenAt} or a {seen:{...}} bulk merge.
  const patch = {};
  if (b.id != null && SAFE.test(String(b.id))) {
    const t = Date.parse(b.seenAt);
    patch[String(b.id)] = (Number.isFinite(t) ? new Date(t) : new Date()).toISOString();
  }
  if (b.seen && typeof b.seen === 'object') Object.assign(patch, sanitizeSeen(b.seen));
  if (!Object.keys(patch).length) return bad(res, 400, 'no_valid_ids');

  try {
    const current = await readSeen(req);
    // Merge forward-only: keep the later timestamp per id so a stale tab never un-sees.
    for (const id of Object.keys(patch)) {
      const prev = current[id] ? Date.parse(current[id]) : 0;
      const next = Date.parse(patch[id]);
      if (next >= prev) current[id] = patch[id];
    }
    const row = await writeSeen(req, sanitizeSeen(current));
    return res.status(200).json({ ok: true, seen: row.seen });
  } catch (e) {
    if (e.code === 413) return bad(res, 413, 'seen_too_large');
    return bad(res, 500, 'write_failed', { detail: e.message });
  }
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  res.setHeader('Allow', 'GET, POST');
  return bad(res, 405, 'method_not_allowed');
}

export default requirePortalSessionAndTenant(handler);
