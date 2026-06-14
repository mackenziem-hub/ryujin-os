// Ryujin OS · Artifact Layout (per-user workspace layout for the Builders Hall
// artifact shell, WS-A0)
//
// GET    /api/artifact-layout[?workspace=<id>]   -> this user's saved layout
// POST   /api/artifact-layout                    -> upsert this user's layout
//                                                   { layouts, skin, workspace? }
//
// WHY: the artifact shell (builders-hall.html) lets each user drag/resize/
// rearrange artifacts on a grid-snap canvas. Their arrangement + chosen skin
// must persist per user, server-side, so it follows them across machines. This
// mirrors the /api/fleet (PR #434) + deck-suggestions (WS-6) + mockup-verdicts
// Blob pattern: a Vercel Blob channel with its own isolated prefix, one
// deterministic blob per (tenant,user,workspace). No migration.
//
// Storage shape (per E's research _brain/research/2026-06-14-artifact-workspace-
// paradigm.md): keep the grid geometry per breakpoint separate from widget
// config. We persist { layouts: { lg: [...], sm: [...] }, skin, version,
// updated_at }. The live artifact registry lives in the client; the saved layout
// is reconciled against it on load (never trusted as a superset).
//
// Auth: requirePortalSessionAndTenant. Layout is scoped to the authenticated
// user (session.user_id) within their tenant. The service token resolves to a
// shared 'service-internal' user, which is fine (the fleet does not own a
// personal layout).

import { put, list, del } from '@vercel/blob';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

const PREFIX = 'ryujin-artifact-layout-v/';
const SAFE = /^[A-Za-z0-9._:-]{1,160}$/;
const VALID_SKINS = new Set(['ryujin', '8bit', 'indigenous']);
const MAX_ITEMS = 64;            // a workspace will never legitimately hold this many
const MAX_BYTES = 64 * 1024;     // hard cap on a stored layout blob

function bad(res, code, msg, extra = {}) {
  return res.status(code).json({ error: msg, ...extra });
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

function userKey(req) {
  const uid = String((req.session && req.session.user_id) || 'anon').slice(0, 80).replace(/[^A-Za-z0-9._:-]/g, '_');
  const ws = String(req.query?.workspace || (parseBody(req).workspace) || 'builders-hall').trim();
  const wsSafe = SAFE.test(ws) ? ws : 'builders-hall';
  return `${PREFIX}${req.tenant.id}/${uid}/${wsSafe}.json`;
}

async function fetchBlobJson(url) {
  const resp = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!resp.ok) throw new Error(`blob fetch HTTP ${resp.status}`);
  return await resp.json();
}

// Keep only the geometry fields we trust, clamped to sane ranges. Never store
// arbitrary client JSON in a public blob.
function sanitizeLayouts(layouts) {
  const out = {};
  if (!layouts || typeof layouts !== 'object') return out;
  for (const bp of Object.keys(layouts)) {
    if (!SAFE.test(bp)) continue;
    const arr = Array.isArray(layouts[bp]) ? layouts[bp] : [];
    out[bp] = arr.slice(0, MAX_ITEMS).map(function (it) {
      const id = String((it && it.id != null ? it.id : '')).slice(0, 160);
      const n = function (v, lo, hi) { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : lo; };
      return { id: id, x: n(it && it.x, 0, 1000), y: n(it && it.y, 0, 100000), w: n(it && it.w, 1, 48), h: n(it && it.h, 1, 200) };
    }).filter(function (it) { return it.id; });
  }
  return out;
}

async function handleGet(req, res) {
  const key = userKey(req);
  try {
    const { blobs } = await list({ prefix: key, limit: 1 });
    if (!blobs.length) return res.status(200).json({ layout: null });
    const data = await fetchBlobJson(blobs[0].url);
    return res.status(200).json({ layout: data });
  } catch (e) {
    return bad(res, 500, 'read_failed', { detail: e.message });
  }
}

async function handlePost(req, res) {
  const b = parseBody(req);
  const layouts = sanitizeLayouts(b.layouts);
  const skin = VALID_SKINS.has(String(b.skin)) ? String(b.skin) : 'ryujin';
  const row = { layouts, skin, version: 1, updated_at: new Date().toISOString() };
  const payload = JSON.stringify(row);
  if (payload.length > MAX_BYTES) return bad(res, 413, 'layout_too_large');
  const key = userKey(req);
  try {
    await put(key, payload, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
      cacheControlMaxAge: 0,
    });
    return res.status(200).json({ ok: true, layout: row });
  } catch (e) {
    return bad(res, 500, 'write_failed', { detail: e.message });
  }
}

async function handleDelete(req, res) {
  const key = userKey(req);
  try {
    const { blobs } = await list({ prefix: key, limit: 1 });
    if (blobs.length) await del(blobs[0].url);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return bad(res, 500, 'delete_failed', { detail: e.message });
  }
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);
  res.setHeader('Allow', 'GET, POST, DELETE');
  return bad(res, 405, 'method_not_allowed');
}

export default requirePortalSessionAndTenant(handler);
