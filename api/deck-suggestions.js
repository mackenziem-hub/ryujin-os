// Ryujin OS · Deck Suggestions (cross-machine sticky-note store for the deck)
//
// GET    /api/deck-suggestions?deck=<deckId>                 -> list suggestions for a deck
// POST   /api/deck-suggestions                               -> upsert one suggestion
//                                                              { deck_id, slide_id, client_note_id, author, text }
// DELETE /api/deck-suggestions?deck=<deckId>&note=<clientId> -> delete one suggestion
//
// WHY THIS EXISTS (WS-6): public/scripts/presentation.js already syncs notes to
// the Supabase-backed /api/deck-notes, but that route is portal-session-only and
// nothing outside the deck reads the deck_notes table. The fleet (Operator /
// Oracle / desks) authenticates with the service token, not a portal session, so
// Mac's in-deck review comments were unreadable from any other machine. This
// route mirrors the /api/fleet coordination-bus Blob pattern (PR #434): a Vercel
// Blob channel with its own isolated prefix, readable cross-machine by the same
// service token the fleet already uses to read /api/fleet. presentation.js writes
// here in addition to /api/deck-notes; the fleet reads here.
//
// Auth: requirePortalSessionAndTenant wraps the handler. That resolves a real
// owner/admin portal login (the deck in Mac's signed-in browser) AND the service
// token + x-tenant-id (the fleet from another machine) to a session, and binds
// the tenant authoritatively from that session. Reads and writes both require a
// valid session and are tenant-scoped; this mirrors /api/deck-notes exactly (any
// tenant session may write its deck's notes). Tenant binding is the security
// boundary: a session can never touch another tenant's blobs.
//
// Storage: Vercel Blob, prefix ryujin-deck-suggest-v/<tenantId>/<deckId>/, one
// deterministic blob per note keyed by client_note_id so an upsert rewrites the
// same key without an index lookup (mirrors the orders channel in api/fleet.js).
// No migration needed (the deck_notes table needs one; Blob does not).

import { put, list, del } from '@vercel/blob';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

const PREFIX = 'ryujin-deck-suggest-v/';
// deck_id / slide_id / client_note_id all become Blob path segments, so they
// must be path-safe. The deck mints note ids as n_<base36>_<rand> or a uuid, and
// deck ids from a filename slug, so this charset covers real input while
// rejecting anything that could escape the prefix.
const SAFE_SEGMENT = /^[A-Za-z0-9._:-]{1,160}$/;
const MAX_TEXT = 8000;

function bad(res, code, msg, extra = {}) {
  return res.status(code).json({ error: msg, ...extra });
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

function noteKey(tenantId, deckId, clientNoteId) {
  return `${PREFIX}${tenantId}/${deckId}/${clientNoteId}.json`;
}

async function fetchBlobJson(url) {
  // Cache-bust + no-store: list() is API-backed and fresh, but the blob URL is
  // CDN-fronted, so a stale read is possible without this on a just-written key.
  const resp = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!resp.ok) throw new Error(`blob fetch HTTP ${resp.status}`);
  return await resp.json();
}

async function handleList(req, res) {
  const deck = String(req.query?.deck || '').trim();
  if (!deck) return bad(res, 400, 'deck_required');
  if (!SAFE_SEGMENT.test(deck)) return bad(res, 400, 'deck_invalid');
  const { blobs } = await list({ prefix: `${PREFIX}${req.tenant.id}/${deck}/`, limit: 1000 });
  const notes = [];
  for (const b of blobs) {
    try { notes.push(await fetchBlobJson(b.url)); } catch { /* skip a corrupt note */ }
  }
  // Match /api/deck-notes ordering so the presentation.js merge logic is identical.
  notes.sort((a, b2) => String(a.created_at || '').localeCompare(String(b2.created_at || '')));
  return res.status(200).json({ notes });
}

async function handleUpsert(req, res) {
  const b = parseBody(req);
  const deck_id = String(b.deck_id || '').trim();
  const slide_id = String(b.slide_id || '').trim();
  const client_note_id = String(b.client_note_id || '').trim();
  const text = String(b.text || '').trim().slice(0, MAX_TEXT);
  const author = (String(b.author || 'mac').trim().slice(0, 32)) || 'mac';
  if (!deck_id || !slide_id || !client_note_id) return bad(res, 400, 'deck_slide_note_required');
  if (!SAFE_SEGMENT.test(deck_id) || !SAFE_SEGMENT.test(slide_id) || !SAFE_SEGMENT.test(client_note_id)) {
    return bad(res, 400, 'id_invalid');
  }
  if (!text) return bad(res, 400, 'text_required');

  const key = noteKey(req.tenant.id, deck_id, client_note_id);
  const now = new Date().toISOString();
  // Preserve created_at across edits; a missing prior blob means a fresh note.
  let created_at = now;
  try {
    const { blobs } = await list({ prefix: key, limit: 1 });
    if (blobs.length) {
      const prior = await fetchBlobJson(blobs[0].url);
      if (prior && prior.created_at) created_at = prior.created_at;
    }
  } catch { /* treat as new on any read failure */ }

  const note = { deck_id, slide_id, client_note_id, author, text, created_at, updated_at: now };
  await put(key, JSON.stringify(note), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
  return res.status(200).json({ ok: true, note });
}

async function handleDelete(req, res) {
  const deck = String(req.query?.deck || '').trim();
  const note = String(req.query?.note || '').trim();
  if (!deck || !note) return bad(res, 400, 'deck_and_note_required');
  if (!SAFE_SEGMENT.test(deck) || !SAFE_SEGMENT.test(note)) return bad(res, 400, 'id_invalid');
  const key = noteKey(req.tenant.id, deck, note);
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
