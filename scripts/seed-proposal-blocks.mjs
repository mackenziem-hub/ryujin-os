// Ryujin OS - Seed the Sections content library (proposal_blocks) for Plus Ultra.
//
// Populates the reusable, typed content blocks the new block-driven proposal
// renderer composes into a page. Each block carries a stable `block_key`, a
// `block_type` (must match the migration_089 enum), an `audience`, and a typed
// `content` jsonb shape the renderer reads.
//
// All customer copy below is lifted VERBATIM from the live shipped proposal:
//   - api/proposal.js  (TIER_CATALOG, TESTIMONIALS, REVIEW_STATS, CERTIFICATIONS,
//                       REPS bios, buildScopeLineItems)
//   - public/proposal-client.html  (WHY_CARDS stat cards, "Plus Ultra vs typical
//                       roofer" comparison rows, guarantee / SureStart copy)
//
// RUN (later, by a human - do NOT run as part of authoring):
//   node --env-file=.env.local scripts/seed-proposal-blocks.mjs
// Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in the env-file.
//
// Idempotent: upserts on (tenant_id, block_key), so it is safe to re-run.

import { createClient } from '@supabase/supabase-js';

// ── env (read via process.env so --env-file populates it; .trim() per the
//    Vercel trailing-newline bug we hit repeatedly) ──
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Run with --env-file=.env.local');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const BRAND_BASE = '/brand/plus-ultra';

// ─────────────────────────────────────────────────────────────
// VERBATIM COPY (lifted from the live proposal - do not paraphrase)
// ─────────────────────────────────────────────────────────────

// TIER_CATALOG from api/proposal.js
const TIER_CATALOG = {
  gold: {
    tag: 'GOOD', name: 'Gold · Landmark',
    desc: 'CertainTeed Landmark architectural shingle. The industry standard.',
    perks: [
      'CertainTeed Landmark shingles',
      'Lifetime limited manufacturer warranty',
      '10-yr SureStart™ full coverage (certified installer)',
      '15-yr Plus Ultra workmanship warranty',
      'Full tear-off + synthetic underlayment',
      'Ice & water shield at eaves + valleys',
      'Drip edge, pipe boots, step flashing'
    ]
  },
  platinum: {
    tag: 'BETTER', name: 'Platinum · Landmark Pro',
    desc: 'CertainTeed Landmark Pro with Max Def color, Grace ice shield, Roof Runner synthetic upgrade.',
    perks: [
      'CertainTeed Landmark Pro (Max Def) shingles',
      'Lifetime limited manufacturer warranty',
      '10-yr SureStart™ full coverage (certified installer)',
      '20-yr Plus Ultra workmanship warranty',
      'Grace ice & water shield upgrade',
      'Roof Runner synthetic underlayment upgrade',
      'Drip edge, pipe boots, step flashing'
    ]
  },
  diamond: {
    tag: 'BEST', name: 'Diamond · Grand Manor',
    desc: 'CertainTeed Grand Manor — Super Shangle 5-layer construction with authentic slate profile.',
    perks: [
      'CertainTeed Grand Manor designer shingles',
      'Super Shangle® 5-layer construction',
      'Streakfighter® algae protection',
      'Lifetime limited manufacturer warranty',
      '10-yr SureStart™ full coverage (certified installer)',
      '25-yr Plus Ultra workmanship warranty',
      'Grace ice & water shield + Roof Runner synthetic',
      'Priority scheduling'
    ]
  }
};

// TESTIMONIALS + REVIEW_STATS from api/proposal.js
const TESTIMONIALS = [
  {
    name: 'Norm Clark',
    city: 'Moncton, NB',
    rating: 5,
    quote: 'Amazing all around experience. From how quickly I received an estimate for a new roof, to getting the work done quickly and at a great price! Highly recommend Mackenzie and his crew!',
    source: 'Google',
    date: '2025-07'
  },
  {
    name: 'Rick Porter',
    city: 'Riverview, NB',
    rating: 5,
    quote: 'Having Plus Ultra Roofing re-shingle our roof was a great decision. The finished roof looks amazing! It was a pleasure working with both Mackenzie (owner), AJ and the rest of their crew. Thank you for a job well done!',
    source: 'Google',
    date: '2025'
  },
  {
    name: 'Verified homeowner',
    city: 'Moncton, NB',
    rating: 5,
    quote: "Easy to deal with, professional, good communication. I wasn't home when they did the majority of the roof but my neighbors said they were very hard workers! Roof looks great and we have had a lot of compliments!",
    source: 'Google',
    date: '2025'
  }
];

const REVIEW_STATS = {
  averageRating: 5.0,
  totalReviews: 35,
  source: 'Google',
  asOf: '2025-09-12',
  screenshot: `${BRAND_BASE}/google-reviews-screenshot.jpg`
};

// CERTIFICATIONS from api/proposal.js
const CERTIFICATIONS = [
  { label: 'CertainTeed ShingleMaster™', image: `${BRAND_BASE}/cert-shinglemaster.webp` },
  { label: 'CompanyCam Verified', image: `${BRAND_BASE}/cert-companycam.png` }
];

// REPS from api/proposal.js (mackenzie default rep for the intro letter)
const MACKENZIE = {
  name: 'Mackenzie Mazerolle',
  title: 'Owner · Plus Ultra Roofing',
  initials: 'MM',
  phone: '(506) 540-1052',
  email: 'mackenzie.m@plusultraroofing.com',
  photo: `${BRAND_BASE}/rep-mackenzie.png`,
  bio: "Mackenzie is the owner of Plus Ultra Roofing — a third-generation roofing company serving Greater Moncton and beyond. He grew up on job sites, runs the crews hands-on, and signs his own name to every proposal he writes. Tech-forward, certification-backed, and committed to doing every job the way he'd want it done on his own home."
};

// WHY_CARDS stat cards from public/proposal-client.html
const WHY_CARDS = [
  { stat: '20+ yrs',  label: 'Trades experience' },
  { stat: '5.0★',   label: '35+ Google reviews' },
  { stat: '50–100+', label: 'Photos per job via Company Cam' },
  { stat: '$2M',      label: 'Liability insured + WCB covered' }
];

// "Plus Ultra vs typical roofer" comparison rows from public/proposal-client.html
const COMPARISON_ROWS = [
  { label: 'Full tear-off to deck',                              us: true, them: 'sometimes' },
  { label: 'Substrate inspection + rot replacement',            us: true, them: 'skipped' },
  { label: 'Ice & water shield on eaves + valleys',             us: true, them: 'partial' },
  { label: 'Drip edge + step + chimney flashings',              us: true, them: 'reused' },
  { label: 'Ridge vent + proper attic venting',                 us: true, them: 'ignored' },
  { label: 'CertainTeed Select ShingleMaster™ certified',  us: true, them: 'rarely' },
  { label: 'Written leak-free year-one guarantee',              us: true, them: 'verbal only' },
  { label: '$2M liability + WCB coverage',                      us: true, them: 'maybe' },
  { label: '50–100+ photos every stage (Company Cam)',     us: true, them: false },
  { label: 'Magnet sweep + full debris haul',                   us: true, them: 'limited' },
  { label: 'Internal QA checklist on every install',            us: true, them: false }
];
const COMPARISON_FOOT = 'A cheap quote saves 15–25% upfront — then costs you 3× that in early replacement, insurance claim denials, and water damage. Every row above is priced into our number as the starting point, so what you see here is what you pay.';

// Guarantee / SureStart copy from public/proposal-client.html (Transparency & Warranty)
const GUARANTEE_ITEMS = [
  {
    title: 'Photo Documentation',
    body: 'We document every stage with 50–100+ photos using Company Cam — before, during, after. You get the link to the full project album with every job.'
  },
  {
    title: 'Internal QA Checklist',
    body: 'Every install is checked against our internal quality assurance checklist before we call it done. Same process every job, no shortcuts.'
  },
  {
    title: 'Leak-Free Year One',
    body: 'If your roof leaks in the first year due to our workmanship, we fix it free. Every job comes with a written Plus Ultra workmanship warranty of 15–25 years depending on tier.'
  },
  {
    title: 'Rotten Wood, Priced Upfront',
    body: 'If we find damaged sheathing during tear-off, the first 2 sheets of replacement are included. Anything beyond is quoted at $85/sheet and approved before we proceed — no surprise change orders.'
  }
];
const GUARANTEE_CERTS = [
  '10-yr CertainTeed SureStart™ full coverage',
  'Lifetime limited manufacturer warranty',
  'Leak-free guarantee year one'
];

// Scope line items (static skeleton from buildScopeLineItems; per-estimate
// measurements are injected at render time; this block is the "always included"
// narrative the customer reads). label/value verbatim from api/proposal.js.
const SCOPE_LINE_ITEMS = [
  { label: 'Full tear-off to deck', value: 'included' },
  { label: 'Ice & water shield', value: 'eaves + valleys' },
  { label: 'Synthetic underlayment', value: 'full deck' },
  { label: 'Drip edge', value: 'included' },
  { label: 'Ridge venting', value: 'included' },
  { label: 'Valley metal', value: 'included where applicable' },
  { label: 'Pipe boots (3-inch)', value: 'included' },
  { label: 'Hip and ridge caps', value: 'included' },
  { label: 'Substrate inspection + re-nail', value: 'included' },
  { label: 'Rotten wood allowance', value: 'first 2 sheets included, then $85/sheet approved in advance' },
  { label: 'Magnetic cleanup + debris haul', value: 'included' },
  { label: '50–100+ photo documentation', value: 'every stage via Company Cam' },
  { label: 'Internal QA checklist', value: 'every install' },
  { label: 'Manufacturer warranty', value: 'Lifetime limited + 10-yr SureStart™' },
  { label: 'Plus Ultra workmanship', value: '15–25 yr + leak-free guarantee' }
];

// ─────────────────────────────────────────────────────────────
// BLOCK DEFINITIONS
//
// block_type values follow the migration_089 enum (18 values):
//   hero | intro | message | proof | portfolio | reviews | inspection |
//   guarantee | why_us | comparison | transparency | video | before_after |
//   scope | products | accept | spacer | custom_html
//
// Each `content` is a typed shape the renderer reads directly.
// audience = 'customer' for all of these (customer-facing copy).
// ─────────────────────────────────────────────────────────────

const BLOCKS = [
  // 1. HERO
  {
    block_key: 'hero',
    block_type: 'hero',
    audience: 'customer',
    title: 'Hero',
    content: {
      kicker: 'Roofing Proposal',
      heading: 'Your Roof, Priced Three Ways.',
      subheading: 'Three options, transparent pricing, and a 10-year workmanship guarantee backed by CertainTeed certification.',
      contact: { phone: '(506) 540-1052', email: 'plusultraroofing@gmail.com' }
    }
  },

  // 2. INTRO (rep letter): verbatim from proposal-client.html intro section,
  //    signed by the resolved rep (Mackenzie bio from REPS).
  {
    block_key: 'intro',
    block_type: 'intro',
    audience: 'customer',
    title: 'Introduction letter',
    content: {
      greeting: 'Hi there,',
      paragraphs: [
        'Thank you for the opportunity to quote your roof replacement. Below is a detailed breakdown of the work we propose, along with upgrade options designed to maximize the longevity and performance of your home.',
        'Every Plus Ultra install is handled by our own crew — fully trained, harnessed daily, and backed by $2M liability insurance. We document every job from start to finish and stand behind the workmanship for years after we leave the site.',
        "If you have questions as you read, reach out directly. We're here to make this easy."
      ],
      rep: {
        name: MACKENZIE.name,
        title: MACKENZIE.title,
        initials: MACKENZIE.initials,
        phone: MACKENZIE.phone,
        email: MACKENZIE.email,
        photo: MACKENZIE.photo,
        bio: MACKENZIE.bio
      }
    }
  },

  // 3. WHY_US (stat cards)
  {
    block_key: 'why_us',
    block_type: 'why_us',
    audience: 'customer',
    title: 'Why Plus Ultra (stat cards)',
    content: {
      kicker: 'Why Plus Ultra',
      heading: 'The crew, the standard, the paper trail.',
      cards: WHY_CARDS.map(c => ({ stat: c.stat, label: c.label }))
    }
  },

  // 4. REVIEWS (testimonials + review stats)
  {
    block_key: 'reviews',
    block_type: 'reviews',
    audience: 'customer',
    title: 'Reviews',
    content: {
      kicker: 'Verified Reviews',
      heading: 'What homeowners say.',
      testimonials: TESTIMONIALS,
      stats: REVIEW_STATS
    }
  },

  // 5. GUARANTEE (10-yr SureStart + workmanship)
  {
    block_key: 'guarantee',
    block_type: 'guarantee',
    audience: 'customer',
    title: 'Transparency & Warranty',
    content: {
      kicker: 'Transparency & Warranty',
      heading: 'You see the work, not just the invoice.',
      items: GUARANTEE_ITEMS,
      certifications: GUARANTEE_CERTS,
      certBadges: CERTIFICATIONS
    }
  },

  // 6. COMPARISON (us vs typical roofer)
  {
    block_key: 'comparison',
    block_type: 'comparison',
    audience: 'customer',
    title: 'Plus Ultra vs typical roofer',
    content: {
      kicker: 'The Difference',
      heading: 'Plus Ultra vs. the typical roofer.',
      subheading: 'Why the cheap quote almost always costs more in the long run.',
      usLabel: 'Plus Ultra',
      themLabel: 'Typical Roofer',
      rows: COMPARISON_ROWS,
      foot: COMPARISON_FOOT
    }
  },

  // 7. PROOF / BEFORE_AFTER
  {
    block_key: 'proof',
    block_type: 'proof',
    audience: 'customer',
    title: 'Before / after proof',
    content: {
      kicker: 'Our Work',
      heading: 'Before. After. Drag to see.',
      subheading: 'Every Plus Ultra job starts the same way and ends looking like this.',
      beforeImage: `${BRAND_BASE}/gallery/03-crew-in-action.jpg`,
      afterImage: `${BRAND_BASE}/gallery/01-hero-lakeside-landmark.jpg`,
      disclaimer: 'Before/after reflects a past Plus Ultra install — shown to illustrate finish quality, not your home.'
    }
  },

  // 8. PORTFOLIO (gallery): GALLERY from api/proposal.js
  {
    block_key: 'portfolio',
    block_type: 'portfolio',
    audience: 'customer',
    title: 'Project gallery',
    content: {
      kicker: 'Our Work',
      heading: 'Recent Plus Ultra roofs.',
      images: [
        { img: `${BRAND_BASE}/gallery/01-hero-lakeside-landmark.jpg`, loc: 'MONCTON · ROYAL OAKS', desc: 'CertainTeed Landmark · full reroof · drone' },
        { img: `${BRAND_BASE}/gallery/02-topdown-architectural.jpg`, loc: 'MONCTON · ROYAL OAKS', desc: 'Complex architectural roof · top-down drone' },
        { img: `${BRAND_BASE}/gallery/07-valley-detail.jpg`,          loc: 'RIVERVIEW · 2025',    desc: 'Woven valley detail · architectural shingle' },
        { img: `${BRAND_BASE}/gallery/03-crew-in-action.jpg`,         loc: 'DIEPPE · 2025',       desc: 'Full tear-off · safety-harnessed crew' },
        { img: `${BRAND_BASE}/gallery/08-new-construction-2.jpg`,     loc: 'MONCTON · 2025',      desc: 'New build · crew installing deck + underlayment' },
        { img: `${BRAND_BASE}/gallery/05-new-construction.jpg`,       loc: 'RIVERVIEW · 2025',    desc: 'New-construction install' },
        { img: `${BRAND_BASE}/gallery/06-drone-completion.jpg`,       loc: 'MONCTON · 2025',      desc: 'Drone completion shot' }
      ]
    }
  },

  // 9. SCOPE (what's included)
  {
    block_key: 'scope',
    block_type: 'scope',
    audience: 'customer',
    title: "What's included",
    content: {
      kicker: "What's Included",
      heading: 'Every line item, every tier.',
      note: 'Per-estimate measurements (SQ, eaves, valleys, ridge LF) are filled in at render time from the linked estimate.',
      lineItems: SCOPE_LINE_ITEMS
    }
  },

  // 10. PRODUCTS (good/better/best tier catalog: the canonical asphalt tiers)
  {
    block_key: 'products',
    block_type: 'products',
    audience: 'customer',
    title: 'Your options (asphalt tiers)',
    content: {
      kicker: 'Your Options',
      heading: 'Pick the option that fits your home.',
      subheading: 'Same standard of work on every tier. Upgrade the materials, extend the warranty.',
      tiers: [
        { slug: 'gold',     tag: TIER_CATALOG.gold.tag,     name: TIER_CATALOG.gold.name,     desc: TIER_CATALOG.gold.desc,     perks: TIER_CATALOG.gold.perks },
        { slug: 'platinum', tag: TIER_CATALOG.platinum.tag, name: TIER_CATALOG.platinum.name, desc: TIER_CATALOG.platinum.desc, perks: TIER_CATALOG.platinum.perks },
        { slug: 'diamond',  tag: TIER_CATALOG.diamond.tag,  name: TIER_CATALOG.diamond.name,  desc: TIER_CATALOG.diamond.desc,  perks: TIER_CATALOG.diamond.perks }
      ]
    }
  },

  // 11. ACCEPT
  {
    block_key: 'accept',
    block_type: 'accept',
    audience: 'customer',
    title: 'Accept & sign',
    content: {
      lockBadge: 'PRICE LOCKED · 30 DAYS',
      heading: 'Lock in your rate.',
      body: "Sign below to lock your price for the next 30 days. We'll call within 24 hours to confirm the details and send your deposit invoice.",
      investmentLabel: 'Your Investment'
    }
  }
];

// ─────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────
async function main() {
  // Resolve the Plus Ultra tenant_id by slug, never hardcode a uuid.
  const { data: tenant, error: tErr } = await sb
    .from('tenants')
    .select('id')
    .eq('slug', 'plus-ultra')
    .single();
  if (tErr || !tenant) {
    console.error('Could not resolve tenant slug "plus-ultra":', tErr?.message || 'not found');
    process.exit(1);
  }
  const tenantId = tenant.id;
  console.log(`Plus Ultra tenant_id = ${tenantId}`);

  const rows = BLOCKS.map(b => ({
    tenant_id: tenantId,
    block_key: b.block_key,
    block_type: b.block_type,
    audience: b.audience,
    name: b.title,
    content: b.content
  }));

  const { data, error } = await sb
    .from('proposal_blocks')
    .upsert(rows, { onConflict: 'tenant_id,block_key' })
    .select('block_key, block_type');
  if (error) {
    console.error('Upsert failed:', error.message);
    process.exit(1);
  }

  console.log(`Seeded ${data.length} proposal_blocks:`);
  for (const r of data) console.log(`  ✓ ${r.block_key} (${r.block_type})`);
}

main().catch(e => { console.error(e); process.exit(1); });
