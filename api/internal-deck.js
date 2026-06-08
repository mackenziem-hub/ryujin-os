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
//      (DECKS registry). Stops an owner/admin of tenant B from reading
//      tenant A's confidential deck. The registry doubles as the slug whitelist.
//
// GET /api/internal-deck?list=1  ->  JSON of the decks the caller's tenant owns
// (slug, title, desc, slides). The public catalog (decks.html) calls this after
// owner login to render its "Internal" section, so confidential slugs/titles
// never live in any statically fetchable HTML.
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

// slug -> { owning tenant slug, list-card metadata }. Whitelist + tenant scope
// + the metadata the catalog's gated list returns. The HTML body itself lives in
// api/_decks/deck-<slug>.html.
const DECKS = {
  'jun9-comms': {
    tenant: 'plus-ultra', tag: 'Operations', slides: 6,
    title: 'Tue June 9 · Two Jobs · The Comms Package',
    desc: 'Tomorrow\'s crew day end to end: the crew email, the deduped portal view, the group-chat message, and the customer note for the 57 Bolton completion.',
  },
  'q2-numbers': {
    tenant: 'plus-ultra', tag: 'Finance', slides: 9,
    title: 'Q2 2026 · The Numbers',
    desc: 'Receipt-verified Q2 revenue, job by job, with the booked pipeline still to land.',
  },
  '10x-blueprint': {
    tenant: 'plus-ultra', tag: 'Strategy', slides: 18,
    title: 'The 10x Path',
    desc: 'The growth blueprint: the one binding constraint, the real numbers, Operation Revive as the spearhead, and the 30 to 60 day sequence.',
  },
  'approvals-review': {
    tenant: 'plus-ultra', tag: 'Operations', slides: 8,
    title: 'Decisions: Approval Queue',
    desc: 'The 5 decisions that actually need your call out of 25 queued actions, one per slide with options. The other 20 are duplicates or stale and clear on your nod.',
  },
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

  // Resolve the caller's tenant slug once (used for list filter + per-deck scope).
  const { data: callerTenant } = await supabaseAdmin
    .from('tenants').select('slug').eq('id', auth.tenant_id).maybeSingle();
  const callerSlug = callerTenant?.slug || null;

  // List mode: return only the decks this tenant owns. No slug ever ships in static HTML.
  if (req.query?.list) {
    const decks = Object.entries(DECKS)
      .filter(([, d]) => d.tenant === callerSlug)
      .map(([slug, d]) => ({ slug, title: d.title, desc: d.desc, slides: d.slides, tag: d.tag }));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ decks });
  }

  const slug = String(req.query?.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'bad_slug' });
  }

  // Whitelist: unknown slugs 404 (never touch the filesystem with them).
  const deck = DECKS[slug];
  if (!deck) return res.status(404).json({ error: 'not_found' });

  // Layer 2: tenant scope. Only an owner/admin of the deck's tenant may read it.
  if (deck.tenant !== callerSlug) {
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
