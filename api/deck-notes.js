// Ryujin OS · Deck Notes (sticky-note persistence for the Ryujin Proposal Generator)
//
// GET    /api/deck-notes?deck=<deckId>                  -> list notes for a deck
// POST   /api/deck-notes                                -> upsert one note
//                                                          { deck_id, slide_id, client_note_id, author, text }
// DELETE /api/deck-notes?deck=<deckId>&note=<clientId>  -> delete one note
//
// Backed by the deck_notes table (migration 077). All routes require a portal
// session; the tenant is derived authoritatively from the session, never from
// client input. public/scripts/presentation.js only calls these when a session
// token is present, so decks still open standalone (localStorage-only) for
// unauthenticated review.

import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

const COLS = 'deck_id, slide_id, client_note_id, author, text, created_at, updated_at';

function bad(res, code, msg, extra = {}) {
  return res.status(code).json({ error: msg, ...extra });
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

async function handleList(req, res) {
  const deck = String(req.query?.deck || '').trim();
  if (!deck) return bad(res, 400, 'deck_required');
  const { data, error } = await supabaseAdmin
    .from('deck_notes')
    .select(COLS)
    .eq('tenant_id', req.tenant.id)
    .eq('deck_id', deck)
    .order('created_at', { ascending: true });
  if (error) return bad(res, 500, 'db_error', { detail: error.message });
  return res.status(200).json({ notes: data || [] });
}

async function handleUpsert(req, res) {
  const b = parseBody(req);
  const deck_id = String(b.deck_id || '').trim();
  const slide_id = String(b.slide_id || '').trim();
  const client_note_id = String(b.client_note_id || '').trim();
  const text = String(b.text || '').trim();
  const author = (String(b.author || 'mac').trim().slice(0, 32)) || 'mac';
  if (!deck_id || !slide_id || !client_note_id) return bad(res, 400, 'deck_slide_note_required');
  if (!text) return bad(res, 400, 'text_required');

  const row = {
    tenant_id: req.tenant.id,
    deck_id,
    slide_id,
    client_note_id,
    author,
    text,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabaseAdmin
    .from('deck_notes')
    .upsert(row, { onConflict: 'tenant_id,deck_id,client_note_id' })
    .select(COLS)
    .single();
  if (error) return bad(res, 500, 'upsert_failed', { detail: error.message });
  return res.status(200).json({ ok: true, note: data });
}

async function handleDelete(req, res) {
  const deck = String(req.query?.deck || '').trim();
  const note = String(req.query?.note || '').trim();
  if (!deck || !note) return bad(res, 400, 'deck_and_note_required');
  const { error } = await supabaseAdmin
    .from('deck_notes')
    .delete()
    .eq('tenant_id', req.tenant.id)
    .eq('deck_id', deck)
    .eq('client_note_id', note);
  if (error) return bad(res, 500, 'delete_failed', { detail: error.message });
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
