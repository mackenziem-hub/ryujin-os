// Ryujin OS · Mockup Verdicts (durable approve/reject store for the Admin
// Mockups Review section)
//
// GET    /api/mockup-verdicts                 -> list all verdicts for the tenant
// POST   /api/mockup-verdicts                 -> upsert one verdict
//                                                { mockup_id, verdict, note? }
// DELETE /api/mockup-verdicts?mockup=<id>     -> clear a verdict (back to pending)
//
// WHY: Mac wants "a reliable place to look it up" for his mockup decisions, and
// the fleet needs to read those decisions. This mirrors the /api/fleet
// coordination-bus Blob pattern (PR #434) and api/deck-suggestions.js (WS-6): a
// Vercel Blob channel with its own isolated prefix, one deterministic blob per
// mockup keyed by mockup_id so an upsert rewrites the same key. No migration.
//
// Auth: requirePortalSessionAndTenant resolves BOTH Mac's owner login (the
// review UI in his browser) AND the service token + x-tenant-id (the fleet from
// another machine, same creds it uses for /api/fleet), binding the tenant
// authoritatively from the session. Verdicts are therefore durable AND
// fleet-readable, per the order. Tenant binding is the security boundary.

import { put, list, del } from '@vercel/blob';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

const PREFIX = 'ryujin-mockup-verdict-v/';
// mockup_id becomes a Blob path segment, so it must be path-safe.
const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const VALID_VERDICTS = new Set(['approved', 'disapproved', 'rejected', 'pending']);
const MAX_NOTE = 2000;

function bad(res, code, msg, extra = {}) {
  return res.status(code).json({ error: msg, ...extra });
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

function verdictKey(tenantId, mockupId) {
  return `${PREFIX}${tenantId}/${mockupId}.json`;
}

async function fetchBlobJson(url) {
  const resp = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!resp.ok) throw new Error(`blob fetch HTTP ${resp.status}`);
  return await resp.json();
}

async function handleList(req, res) {
  const { blobs } = await list({ prefix: `${PREFIX}${req.tenant.id}/`, limit: 1000 });
  const verdicts = [];
  for (const b of blobs) {
    try { verdicts.push(await fetchBlobJson(b.url)); } catch { /* skip a corrupt verdict */ }
  }
  return res.status(200).json({ verdicts });
}

async function handleUpsert(req, res) {
  const b = parseBody(req);
  const mockup_id = String(b.mockup_id || '').trim();
  const verdict = String(b.verdict || '').trim().toLowerCase();
  const note = String(b.note || '').trim().slice(0, MAX_NOTE);
  if (!mockup_id) return bad(res, 400, 'mockup_id_required');
  if (!SAFE_ID.test(mockup_id)) return bad(res, 400, 'mockup_id_invalid');
  if (!VALID_VERDICTS.has(verdict)) {
    return bad(res, 400, 'verdict_invalid', { allowed: [...VALID_VERDICTS] });
  }

  const key = verdictKey(req.tenant.id, mockup_id);
  const now = new Date().toISOString();
  // Preserve first-decided timestamp across re-decisions.
  let decided_first_at = now;
  try {
    const { blobs } = await list({ prefix: key, limit: 1 });
    if (blobs.length) {
      const prior = await fetchBlobJson(blobs[0].url);
      if (prior && prior.decided_first_at) decided_first_at = prior.decided_first_at;
    }
  } catch { /* treat as first decision on any read failure */ }

  const by = req.session && (req.session.name || req.session.email) ? (req.session.name || req.session.email) : 'admin';
  const row = { mockup_id, verdict, note, decided_by: String(by).slice(0, 64), decided_first_at, updated_at: now };
  await put(key, JSON.stringify(row), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
  return res.status(200).json({ ok: true, verdict: row });
}

async function handleDelete(req, res) {
  const mockup = String(req.query?.mockup || '').trim();
  if (!mockup) return bad(res, 400, 'mockup_required');
  if (!SAFE_ID.test(mockup)) return bad(res, 400, 'mockup_id_invalid');
  const key = verdictKey(req.tenant.id, mockup);
  const { blobs } = await list({ prefix: key, limit: 1 });
  if (blobs.length) await del(blobs[0].url);
  return res.status(200).json({ ok: true });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return handleList(req, res);
  if (req.method === 'POST') return handleUpsert(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);
  res.setHeader('Allow', 'GET, POST, DELETE');
  return bad(res, 405, 'method_not_allowed');
}

export default requirePortalSessionAndTenant(handler);
