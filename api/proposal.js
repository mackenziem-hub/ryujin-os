// Ryujin OS — Public Proposal Data
// GET /api/proposal?share=<share_token>
// Returns the shape proposal-client.html expects. Public (no auth): share tokens are
// the auth. Tracks view count and last_viewed_at on the proposals row (if present).
import { supabaseAdmin } from '../lib/supabase.js';
import { METAL_TIER_COPY, METAL_INCLUDED_ALL, isMetalSlug, getMetalCopy } from '../lib/metalProposalCopy.js';
import { calculateGutterQuote } from '../lib/gutterQuoteEngine.js';

// Tier catalog authoritative from Plus Ultra/Sales/pricing_formula_v2.md
// Manufacturer warranties use CertainTeed published terms (lifetime limited + SureStart).
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

// May 2026 promo — Free 20-Year Extended Workmanship Warranty on Platinum.
// Auto-applies at render time for any Platinum quote whose estimate was created
// inside the window. Idempotent: skipped if the pkg already has originalTotal/promoLabel.
// Discount math = warranty_adder_per_sq × measuredSQ × tier multiplier, nearest $25.
// Mirrors feedback_warranty_as_promo_lever.md.
const MAY_PROMO = {
  // Start = May 12 2026 (the day Mac activated the promo). Pre-existing May
  // quotes (Brian #39 May 7, Shelley #62 May 11, etc.) keep their original
  // pricing — Mac's standing rule: "no edits to sent proposals." Tim #59 and
  // Fernwood #60 created May 12 12:00 UTC are the first auto-promo recipients.
  startISO: '2026-05-12T00:00:00Z',
  endISO:   '2026-06-01T00:00:00Z',
  tier: 'platinum',
  warrantyAdderPerSQ: 25,
  label: 'May Special · Free 20-Year Extended Warranty · Book by May 31'
};
// Platinum tier multipliers per pricing_formula_v2.md.
const PLATINUM_MULTIPLIERS = { local: 1.52, day_trip: 1.67, extended_stay: 1.78, out_of_town: 1.85 };
// Pitch multipliers mirror quoteEngineV3 PITCH_MULTIPLIERS. Used as a fallback
// when calculated_packages.summary.measuredSQ isn't persisted on the estimate.
const PITCH_MULTIPLIERS = {
  '4/12': 1.054, '5/12': 1.083, '6/12': 1.118, '7/12': 1.158,
  '8/12': 1.202, '9/12': 1.250, '10/12': 1.302, '11/12': 1.357,
  '12/12': 1.414, '13/12': 1.474, '14/12': 1.537, 'flat': 1.00
};

function pricingModelKey(est) {
  const m = String(est?.pricing_model || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (m.includes('day')) return 'day_trip';
  if (m.includes('extended')) return 'extended_stay';
  if (m.includes('out')) return 'out_of_town';
  return 'local';
}

function deriveMeasuredSQ(est, pkg) {
  const summary = pkg && pkg.summary;
  if (summary && Number(summary.measuredSQ) > 0) return Number(summary.measuredSQ);
  const sqft = Number(est?.roof_area_sqft) || 0;
  if (sqft <= 0) return 0;
  const pitchMult = PITCH_MULTIPLIERS[String(est?.roof_pitch || '5/12')] || PITCH_MULTIPLIERS['5/12'];
  return Math.ceil((sqft * pitchMult) / 100);
}

function mayPromoDiscount(est, tierId, pkg) {
  if (tierId !== MAY_PROMO.tier) return 0;
  // Never retro-promo a signed/locked/accepted deal — the contract price is the price.
  if (est && (est.accepted_at || est.locked_at || est.final_accepted_total)) return 0;
  const status = String(est?.status || '').toLowerCase();
  if (status === 'signed' || status === 'accepted' || status === 'won' || status === 'closed') return 0;
  // Wall-clock gate: once we're past the promo end date, never show "Book by May 31"
  // to a customer viewing in June. Without this the gate was on estimate.created_at
  // only, so a May 31 estimate kept rendering the May banner indefinitely.
  if (new Date().toISOString() >= MAY_PROMO.endISO) return 0;
  const created = est && est.created_at;
  if (!created) return 0;
  const iso = new Date(created).toISOString();
  if (iso < MAY_PROMO.startISO || iso >= MAY_PROMO.endISO) return 0;
  if (pkg && (pkg.originalTotal || pkg.promoLabel)) return 0; // already promoted
  const measuredSQ = deriveMeasuredSQ(est, pkg);
  if (measuredSQ <= 0) return 0;
  const mult = PLATINUM_MULTIPLIERS[pricingModelKey(est)] || PLATINUM_MULTIPLIERS.local;
  const raw = MAY_PROMO.warrantyAdderPerSQ * measuredSQ * mult;
  return Math.round(raw / 25) * 25;
}

const BRAND_BASE = '/brand/plus-ultra';

const REPS = {
  mackenzie: {
    name: 'Mackenzie Mazerolle',
    title: 'Owner · Plus Ultra Roofing',
    initials: 'MM',
    phone: '(506) 540-1052',
    email: 'mackenzie.m@plusultraroofing.com',
    photo: `${BRAND_BASE}/rep-mackenzie.png`,
    introVideo: 'https://d2ol7oe51mr4n9.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/fadc0f07-4a08-4d99-971d-a72946a79b0a.mp4',
    introVideos: {
      shingle: 'https://d2ol7oe51mr4n9.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/fadc0f07-4a08-4d99-971d-a72946a79b0a.mp4'
    },
    bio: "Mackenzie is the owner of Plus Ultra Roofing — a third-generation roofing company serving Greater Moncton and beyond. He grew up on job sites, runs the crews hands-on, and signs his own name to every proposal he writes. Tech-forward, certification-backed, and committed to doing every job the way he'd want it done on his own home."
  },
  darcy: {
    name: 'Darcy Mazerolle',
    title: 'Outside Sales · Plus Ultra Roofing',
    initials: 'DM',
    phone: '(506) 232-2272',
    email: 'plusultraroofinginfo@gmail.com',
    photo: `${BRAND_BASE}/rep-darcy.jpg`,
    introVideo: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/69c29e439728a19e9eb265cd.mp4',
    introVideos: {
      shingle: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/69c29e439728a19e9eb265cd.mp4'
    },
    bio: "Darcy has been in the trades for over 20 years, helping homeowners plan and price the right roof for their home. He's part of the Plus Ultra Roofing family and is here to give expert advice on any and all of your roofing needs. All you have to do is ask."
  }
};

const CERTIFICATIONS = [
  { label: 'CertainTeed ShingleMaster™', image: `${BRAND_BASE}/cert-shinglemaster.webp` },
  { label: 'CompanyCam Verified', image: `${BRAND_BASE}/cert-companycam.png` }
  // Trade-association accreditation row removed 2026-05-09; restore via claims library.
];

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
    quote: 'Easy to deal with, professional, good communication. I wasn\'t home when they did the majority of the roof but my neighbors said they were very hard workers! Roof looks great and we have had a lot of compliments!',
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

const GALLERY = [
  { img: `${BRAND_BASE}/gallery/01-hero-lakeside-landmark.jpg`, loc: 'MONCTON · ROYAL OAKS', desc: 'CertainTeed Landmark · full reroof · drone' },
  { img: `${BRAND_BASE}/gallery/02-topdown-architectural.jpg`, loc: 'MONCTON · ROYAL OAKS', desc: 'Complex architectural roof · top-down drone' },
  { img: `${BRAND_BASE}/gallery/07-valley-detail.jpg`,          loc: 'RIVERVIEW · 2025',    desc: 'Woven valley detail · architectural shingle' },
  { img: `${BRAND_BASE}/gallery/03-crew-in-action.jpg`,         loc: 'DIEPPE · 2025',       desc: 'Full tear-off · safety-harnessed crew' },
  { img: `${BRAND_BASE}/gallery/08-new-construction-2.jpg`,     loc: 'MONCTON · 2025',      desc: 'New build · crew installing deck + underlayment' },
  { img: `${BRAND_BASE}/gallery/05-new-construction.jpg`,       loc: 'RIVERVIEW · 2025',    desc: 'New-construction install' },
  { img: `${BRAND_BASE}/gallery/06-drone-completion.jpg`,       loc: 'MONCTON · 2025',      desc: 'Drone completion shot' }
];

const PU_DEFAULT_MEDIA = {
  beforeImage: `${BRAND_BASE}/gallery/03-crew-in-action.jpg`,
  afterImage:  `${BRAND_BASE}/gallery/04-job-complete.jpg`,
  videoCover:  `${BRAND_BASE}/gallery/01-hero-lakeside-landmark.jpg`,
  videoUrl:    REPS.mackenzie.introVideo,
  gallery:     GALLERY
};

function resolveIntroVideo(rep, systemType) {
  const sys = String(systemType || 'shingle').toLowerCase();
  const key = sys.includes('metal') ? 'metal'
            : sys.includes('flat') ? 'flat'
            : sys.includes('shell') || sys.includes('exterior') ? 'exterior'
            : 'shingle';
  return (rep.introVideos && rep.introVideos[key]) || rep.introVideo || PU_DEFAULT_MEDIA.videoUrl;
}

const TENANT_BRANDING_DEFAULT = {
  companyName: 'Plus Ultra Roofing',
  phone: '(506) 540-1052',
  email: 'plusultraroofing@gmail.com',
  website: 'plusultraroofing.com',
  address: '6 McDowell Ave, Riverview, NB',
  logoUrl: `${BRAND_BASE}/logo.png`,
  accentColor: '#22d3ee',
  tagline: 'Go Beyond. Go Plus Ultra.'
};

function buildScopeLineItems(est) {
  const sq = est.roof_area_sqft ? (est.roof_area_sqft / 100).toFixed(1) : null;
  const sel = String(est.selected_package || 'platinum').toLowerCase();
  const prod = {
    gold: 'CertainTeed Landmark',
    platinum: 'CertainTeed Landmark Pro (Max Def)',
    diamond: 'CertainTeed Grand Manor'
  }[sel] || 'CertainTeed Landmark';
  const workmanship = { gold: '15 yr', platinum: '20 yr', diamond: '25 yr' }[sel] || '15 yr';
  const iwsProd = sel === 'gold' ? 'standard' : 'Grace';
  const underlayProd = sel === 'gold' ? 'standard synthetic' : 'Roof Runner';

  const items = [
    { label: prod + ' + install', value: (sq ? sq + ' SQ' : '—') + ' · included' },
    { label: 'Full tear-off to deck', value: 'included' },
    { label: iwsProd + ' ice & water shield', value: est.eaves_lf ? (est.eaves_lf + (est.valleys_lf ? '+' + est.valleys_lf : '') + ' LF eaves+valleys') : 'included' },
    { label: underlayProd + ' underlayment', value: 'full deck' },
    { label: 'Drip edge', value: est.eaves_lf && est.rakes_lf ? (est.eaves_lf + est.rakes_lf) + ' LF' : 'included' },
    { label: 'Ridge venting', value: est.ridges_lf ? est.ridges_lf + ' LF' : 'included' },
    { label: 'Valley metal', value: est.valleys_lf ? est.valleys_lf + ' LF' : 'included where applicable' },
    { label: 'Pipe boots (3-inch)', value: est.pipes ? est.pipes + ' boots' : 'included' },
    { label: 'Hip and ridge caps', value: 'included' },
    { label: 'Substrate inspection + re-nail', value: 'included' },
  ];
  if (est.osb_sheets) items.push({ label: 'Rotten wood allowance', value: est.osb_sheets + ' sheets (above → $85/sheet, approved in advance)' });
  items.push({ label: 'Magnetic cleanup + debris haul', value: 'included' });
  items.push({ label: '50–100+ photo documentation', value: 'every stage via Company Cam' });
  items.push({ label: 'Internal QA checklist', value: 'every install' });
  items.push({ label: 'Manufacturer warranty', value: 'Lifetime limited + 10-yr SureStart™' });
  items.push({ label: 'Plus Ultra workmanship', value: workmanship + ' + leak-free guarantee' });
  return items;
}

// Resolve the rep for a given estimate. Priority order:
//   1. A `sales_owner:<slug>` entry in est.tags (e.g. "sales_owner:mackenzie")
//      — this avoids the UUID-coupling in the sales_owner FK column and lets
//      the frontend set ownership with a plain string.
//   2. est.sales_owner_slug (if the column exists — forward-compat)
//   3. est.sales_owner looked up against the users table (future work)
//   4. Darcy as the default fallback.
function resolveRepFromEstimate(est) {
  const tags = Array.isArray(est?.tags) ? est.tags : [];
  const ownerTag = tags.find(t => typeof t === 'string' && t.toLowerCase().startsWith('sales_owner:'));
  const slugFromTag = ownerTag ? ownerTag.split(':')[1]?.trim().toLowerCase() : '';
  const slug = (slugFromTag || est?.sales_owner_slug || '').toLowerCase();

  // Accept multiple slug forms for Mac: mac / mack / mackenzie / mackenziem
  const isMac = s => /^(mac|mack|mackenzie)/.test(s) || s.includes('mackenzie') || s.includes('mazerolle');
  if (isMac(slug)) return REPS.mackenzie;
  if (slug.includes('darcy')) return REPS.darcy;

  // Legacy path — very occasionally sales_owner is a human name string not a UUID
  const legacyKey = String(est?.sales_owner || '').toLowerCase().trim();
  if (isMac(legacyKey)) return REPS.mackenzie;
  if (legacyKey.includes('darcy')) return REPS.darcy;

  return REPS.darcy;
}

// True when the tenant has opted the v2 proposal renderer on.
async function resolveV2Enabled(tenantId) {
  try {
    const { data } = await supabaseAdmin
      .from('tenant_settings')
      .select('proposal_v2_enabled')
      .eq('tenant_id', tenantId)
      .single();
    return data?.proposal_v2_enabled === true;
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const share = String(req.query.share || '').trim();
  const legacyId = String(req.query.id || '').trim();

  // Legacy Estimator OS proposals — pre-Ryujin estimates that were sent with
  // URLs of the form /api/proposal?id=<int>. The data lives in the Estimator
  // OS Replit app, not Ryujin. Browsers get redirected to proposal-client.html
  // (which then calls back here with Accept: application/json for the JSON).
  if (legacyId && !share) {
    const wantsHtml = String(req.headers.accept || '').toLowerCase().includes('text/html');
    if (wantsHtml) {
      return res.redirect(302, `/proposal-client.html?id=${encodeURIComponent(legacyId)}`);
    }
    return renderLegacyEstimatorOs(legacyId, req, res);
  }

  if (!share) return res.status(400).json({ error: 'Missing ?share=<token>' });

  const { data: est, error } = await supabaseAdmin
    .from('estimates')
    .select('*, customer:customers(*), photos:estimate_photos(*), proposal:proposals(*)')
    .eq('share_token', share)
    .single();
  if (error || !est) return res.status(404).json({ error: 'Proposal not found' });

  // ── Gutters Only branch ──
  // Browsers (Accept: text/html) get redirected to /gutter-proposal.html which
  // calls back here with Accept: application/json for the data payload.
  if (est.proposal_mode === 'Gutters Only') {
    const wantsHtml = String(req.headers.accept || '').toLowerCase().includes('text/html');
    if (wantsHtml) {
      return res.redirect(302, `/gutter-proposal.html?share=${encodeURIComponent(share)}`);
    }
    return res.json(buildGutterProposalPayload(est));
  }

  const { data: tenantSettings } = await supabaseAdmin
    .from('tenant_settings')
    .select('company_name, company_phone, company_email, company_website, logo_url, accent_color, tagline')
    .eq('tenant_id', est.tenant_id)
    .single();

  const branding = tenantSettings ? {
    companyName: tenantSettings.company_name || TENANT_BRANDING_DEFAULT.companyName,
    phone: tenantSettings.company_phone || TENANT_BRANDING_DEFAULT.phone,
    email: tenantSettings.company_email || TENANT_BRANDING_DEFAULT.email,
    website: tenantSettings.company_website || TENANT_BRANDING_DEFAULT.website,
    logoUrl: tenantSettings.logo_url || TENANT_BRANDING_DEFAULT.logoUrl,
    accentColor: tenantSettings.accent_color || TENANT_BRANDING_DEFAULT.accentColor,
    tagline: tenantSettings.tagline || TENANT_BRANDING_DEFAULT.tagline,
    address: TENANT_BRANDING_DEFAULT.address
  } : TENANT_BRANDING_DEFAULT;

  const photos = Array.isArray(est.photos) ? est.photos : [];
  const cap = p => String(p.caption || '').toLowerCase().replace(/[\s_-]+/g, '_');
  // A photo's proposal "slot" is set in the builder via the structured
  // `category` field. Prefer it; fall back to the legacy caption convention
  // (older proposals tagged before/after/metal_cover via caption) so nothing
  // regresses. 'general'/'other' are not slots.
  const norm = s => String(s || '').toLowerCase().replace(/[\s-]+/g, '_');
  const slot = p => {
    const c = norm(p.category);
    if (c && c !== 'general' && c !== 'other') return c;
    return cap(p);
  };
  const cover = photos.find(p => p.is_cover) || photos.find(p => slot(p) === 'cover') || photos[0];
  const beforePhoto = photos.find(p => slot(p) === 'before');
  const afterPhoto = photos.find(p => slot(p) === 'after');
  const afterBottomPhoto = photos.find(p => slot(p) === 'after_bottom');
  // Curated section gallery (up to three hand-picked shots, in fixed order).
  const sectionPhotos = ['section1', 'section2', 'section3']
    .map(s => photos.find(p => slot(p) === s))
    .filter(Boolean);
  // Metal proposal gets its own hero photo when the customer's home is shown
  // with metal installed. Falls back to the asphalt cover otherwise.
  const metalCoverPhoto = photos.find(p => cap(p) === 'metal_cover' || cap(p) === 'metal_after');
  // Every photo that occupies a named slot is excluded from the loose gallery
  // so it never double-shows.
  const SLOT_ROLES = new Set(['before', 'after', 'after_bottom', 'metal_after', 'metal_cover', 'cover', 'section1', 'section2', 'section3', 'inspection']);
  const customGallery = photos
    .filter(p => !p.is_cover && !SLOT_ROLES.has(slot(p)))
    .map(p => ({
      loc: (branding.companyName || 'Plus Ultra Roofing').toUpperCase(),
      desc: p.caption || 'Project photo',
      img: p.url
    }));
  // Null-safe curated slot map consumed by the envelope proposal to render a
  // hand-picked photo layout (cover hero + before/after + section gallery +
  // closing after shot) instead of the auto-swapping config preview. Each
  // value is null/empty when the slot isn't assigned, so nothing renders unless
  // it was assigned in the builder.
  // Strict cover: only an explicitly-assigned cover (is_cover or category=cover),
  // NOT the photos[0] fallback. Drives the envelope hero + signals "curated" so
  // the seeded mockup cover/preview/diagrams are cut once Mac picks a cover.
  const curatedCover = photos.find(p => p.is_cover) || photos.find(p => slot(p) === 'cover') || null;
  const curatedMedia = {
    cover: curatedCover?.url || null,
    // Any real uploaded cover (incl. the photos[0] fallback). Lets the envelope
    // drop the seeded mockup cover/preview as soon as the estimate has its own
    // photos, without requiring every slot to be tagged first.
    realCover: photos.length ? (cover?.url || null) : null,
    before: beforePhoto?.url || null,
    after: afterPhoto?.url || null,
    afterBottom: afterBottomPhoto?.url || null,
    sections: sectionPhotos.map(p => ({ img: p.url, desc: p.caption || '' }))
  };

  // ?internal=1 surfaces SOP profit + real-cash-net diagnostics for Mac. Public
  // share URLs only see clean retail prices. The SOP says "multiplier IS the
  // price, no auto-bump" — so we trust calculated_packages.summary.sellingPrice
  // exactly, no filtering, no bumping. (Stripped Apr 27 per Phase 1B/1C.)
  const isInternal = String(req.query.internal || '').toLowerCase() === '1';

  const packages = est.calculated_packages || {};
  const tierEntries = Object.entries(packages)
    .filter(([id]) => TIER_CATALOG[id])
    .map(([id, pkg]) => {
      const meta = TIER_CATALOG[id];
      // Split name on the separator so the card renders "Gold" as primary
      // and "Landmark" as the smaller sub-line instead of stacking them.
      const [primary, ...rest] = (meta.name || id).split(/\s*·\s*/);
      const sub = rest.join(' · ');
      const summary = pkg.summary || {};
      // Per-estimate warranty override: if calculated_packages[tier].warranty_years
      // is set, swap the matching "X-yr Plus Ultra workmanship warranty" perk so
      // the customer-facing card reflects the negotiated/custom term. Falls back
      // to TIER_CATALOG default when not overridden.
      let perks = meta.perks;
      const warrantyOverride = pkg.warranty_years;
      if (warrantyOverride) {
        perks = perks.map(p => /\d+\s*-?\s*yr\s+Plus Ultra workmanship warranty/i.test(p)
          ? `${warrantyOverride}-yr Plus Ultra workmanship warranty`
          : p);
      }

      // May 2026 free-warranty auto-promo (Platinum only). Mirrors the
      // Shelley Hope LEGACY_OVERRIDES pattern but evaluated at render time so
      // every May-created Platinum quote auto-shows the strikethrough.
      let total = pkg.total ?? summary.sellingPrice ?? 0;
      let originalTotal = pkg.originalTotal ?? null;
      let promoLabel = pkg.promoLabel ?? null;
      const promoDiscount = mayPromoDiscount(est, id, pkg);
      if (promoDiscount > 0 && promoDiscount < total) {
        originalTotal = total;
        total = total - promoDiscount;
        promoLabel = MAY_PROMO.label;
      }
      const measuredSQ = deriveMeasuredSQ(est, pkg);
      const persqResolved = pkg.persq ?? summary.pricePerSQ ?? 0;
      const persq = (promoDiscount > 0 && measuredSQ > 0)
        ? Math.round(total / measuredSQ)
        : persqResolved;

      return {
        id,
        tag: meta.tag,
        name: primary,
        sub,
        desc: meta.desc,
        total,
        originalTotal,
        promoLabel,
        persq,
        perks,
        // Per-estimate warranty_years override exposed for client-side renderScope().
        // null means "use tier default" (Gold 15 / Plat 20 / Dmd 25).
        warrantyYears: warrantyOverride ?? null,
        // ── SOP + real-cash diagnostics (internal only, never rendered to customer) ──
        sopTargetPct: summary.sopTargetPct ?? null,
        sopProfit: summary.sopProfit ?? null,
        sopNet: summary.sopNet ?? null,
        sopNetPerWorkday: summary.sopNetPerWorkday ?? null,
        realCashNet: summary.realCashNet ?? null,
        realCashNetPerWorkday: summary.realCashNetPerWorkday ?? null,
        realCashNetMargin: summary.realCashNetMargin ?? null,
        belowBreakeven: summary.belowBreakeven ?? null,
        breakevenWarning: summary.breakevenWarning ?? null
      };
    })
    .filter(t => t.total > 0)
    .sort((a, b) => a.total - b.total);

  // Metal branch — packages keyed by metal-* slugs render through the metal renderer.
  const metalEntries = Object.entries(packages)
    .filter(([id]) => isMetalSlug(id))
    .map(([id, pkg]) => {
      const copy = getMetalCopy(id);
      if (!copy) return null;
      const summary = pkg.summary || {};
      const total = pkg.total ?? summary.sellingPrice ?? 0;
      return {
        id,
        rank: copy.rank,
        tag: copy.tag,
        name: copy.name,
        subtitle: copy.subtitle,
        warrantyYears: copy.warrantyYears,
        warrantyLabel: copy.warrantyLabel,
        bullets: copy.bullets,
        bestFit: copy.bestFit,
        total,
        persq: pkg.persq ?? summary.pricePerSQ ?? 0
      };
    })
    .filter(Boolean)
    .filter(t => t.total > 0)
    .sort((a, b) => a.total - b.total);

  // System defaulting + toggle visibility.
  //   - isMetal:        primary system on first paint (Asphalt | Metal). The toggle
  //                     defaults to whichever of asphalt/metal the estimate was *built*
  //                     in, but customers can flip freely if both are present.
  //   - hasBothSystems: surface the system toggle in the topbar.
  const selectedPkg = String(est.selected_package || '').toLowerCase();
  const proposalMode = String(est.proposal_mode || '').toLowerCase();
  const isMetal = metalEntries.length > 0 && (
    isMetalSlug(selectedPkg) ||
    proposalMode === 'metal' ||
    tierEntries.length === 0
  );
  const hasBothSystems = metalEntries.length > 0 && tierEntries.length > 0;

  const customerName = est.customer?.full_name || '';
  const customerAddress = [est.customer?.address, est.customer?.city, est.customer?.province]
    .filter(Boolean).join(', ');

  const rep = resolveRepFromEstimate(est);

  // v2 routing bridge: when the tenant has the v2 renderer enabled AND a sent v2
  // instance exists for this estimate, route the customer to the v2 proposal.
  // Legacy-safe: proposals without a sent v2 instance keep rendering here.
  let v2Redirect = null;
  try {
    if (await resolveV2Enabled(est.tenant_id)) {
      const { data: inst } = await supabaseAdmin
        .from('proposal_instances')
        .select('slug, created_at')
        .eq('estimate_id', est.id)
        .in('status', ['sent', 'viewed', 'accepted'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (inst?.slug) v2Redirect = `/p/${inst.slug}`;
    }
  } catch (e) { /* never block the legacy proposal on a routing lookup */ }

  const data = {
    refId: `PU-${est.estimate_number || est.id.slice(0, 8).toUpperCase()}`,
    estimateId: est.id,
    shareToken: est.share_token,
    estimateTags: Array.isArray(est.tags) ? est.tags : [],
    proposalMode: est.proposal_mode || '',
    v2Redirect,
    customer: {
      name: customerName,
      address: customerAddress,
      phone: est.customer?.phone || '',
      email: est.customer?.email || '',
      coverImage: cover?.url || PU_DEFAULT_MEDIA.afterImage
    },
    rep,
    branding,
    certifications: CERTIFICATIONS,
    testimonials: TESTIMONIALS,
    reviewStats: REVIEW_STATS,
    scope: {
      system: isMetal ? 'metal' : 'asphalt',
      recommended: est.selected_package || 'platinum',
      roofArea: est.roof_area_sqft,
      pitch: est.roof_pitch,
      eaves: est.eaves_lf, rakes: est.rakes_lf, ridges: est.ridges_lf,
      distanceKm: est.distance_km || 0,
      chimneys: est.chimneys || 0,
      soffit: est.soffit_lf, fascia: est.fascia_lf, gutter: est.gutter_lf,
      osbSheets: est.osb_sheets, remediation: est.remediation_allowance,
      measure: { sq: est.roof_area_sqft ? (est.roof_area_sqft / 100).toFixed(1) : '—' },
      lineItems: buildScopeLineItems(est)
    },
    optionalAdders: (() => {
      // Strip reserved keys (_addons, _envelope) so they don't leak as tier overrides.
      const cp = { ...(est.custom_prices || {}) };
      delete cp._addons;
      delete cp._envelope;
      return cp;
    })(),
    // Legacy add-ons (simple checkbox cart). Kept for older estimates that
    // haven't been upgraded to the envelope configurator. New estimates use
    // _envelope (below) instead.
    // Gutter Package: when est.custom_prices._gutter_inputs is set, the gutter
    // engine computes the quote inline and appends it as a toggleable addon
    // with a details dropdown showing the materials/labor/corners breakdown.
    addons: (() => {
      const base = Array.isArray(est.custom_prices?._addons) ? [...est.custom_prices._addons] : [];
      const gi = est.custom_prices?._gutter_inputs;
      if (gi && (Number(gi.lf_lower) > 0 || Number(gi.lf_upper) > 0)) {
        const gutter = calculateGutterQuote({ ...gi, distance_km: gi.distance_km ?? est.distance_km ?? 0 });
        base.push({
          slug: 'gutter-package',
          label: 'Gutter Package',
          description: `${gutter.inputs.lf_lower + gutter.inputs.lf_upper} LF of ${gutter.inputs.color} seamless aluminum gutters, supply + install, including downpipes, corners, and hardware.`,
          price: gutter.subtotal,
          details: gutter.lineItems.map(li => ({ label: li.label, cost: li.cost })),
          deposit_required: false
        });
      }
      return base;
    })(),
    // Performance Shell envelope configurator. When present, the proposal
    // client renders the full dynamic configurator (system toggle, tiered
    // roof/siding selection, trim toggles, package-name morph, savings
    // ticker, cash-discount meter) instead of (or alongside) flat tier cards.
    envelope: est.custom_prices?._envelope || null,
    // Optional per-estimate rejuvenation alternative-path callout. Renders as
    // a single card between scope and reviews when present. Strict schema:
    // { kicker?, title?, subtitle?, headline, badge?, price, description,
    //   bullets[], warranty? }. Hand-curated copy lives on the row, not the
    //   engine — this is a sales narrative tool, not a pricing path.
    rejuvSection: est.custom_prices?._rejuv_section || null,
    // Inspection photos for the linked project. Filled below before the
    // response is sent so the await stays out of the object literal.
    inspectionPhotos: [],
    gammaDeckUrl: est.custom_prices?._gamma_deck_url || null,
    gammaDeckLabel: est.custom_prices?._gamma_deck_label || 'View Visual Walkthrough',
    media: {
      ...PU_DEFAULT_MEDIA,
      beforeImage: beforePhoto?.url || PU_DEFAULT_MEDIA.beforeImage,
      // Prefer explicit afterPhoto, then the AI-rendered cover (when there is
      // a real before to pair with it), then the stock Plus Ultra fallback.
      // Only use cover as the after when we have a real before too, so the
      // slider stays coherent (no stock-crew before vs real-house after).
      afterImage: afterPhoto?.url
        || (beforePhoto && cover && cover.id !== beforePhoto.id ? cover.url : null)
        || PU_DEFAULT_MEDIA.afterImage,
      videoUrl: resolveIntroVideo(rep, est.proposal_mode || 'shingle'),
      // Commercial estimates show every inspection photo — no 8-photo cap.
      // For commercial, also skip the stock-gallery fallback (only show real on-site photos).
      gallery: (Array.isArray(est.tags) && est.tags.includes('commercial'))
        ? (customGallery.length ? customGallery : [])
        : (customGallery.length ? [...customGallery, ...GALLERY].slice(0, 8) : GALLERY),
      curated: curatedMedia
    },
    // Per pricing_formula_v2.md Section 3: multiplier IS the price. No bumping,
    // no filtering. Public and internal both show calculated_packages exactly as
    // the engine produced them. Internal additionally exposes SOP profit + real-
    // cash-net diagnostics on each tier.
    tiers: {
      asphalt: tierEntries,
      metal: metalEntries
    },
    metal: metalEntries.length > 0 ? {
      tiers: metalEntries,
      includedAll: METAL_INCLUDED_ALL,
      coverImage: metalCoverPhoto?.url || null,
      coverDefault: '/proposal-assets/metal/cover-default.jpg',
      gallery: [
        { img: '/proposal-assets/metal/gallery-1.png', caption: 'European Clay metal — terracotta finish' },
        { img: '/proposal-assets/metal/gallery-2.jpg', caption: 'Drone-documented completion' },
        { img: '/proposal-assets/metal/gallery-3.jpg', caption: 'Premium tier — full deck redeck in progress' },
        { img: '/proposal-assets/metal/gallery-4.jpg', caption: 'Crew, harnessed daily, licensed in NB' }
      ]
    } : null,
    hasBothSystems,
    internal: isInternal,
    // Internal-only audit: SOP profit per tier + breakeven flags for any custom
    // multipliers below 1.35.
    sopAudit: isInternal ? {
      totalTiers: tierEntries.length,
      belowBreakeven: tierEntries.filter(t => t.belowBreakeven === true).length,
      breakevenWarnings: tierEntries
        .filter(t => t.belowBreakeven === true)
        .map(t => ({ id: t.id, warning: t.breakevenWarning, total: t.total })),
      tiers: tierEntries.map(t => ({
        id: t.id,
        total: t.total,
        sopProfit: t.sopProfit,
        sopNetPerWorkday: t.sopNetPerWorkday,
        realCashNet: t.realCashNet,
        realCashNetMargin: t.realCashNetMargin
      }))
    } : null
  };

  // Inspection photos resolution. Surfaced only when the envelope toggles
  // inspection_photos visible. Renderer prefers annotated_url (PR #189
  // annotator output) over the raw url so marked-up versions display.
  // Sources merged in this order:
  //   1. project_files for the customer's most-recent project (annotator output)
  //   2. estimate_photos for THIS estimate (where /job.html uploads land)
  //   3. companycam_archive_photos matched by address (historical work)
  // All normalized to the same shape so the renderer doesn't branch.
  try {
    const inspComp = data.envelope?.components?.inspection_photos;
    // Two ways to surface inspection photos:
    //   1. Envelope mode with inspection_photos component visible (legacy path):
    //      unions project_files + estimate_photos + companycam_archive
    //   2. _inspection_section_visible flag on custom_prices (footer section):
    //      ONLY estimate_photos that the user uploaded for THIS estimate.
    //      No project_files (annotator surface), no CC archive (fuzzy address
    //      matches pull random neighborhood shots — Mac flagged this Jun 3 2026
    //      because his Catherine 62 Charlotte proposal surfaced 13 unrelated
    //      "62 ..." CompanyCam projects alongside her 13 real drone shots).
    //      Also strips is_cover photos and the AI-generated after-render (which
    //      lives in the B/A slider, not the inspection grid).
    const envelopeInspectionMode = !!(inspComp && !inspComp.hidden);
    const inspectionFooterVisible = est.custom_prices?._inspection_section_visible === true;
    data.inspectionFooterVisible = inspectionFooterVisible;
    const wantInspection = envelopeInspectionMode || inspectionFooterVisible;
    if (wantInspection && est.customer_id) {
      const merged = [];
      const seenIds = new Set();

      // Source 1: project_files for the customer's most-recent project.
      // Envelope mode only — the footer section doesn't pull these.
      let projectAddress = null;
      if (envelopeInspectionMode) {
        const { data: project } = await supabaseAdmin
          .from('projects')
          .select('id, address')
          .eq('tenant_id', est.tenant_id)
          .eq('customer_id', est.customer_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        projectAddress = project?.address || null;
        if (project) {
          const { data: files } = await supabaseAdmin
            .from('project_files')
            .select('id, url, annotated_url, caption, category, sort_order, uploaded_at, mime_type')
            .eq('tenant_id', est.tenant_id)
            .eq('project_id', project.id)
            .order('sort_order', { ascending: true })
            .order('uploaded_at', { ascending: false });
          for (const f of (files || [])) {
            if (!f.mime_type?.startsWith('image/')) continue;
            const id = 'pf_' + f.id;
            if (seenIds.has(id)) continue;
            seenIds.add(id);
            merged.push({
              id,
              url: f.annotated_url || f.url,
              original_url: f.url,
              has_annotations: !!f.annotated_url,
              caption: f.caption || '',
              category: f.category || 'inspection',
              source: 'project_files'
            });
          }
        }
      }

      // Source 2: estimate_photos for THIS estimate. Both paths include these.
      // For footer mode, strip is_cover (rendered in hero) and category='after'
      // (the AI-render lives in the B/A slider, not the inspection grid).
      const { data: epRows } = await supabaseAdmin
        .from('estimate_photos')
        .select('id, url, caption, category, is_cover, uploaded_at, mime_type')
        .eq('estimate_id', est.id)
        .order('uploaded_at', { ascending: false });
      for (const ep of (epRows || [])) {
        if (ep.mime_type && !ep.mime_type.startsWith('image/')) continue;
        if (inspectionFooterVisible && !envelopeInspectionMode) {
          if (ep.is_cover) continue;
          const cat = String(ep.category || '').toLowerCase();
          if (cat === 'cover' || cat === 'after' || cat === 'metal_after' || cat === 'metal_cover') continue;
        }
        const id = 'ep_' + ep.id;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        merged.push({
          id,
          url: ep.url,
          original_url: ep.url,
          has_annotations: false,
          caption: ep.caption || '',
          category: ep.category || 'inspection',
          source: 'estimate_photos'
        });
      }

      // Source 3: companycam_archive matched by property address.
      // Envelope mode only — the footer section doesn't pull these. Fuzzy
      // first-token address match is too noisy for a customer-facing footer
      // ("62 Charlotte" matches every other "62 ..." in CC).
      if (envelopeInspectionMode) {
        const addressForMatch = (projectAddress || est.customer?.address || '').trim();
        if (addressForMatch) {
          const firstToken = addressForMatch.split(/\s+/)[0];
          const { data: ccProjects } = await supabaseAdmin
            .from('companycam_archive_projects')
            .select('id, address')
            .eq('tenant_id', est.tenant_id)
            .ilike('address', `%${firstToken}%`);
          const ccIds = (ccProjects || []).map(p => p.id);
          if (ccIds.length) {
            const { data: ccPhotos } = await supabaseAdmin
              .from('companycam_archive_photos')
              .select('id, url_archived, url_source, caption, captured_at')
              .eq('tenant_id', est.tenant_id)
              .in('archive_project_id', ccIds)
              .order('captured_at', { ascending: false })
              .limit(24);
            for (const cc of (ccPhotos || [])) {
              const id = 'cc_' + cc.id;
              if (seenIds.has(id)) continue;
              seenIds.add(id);
              merged.push({
                id,
                url: cc.url_archived || cc.url_source,
                original_url: cc.url_source,
                has_annotations: false,
                caption: cc.caption || '',
                category: 'companycam',
                source: 'companycam_archive'
              });
            }
          }
        }
      }

      data.inspectionPhotos = merged;
    }
  } catch (e) {
    console.warn('[proposal] inspectionPhotos fetch failed:', e?.message);
  }

  supabaseAdmin
    .from('proposals')
    .update({ view_count: (est.proposal?.[0]?.view_count || 0) + 1, last_viewed_at: new Date().toISOString() })
    .eq('estimate_id', est.id)
    .then(() => {}, () => {});

  return res.json(data);
}

// ─────────────────────────────────────────────
// Legacy Estimator OS shim
//
// Pre-Ryujin estimates were created in the Estimator OS Replit app and their
// "view proposal" links use /api/proposal?id=<int>. The data lives in
// estimator-os.replit.app, not Ryujin. We fetch from there and translate the
// shape into what proposal-client.html consumes. Read-only — no view-count
// tracking, no acceptance flow (those pages will render with the legacy flag
// surfaced so customers can call us to confirm).
// ─────────────────────────────────────────────

const ESTIMATOR_OS_BASE = 'https://estimator-os.replit.app';

// Per-legacy-quote overrides — apply on top of the Estimator OS data.
// Used for adding before/after photos, promo discounts, etc. without modifying
// the source Estimator OS row. Keyed by Estimator OS estimate id.
const LEGACY_OVERRIDES = {
  62: {
    // Shelley Hope - 34 Wilbur St
    beforeImageUrl: 'https://oyhn4tqzifmqqj0o.public.blob.vercel-storage.com/legacy-photos/shelley-hope-62/before-2026-05-11-fqndhUg2tGTlQeRWBrvU6D36XTdrZP.png',
    afterImageUrl: 'https://oyhn4tqzifmqqj0o.public.blob.vercel-storage.com/legacy-photos/shelley-hope-62/after-2026-05-11-RQzEn04V0p8UXf4m5QHMjxomw5n2VM.jpg',
    promo: {
      tier: 'platinum',
      perSQ: 25,                           // $25/SQ discount — "Free Platinum Extended Warranty"
      label: 'Free Platinum Extended Warranty applied'
    }
  }
};

async function renderLegacyEstimatorOs(legacyId, req, res) {
  const idNum = Number(legacyId);
  if (!Number.isInteger(idNum) || idNum < 1) {
    return res.status(400).json({ error: 'Invalid legacy id' });
  }

  const apiKey = String(process.env.ESTIMATOR_KEY || '').trim();
  if (!apiKey) {
    return res.status(500).json({ error: 'ESTIMATOR_KEY not configured' });
  }

  let estOs;
  try {
    const r = await fetch(`${ESTIMATOR_OS_BASE}/api/estimates/${idNum}`, {
      headers: { 'x-api-key': apiKey }
    });
    if (r.status === 404) return res.status(404).json({ error: 'Proposal not found' });
    if (!r.ok) return res.status(502).json({ error: 'Estimator OS upstream error', status: r.status });
    estOs = await r.json();
  } catch (e) {
    return res.status(502).json({ error: 'Estimator OS fetch failed', message: String(e && e.message || e) });
  }

  return res.json(buildLegacyProposalData(estOs));
}

function legacyImageUrl(url) {
  if (!url) return '';
  const u = String(url);
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return `${ESTIMATOR_OS_BASE}${u}`;
  return u;
}

function legacyRep(salesOwner) {
  const o = String(salesOwner || '').toLowerCase();
  if (o.includes('mack')) return REPS.mackenzie;
  if (o.includes('darcy')) return REPS.darcy;
  return REPS.darcy;
}

function buildLegacyProposalData(estOs) {
  const customer = estOs.customer || {};
  const pricing = estOs.pricing || {};
  const measurements = estOs.roofMeasurements || {};
  const photos = Array.isArray(estOs.photos) ? estOs.photos : [];
  const sq = Number(measurements.roofAreaSq) || 0;
  const override = LEGACY_OVERRIDES[estOs.id] || {};

  const tierEntries = ['gold', 'platinum', 'diamond']
    .map(tierId => {
      const meta = TIER_CATALOG[tierId];
      const p = pricing[tierId];
      const baseTotal = Number(p && p.sellingPrice) || 0;
      if (!meta || baseTotal <= 0) return null;

      // Per-quote promo override (e.g., Shelley Hope's $25/SQ Platinum extended warranty deduction)
      let total = baseTotal;
      let originalTotal = null;
      let promoLabel = null;
      if (override.promo && override.promo.tier === tierId) {
        const discount = override.promo.flat
                       ?? Math.round((override.promo.perSQ || 0) * sq);
        if (discount > 0 && discount < baseTotal) {
          originalTotal = baseTotal;
          total = baseTotal - discount;
          promoLabel = override.promo.label || 'Promotion applied';
        }
      }

      const persq = sq > 0 ? Math.round(total / sq) : 0;
      const [primary, ...rest] = (meta.name || tierId).split(/\s*·\s*/);
      return {
        id: tierId,
        tag: meta.tag,
        name: primary,
        sub: rest.join(' · '),
        desc: meta.desc,
        total,
        originalTotal,
        promoLabel,
        persq,
        perks: meta.perks,
        warrantyYears: null
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.total - b.total);

  const cap = p => String(p && p.caption || '').toLowerCase().replace(/[\s_-]+/g, '_');
  const cover = photos.find(p => p && p.isCover) || photos[0];
  const beforePhoto = photos.find(p => cap(p) === 'before');
  const afterPhoto = photos.find(p => cap(p) === 'after');
  const ROLE_CAPTIONS = new Set(['before', 'after', 'metal_after', 'metal_cover', 'cover']);
  const customGallery = photos
    .filter(p => p && !p.isCover && !ROLE_CAPTIONS.has(cap(p)))
    .map(p => ({
      loc: 'PLUS ULTRA ROOFING',
      desc: p.caption || 'Project photo',
      img: legacyImageUrl(p.url)
    }));

  const rep = legacyRep(estOs.salesOwner);
  const sel = String(estOs.selectedPackage || 'platinum').toLowerCase();

  return {
    refId: `PU-${estOs.id}`,
    estimateId: `legacy-${estOs.id}`,
    shareToken: estOs.shareToken || null,
    customer: {
      name: customer.fullName || '',
      address: [customer.address, customer.city, customer.province].filter(Boolean).join(', '),
      phone: customer.phone || '',
      email: customer.email || '',
      coverImage: legacyImageUrl(cover && cover.url) || PU_DEFAULT_MEDIA.afterImage
    },
    rep,
    branding: TENANT_BRANDING_DEFAULT,
    certifications: CERTIFICATIONS,
    testimonials: TESTIMONIALS,
    reviewStats: REVIEW_STATS,
    scope: {
      system: 'asphalt',
      recommended: ['gold', 'platinum', 'diamond'].includes(sel) ? sel : 'platinum',
      roofArea: sq * 100,
      pitch: measurements.roofPitch || '',
      eaves: measurements.eavesLf || 0,
      rakes: measurements.rakesLf || 0,
      ridges: measurements.ridgeLf || 0,
      distanceKm: measurements.distanceKm || 0,
      chimneys: measurements.chimneyType && measurements.chimneyType !== 'None' ? 1 : 0,
      soffit: 0, fascia: 0, gutter: 0,
      osbSheets: 0, remediation: 0,
      measure: { sq: sq ? sq.toFixed(1) : '—' },
      lineItems: buildLegacyScopeLineItems(estOs)
    },
    optionalAdders: {},
    addons: [],
    envelope: null,
    media: {
      ...PU_DEFAULT_MEDIA,
      // Estimator OS-era estimates rarely have captioned before/after photos.
      // Resolution order: per-quote override → tagged photo → cover photo → stock fallback.
      // Cover-as-fallback keeps Darcy/customer from seeing stock Plus Ultra portfolio
      // images on a personalized pitch.
      beforeImage: override.beforeImageUrl
                 || legacyImageUrl(beforePhoto && beforePhoto.url)
                 || legacyImageUrl(cover && cover.url)
                 || PU_DEFAULT_MEDIA.beforeImage,
      afterImage: override.afterImageUrl
                 || legacyImageUrl(afterPhoto && afterPhoto.url)
                 || legacyImageUrl(cover && cover.url)
                 || PU_DEFAULT_MEDIA.afterImage,
      videoUrl: resolveIntroVideo(rep, 'shingle'),
      gallery: customGallery.length ? [...customGallery, ...GALLERY].slice(0, 8) : GALLERY
    },
    tiers: { asphalt: tierEntries, metal: [] },
    metal: null,
    hasBothSystems: false,
    internal: false,
    sopAudit: null,
    legacy: true,
    legacySource: 'estimator-os',
    legacyId: estOs.id
  };
}

function buildLegacyScopeLineItems(estOs) {
  const m = estOs.roofMeasurements || {};
  const sq = Number(m.roofAreaSq) || 0;
  const sel = String(estOs.selectedPackage || 'platinum').toLowerCase();
  const prod = {
    gold: 'CertainTeed Landmark',
    platinum: 'CertainTeed Landmark Pro (Max Def)',
    diamond: 'CertainTeed Grand Manor'
  }[sel] || 'CertainTeed Landmark';
  const workmanship = { gold: '15 yr', platinum: '20 yr', diamond: '25 yr' }[sel] || '15 yr';
  const iwsProd = sel === 'gold' ? 'standard' : 'Grace';
  const underlayProd = sel === 'gold' ? 'standard synthetic' : 'Roof Runner';
  const eaves = Number(m.eavesLf) || 0;
  const rakes = Number(m.rakesLf) || 0;
  const ridge = Number(m.ridgeLf) || 0;
  const valleys = Number(m.valleysLf) || 0;

  const items = [
    { label: prod + ' + install', value: (sq ? sq.toFixed(1) + ' SQ' : '—') + ' · included' },
    { label: 'Full tear-off to deck', value: 'included' },
    { label: iwsProd + ' ice & water shield', value: eaves ? (eaves + (valleys ? '+' + valleys : '') + ' LF eaves+valleys') : 'included' },
    { label: underlayProd + ' underlayment', value: 'full deck' },
    { label: 'Drip edge', value: (eaves || rakes) ? (eaves + rakes) + ' LF' : 'included' },
    { label: 'Ridge venting', value: ridge ? ridge + ' LF' : 'included' },
    { label: 'Valley metal', value: valleys ? valleys + ' LF' : 'included where applicable' },
    { label: 'Hip and ridge caps', value: 'included' },
    { label: 'Substrate inspection + re-nail', value: 'included' },
    { label: 'Magnetic cleanup + debris haul', value: 'included' },
    { label: '50–100+ photo documentation', value: 'every stage via Company Cam' },
    { label: 'Manufacturer warranty', value: 'Lifetime limited + 10-yr SureStart™' },
    { label: 'Plus Ultra workmanship', value: workmanship + ' + leak-free guarantee' }
  ];
  return items;
}

// ─────────────────────────────────────────────
// Gutter Proposal shape
//
// Pulls calculated_packages.gutters (set by gutter engine), customer info,
// rep, and branding into the payload that /gutter-proposal.html renders.
// Kept intentionally separate from the roof proposal shape — different
// schema, different render template.
// ─────────────────────────────────────────────
function buildGutterProposalPayload(est) {
  const pkg = est.calculated_packages?.gutters || {};
  const inputs = pkg.inputs || {};
  const customerAddress = [est.customer?.address, est.customer?.city, est.customer?.province]
    .filter(Boolean).join(', ');
  const rep = resolveRepFromEstimate(est);

  return {
    type: 'gutters',
    refId: `PU-${est.estimate_number || est.id.slice(0, 8).toUpperCase()}`,
    estimateId: est.id,
    shareToken: est.share_token,
    proposalMode: 'Gutters Only',
    customer: {
      name: est.customer?.full_name || '',
      address: customerAddress,
      phone: est.customer?.phone || '',
      email: est.customer?.email || ''
    },
    rep: {
      name: rep.name,
      title: rep.title,
      initials: rep.initials,
      phone: rep.phone,
      email: rep.email
    },
    branding: TENANT_BRANDING_DEFAULT,
    scope: {
      total_lf: (inputs.lf_lower || 0) + (inputs.lf_upper || 0),
      lf_lower: inputs.lf_lower || 0,
      lf_upper: inputs.lf_upper || 0,
      corners: inputs.corners || 0,
      drops: inputs.drops || 0,
      color: inputs.color || 'White',
      leaf_guard: !!inputs.leaf_guard,
      distance_km: inputs.distance_km ?? est.distance_km ?? 0
    },
    pricing: {
      lineItems: pkg.lineItems || [],
      subtotal: pkg.subtotal ?? 0,
      hst: pkg.hst ?? 0,
      total: pkg.total ?? 0,
      deposit_required: pkg.deposit_required === true,
      label: pkg.label || 'Gutter Package'
    },
    terms: {
      warranty: '5-year workmanship warranty on installation, sealing, and fastener integrity',
      timeline: 'Install scheduled within 7-14 days of acceptance, weather permitting',
      site_requirements: 'Power access required on site for on-the-truck gutter fabrication',
      validity: 'Pricing held for 30 days from the date of this quote'
    },
    createdAt: est.created_at
  };
}

