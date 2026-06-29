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
  'diego-account': {
    tenant: 'plus-ultra', tag: 'Operations', slides: 5,
    title: 'Diego\'s Account · What It Can and Cannot Do',
    desc: 'Field-crew access on Ryujin: how he logs in, what he can see (workorders, tasks, calendar, materials) and what he cannot (paysheets, pricing, admin).',
  },
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
  'pillar-review': {
    tenant: 'plus-ultra', tag: 'Strategy', slides: 14,
    title: 'Ryujin OS · 9 Pillars, Verified',
    desc: 'Full-platform review, every finding adversarially verified: the scoreboard, the orphan map, 28 small fixes in 6 session batches, and the 5 large bets that move market value before July.',
  },
  'ceo-design': {
    tenant: 'plus-ultra', tag: 'Strategy', slides: 16,
    title: 'Ryujin · The CEO Design and the Sell',
    desc: 'Deploy truth, the live telemetry mirror, three judged designs with a unanimous winner, the outcomes-first sell sequence, the compliance landmines, and the 5 decisions only Mac can make.',
  },
  'action-plan': {
    tenant: 'plus-ultra', tag: 'Operations', slides: 11,
    title: 'What Moves Money Right Now',
    desc: 'The highest-leverage sequence for the empty-pipeline week: 7 Tier-1 calls and the $450K quote pools, the three 5-minute sends, the 48h draft wave, the Sunday META deadline, the Ryan lock-in, the quiet in-house wind-down, and the Darcy closeout.',
  },
  'ai-layer': {
    tenant: 'plus-ultra', tag: 'Strategy', slides: 11,
    title: 'Ryujin · The AI Layer',
    desc: 'The full AI capability map, inventoried against the live code and adversarially verified: the agentic toolchain that builds Ryujin, the in-product intelligence that runs the business, and an honest live vs in-progress split across 7 domains.',
  },
  'shared-brain': {
    tenant: 'plus-ultra', tag: 'Strategy', slides: 11,
    title: 'Ryujin · One Brain, Every Machine',
    desc: 'How the cross-machine memory works and spreads across every machine and account: the Supabase spine, save and load, the per-person filter, and how Cat came online. Internal architecture, gated.',
  },
  'memory-system': {
    tenant: 'plus-ultra', tag: 'Strategy', slides: 9,
    title: 'The Memory System · Why Load Went Stale',
    desc: 'The memory and intelligence system end to end, the three silent failures that fogged the load (a brief that failed quietly, agents nothing watched, and a total blind spot for messages), the fix shipped today, and the roadmap to make messages first-class.',
  },
  'intercom': {
    tenant: 'plus-ultra', tag: 'Operations', slides: 10,
    title: 'The Intercom · Companion OS, Configured',
    desc: 'What shipped today and how the Companion intercom is wired: one event fans out the right work to the right people. The event-to-action map, the sign choreography (all 4 proposal paths incl Revive), quote-requested, the files + hooks, the fail-soft/idempotent safety design, and the supporting memory + cross-machine work.',
  },
  'ad-doctrine': {
    tenant: 'plus-ultra', tag: 'Marketing', slides: 13,
    title: 'The Ad Account · Diagnosed and Fixed',
    desc: 'The Meta deep-dive: why the cost-per-lead alarm kept crying wolf (winners paused into cold tests, plus 7-day attribution lag), the real numbers ($20 lifetime CPL, ~10x signed ROAS, $15K average job), what works (Instant Estimator + Revive statics), the six changes made today (5 cold tests to 3 lead engines), the doctrine and weekly cadence, the attribution gap, and Harmeet starting tomorrow.',
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
