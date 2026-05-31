// Ryujin OS · Internal Deck server (god-level, tenant-scoped gated document tool)
//
// GET /api/internal-deck?slug=<slug>  ->  returns the HTML of api/_decks/deck-<slug>.html
//
// These decks hold confidential content (customer names, addresses, financials)
// and must NEVER be statically fetchable. The files live under api/ (the
// functions directory, which Vercel never serves as static), so there is no
// deployment path that returns them directly.
//
// Gating is two-layer:
//   1. requireOwnerOrAdmin  -> must be a logged-in owner/admin session.
//   2. tenant scope         -> the session's tenant must own the requested deck
//      (DECK_OWNER registry). Stops an owner/admin of tenant B from reading
//      tenant A's confidential deck. The registry doubles as the slug whitelist.
//
// The viewer is public/internal-deck.html, a PII-free shell that reads the
// ryujin_token from localStorage and fetches this endpoint with it.
//
// vercel.json bundles the deck files into this function via
// functions["api/internal-deck.js"].includeFiles = "api/_decks/**".

import fs from 'fs';
import path from 'path';
import { requireOwnerOrAdmin } from '../lib/auth-server.js';
import { supabaseAdmin } from '../lib/supabase.js';

// slug -> owning tenant slug. Whitelist + tenant scope in one map.
const DECK_OWNER = {
  'q2-numbers': 'plus-ultra',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Layer 1: god-level gate. Sends 401 (no/expired session) or 403 (not owner/admin) itself.
  const auth = await requireOwnerOrAdmin(req, res);
  if (!auth) return;

  const slug = String(req.query?.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'bad_slug' });
  }

  // Whitelist: unknown slugs 404 (never touch the filesystem with them).
  const ownerSlug = DECK_OWNER[slug];
  if (!ownerSlug) return res.status(404).json({ error: 'not_found' });

  // Layer 2: tenant scope. Only an owner/admin of the deck's tenant may read it.
  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('id').eq('slug', ownerSlug).maybeSingle();
  if (!tenant || tenant.id !== auth.tenant_id) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const file = path.join(process.cwd(), 'api', '_decks', `deck-${slug}.html`);
  let html;
  try {
    html = fs.readFileSync(file, 'utf8');
  } catch {
    return res.status(404).json({ error: 'not_found' });
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(200).send(html);
}
