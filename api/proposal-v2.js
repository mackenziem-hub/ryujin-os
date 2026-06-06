// Ryujin OS - Unified Proposal Generator (data-assembly seam)
// ----------------------------------------------------------------------------
// GET /api/proposal-v2?instance=<slug|share_token>      -> FROZEN snapshot render
// GET /api/proposal-v2?estimate=<estimate_id>&template=<template_slug> -> LIVE preview
//
// Returns ONE ProposalData shape for every mode. The renderer (proposal-v2.html)
// maps section.type -> a component and reads products.mode to lay out pricing.
//
// THE CONTRACT (exact keys emitted, see notes at bottom of PR description):
//   {
//     meta:      { instanceSlug, refId, rendererVersion:'v2', status, tenantId, estimateId },
//     branding:  { companyName, phone, email, website, logoUrl, accentColor, tagline },
//     rep:       { name, title, initials, phone, email, photo, bio },
//     customer:  { name, address, phone, email, coverImage },
//     variables: { ...flattened merge fields },
//     sections:  [ { type, content } ... ]   // ORDERED; tokens resolved against variables
//     products:  {
//       mode, recommended, tiers[], addons[], twoPath, envelope, scope, taxRate, financing
//     }
//   }
//
// Tiers ALWAYS carry a PRE-TAX `total`. The renderer computes the displayed
// price = selected tier total + selected addon prices, then ×(1+taxRate), and
// rounds the DISPLAY to the nearest $25. No HST math is baked into tier totals.
//
// Branding / rep / customer / view-count all mirror api/proposal.js so the two
// renderers stay in lockstep.
// ----------------------------------------------------------------------------
import { supabaseAdmin } from '../lib/supabase.js';
import {
  normalizeCalculatedPackages,
  withHST,
  deriveMeasuredSQ,
  applyRenderPromo
} from '../lib/proposalPricing.js';
import { calculateRepairQuote } from '../lib/repairQuoteEngine.js';
import { calculateRejuvenationQuote } from '../lib/rejuvenationQuote.js';
import { calculateGutterQuote } from '../lib/gutterQuoteEngine.js';
import { isMetalSlug, getMetalCopy } from '../lib/metalProposalCopy.js';

// ── Brand + rep constants (mirror api/proposal.js verbatim) ──────────────────
const BRAND_BASE = '/brand/plus-ultra';

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

const REPS = {
  mackenzie: {
    name: 'Mackenzie Mazerolle',
    title: 'Owner · Plus Ultra Roofing',
    initials: 'MM',
    phone: '(506) 540-1052',
    email: 'mackenzie.m@plusultraroofing.com',
    photo: `${BRAND_BASE}/rep-mackenzie.png`,
    bio: "Mackenzie is the owner of Plus Ultra Roofing, a third-generation roofing company serving Greater Moncton and beyond. He grew up on job sites, runs the crews hands-on, and signs his own name to every proposal he writes. Tech-forward, certification-backed, and committed to doing every job the way he'd want it done on his own home."
  },
  darcy: {
    name: 'Darcy Mazerolle',
    title: 'Outside Sales · Plus Ultra Roofing',
    initials: 'DM',
    phone: '(506) 232-2272',
    email: 'plusultraroofinginfo@gmail.com',
    photo: `${BRAND_BASE}/rep-darcy.jpg`,
    bio: "Darcy has been in the trades for over 20 years, helping homeowners plan and price the right roof for their home. He's part of the Plus Ultra Roofing family and is here to give expert advice on any and all of your roofing needs. All you have to do is ask."
  }
};

// Canonical asphalt tier copy (mirror api/proposal.js TIER_CATALOG). The live
// preview overlays per-estimate pricing onto this copy; the seeded `products`
// block also carries it, but tiers must carry name/desc/perks so the card
// renders even when sourced purely from calculated_packages.
const TIER_CATALOG = {
  gold: {
    tag: 'GOOD', name: 'Gold · Landmark', warrantyYears: 15,
    desc: 'CertainTeed Landmark architectural shingle. The industry standard.',
    perks: [
      'CertainTeed Landmark shingles',
      'Lifetime limited manufacturer warranty',
      '10-yr SureStart full coverage (certified installer)',
      '15-yr Plus Ultra workmanship warranty',
      'Full tear-off + synthetic underlayment',
      'Ice & water shield at eaves + valleys',
      'Drip edge, pipe boots, step flashing'
    ]
  },
  platinum: {
    tag: 'BETTER', name: 'Platinum · Landmark Pro', warrantyYears: 20,
    desc: 'CertainTeed Landmark Pro with Max Def color, Grace ice shield, Roof Runner synthetic upgrade.',
    perks: [
      'CertainTeed Landmark Pro (Max Def) shingles',
      'Lifetime limited manufacturer warranty',
      '10-yr SureStart full coverage (certified installer)',
      '20-yr Plus Ultra workmanship warranty',
      'Grace ice & water shield upgrade',
      'Roof Runner synthetic underlayment upgrade',
      'Drip edge, pipe boots, step flashing'
    ]
  },
  diamond: {
    tag: 'BEST', name: 'Diamond · Grand Manor', warrantyYears: 25,
    desc: 'CertainTeed Grand Manor, Super Shangle 5-layer construction with authentic slate profile.',
    perks: [
      'CertainTeed Grand Manor designer shingles',
      'Super Shangle 5-layer construction',
      'Streakfighter algae protection',
      'Lifetime limited manufacturer warranty',
      '10-yr SureStart full coverage (certified installer)',
      '25-yr Plus Ultra workmanship warranty',
      'Grace ice & water shield + Roof Runner synthetic',
      'Priority scheduling'
    ]
  }
};

const DEFAULT_TAX_RATE = 0.15;
const DEFAULT_FINANCING = { enabled: true, termMonths: 120 };

// ── Rep resolution (verbatim port of api/proposal.js resolveRepFromEstimate) ──
function resolveRepFromEstimate(est) {
  const tags = Array.isArray(est?.tags) ? est.tags : [];
  const ownerTag = tags.find(t => typeof t === 'string' && t.toLowerCase().startsWith('sales_owner:'));
  const slugFromTag = ownerTag ? ownerTag.split(':')[1]?.trim().toLowerCase() : '';
  const slug = (slugFromTag || est?.sales_owner_slug || '').toLowerCase();

  const isMac = s => /^(mac|mack|mackenzie)/.test(s) || s.includes('mackenzie') || s.includes('mazerolle');
  if (isMac(slug)) return REPS.mackenzie;
  if (slug.includes('darcy')) return REPS.darcy;

  const legacyKey = String(est?.sales_owner || '').toLowerCase().trim();
  if (isMac(legacyKey)) return REPS.mackenzie;
  if (legacyKey.includes('darcy')) return REPS.darcy;

  return REPS.darcy;
}

// Trim a rep down to the public ProposalData.rep shape.
function repPublic(rep) {
  return {
    name: rep.name,
    title: rep.title,
    initials: rep.initials,
    phone: rep.phone,
    email: rep.email,
    photo: rep.photo,
    bio: rep.bio
  };
}

// ── Branding resolution (mirror api/proposal.js tenant_settings read) ────────
async function resolveBranding(tenantId) {
  if (!tenantId) return { ...TENANT_BRANDING_DEFAULT };
  let row = null;
  try {
    const { data } = await supabaseAdmin
      .from('tenant_settings')
      .select('company_name, company_phone, company_email, company_website, logo_url, accent_color, tagline')
      .eq('tenant_id', tenantId)
      .single();
    row = data || null;
  } catch {
    row = null;
  }
  if (!row) return { ...TENANT_BRANDING_DEFAULT };
  return {
    companyName: row.company_name || TENANT_BRANDING_DEFAULT.companyName,
    phone: row.company_phone || TENANT_BRANDING_DEFAULT.phone,
    email: row.company_email || TENANT_BRANDING_DEFAULT.email,
    website: row.company_website || TENANT_BRANDING_DEFAULT.website,
    logoUrl: row.logo_url || TENANT_BRANDING_DEFAULT.logoUrl,
    accentColor: row.accent_color || TENANT_BRANDING_DEFAULT.accentColor,
    tagline: row.tagline || TENANT_BRANDING_DEFAULT.tagline
  };
}

// Resolve the tenant HST rate. Default 0.15 (NB). tenant_settings may carry a
// tax_rate column on some tenants; degrade to the default if absent.
async function resolveTaxRate(tenantId) {
  if (!tenantId) return DEFAULT_TAX_RATE;
  try {
    const { data } = await supabaseAdmin
      .from('tenant_settings')
      .select('tax_rate')
      .eq('tenant_id', tenantId)
      .single();
    const rate = Number(data?.tax_rate);
    return rate > 0 && rate < 1 ? rate : DEFAULT_TAX_RATE;
  } catch {
    return DEFAULT_TAX_RATE;
  }
}

// ── Customer/address assembly (mirror api/proposal.js) ───────────────────────
function buildCustomer(est, coverImage) {
  const name = est?.customer?.full_name || '';
  const address = [est?.customer?.address, est?.customer?.city, est?.customer?.province]
    .filter(Boolean).join(', ');
  return {
    name,
    address,
    phone: est?.customer?.phone || '',
    email: est?.customer?.email || '',
    coverImage: coverImage || null
  };
}

// Pick a cover image off the estimate's photos using the same slot logic as
// api/proposal.js (is_cover -> category=cover -> first photo).
function pickCoverImage(est) {
  const photos = Array.isArray(est?.photos) ? est.photos : [];
  if (!photos.length) return null;
  const norm = s => String(s || '').toLowerCase().replace(/[\s-]+/g, '_');
  const slot = p => {
    const c = norm(p.category);
    if (c && c !== 'general' && c !== 'other') return c;
    return norm(p.caption);
  };
  const cover = photos.find(p => p.is_cover) || photos.find(p => slot(p) === 'cover') || photos[0];
  return cover?.url || null;
}

// ── Token resolution ─────────────────────────────────────────────────────────
// Flatten the variables map into dotted keys so {{customer.name}}, {{address}},
// {{rep.name}}, {{branding.companyName}} all resolve against one lookup table.
// A price-lock date N days out, formatted "Month D, YYYY" for the customer.
function formatLockDate(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function buildVariables({ branding, rep, customer, est, refId }) {
  const vars = {
    'customer.name': customer.name || '',
    'customer.address': customer.address || '',
    'customer.phone': customer.phone || '',
    'customer.email': customer.email || '',
    // Bare convenience aliases the seeded copy may use.
    'name': customer.name || '',
    'address': customer.address || '',
    'rep.name': rep.name || '',
    'rep.title': rep.title || '',
    'rep.phone': rep.phone || '',
    'rep.email': rep.email || '',
    'branding.companyName': branding.companyName || '',
    'branding.phone': branding.phone || '',
    'branding.email': branding.email || '',
    'branding.website': branding.website || '',
    'company': branding.companyName || '',
    'refId': refId || '',
    'date': new Date().toISOString().slice(0, 10),
    'firstName': String(customer.name || '').trim().split(/\s+/)[0] || 'there',
    'priceLockDate': formatLockDate(14)
  };
  // Surface a measured-SQ token when the estimate persisted one (never fabricated).
  const packages = (est && est.calculated_packages) || {};
  for (const pkg of Object.values(packages)) {
    const sq = deriveMeasuredSQ(est, pkg);
    if (sq > 0) { vars['measure.sq'] = String(sq); break; }
  }
  return vars;
}

// Resolve every {{token}} inside a content value against the variables map.
// Recurses through objects/arrays; leaves non-strings untouched. Unknown tokens
// resolve to '' so a missing merge field never leaks "{{...}}" to a customer.
function resolveTokens(value, vars) {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
      const v = vars[key];
      return v == null ? '' : String(v);
    });
  }
  if (Array.isArray(value)) return value.map(v => resolveTokens(v, vars));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveTokens(v, vars);
    return out;
  }
  return value;
}

// ── Tier builders ─────────────────────────────────────────────────────────────

// Split "Gold · Landmark" into { name:'Gold', sub:'Landmark' } the way the card
// renders (mirror api/proposal.js).
function splitTierName(fullName, fallbackId) {
  const [primary, ...rest] = String(fullName || fallbackId || '').split(/\s*·\s*/);
  return { name: primary, sub: rest.join(' · ') };
}

// good_better_best: normalize calculated_packages (with render promo), map to
// ProposalData tiers, filter to offer_slugs when supplied, sort by total asc.
function buildGoodBetterBestTiers(est, offerSlugs) {
  const normalized = normalizeCalculatedPackages(est?.calculated_packages || {}, {
    est,
    applyPromo: true
  });
  const slugFilter = Array.isArray(offerSlugs) && offerSlugs.length
    ? new Set(offerSlugs.map(s => String(s).toLowerCase()))
    : null;

  const tiers = [];
  for (const [id, norm] of Object.entries(normalized)) {
    if (slugFilter && !slugFilter.has(id.toLowerCase())) continue;
    if (!(norm.preTaxTotal > 0)) continue;

    const meta = TIER_CATALOG[id];
    const metalCopy = !meta ? getMetalCopy(id) : null;

    let name, sub, tag, desc, perks, warrantyYears;
    if (meta) {
      const split = splitTierName(meta.name, id);
      name = split.name; sub = split.sub;
      tag = meta.tag; desc = meta.desc;
      perks = norm.perks?.length ? norm.perks : meta.perks;
      warrantyYears = norm.warrantyYears ?? meta.warrantyYears ?? null;
      // Per-estimate warranty override: swap the matching workmanship perk.
      if (norm.warrantyYears) {
        perks = perks.map(p => /\d+\s*-?\s*yr\s+Plus Ultra workmanship warranty/i.test(p)
          ? `${norm.warrantyYears}-yr Plus Ultra workmanship warranty`
          : p);
      }
    } else if (metalCopy) {
      name = metalCopy.name; sub = metalCopy.subtitle || '';
      tag = metalCopy.tag; desc = metalCopy.bestFit || '';
      perks = norm.perks?.length ? norm.perks : (metalCopy.bullets || []);
      warrantyYears = norm.warrantyYears ?? metalCopy.warrantyYears ?? null;
    } else {
      // Unknown slug (commercial-*, custom offer), render with whatever copy
      // the package carried, no fabricated catalog text.
      const split = splitTierName(id, id);
      name = split.name; sub = split.sub;
      tag = ''; desc = '';
      perks = norm.perks || [];
      warrantyYears = norm.warrantyYears ?? null;
    }

    tiers.push({
      id,
      name,
      sub,
      tag,
      desc,
      perks,
      total: norm.preTaxTotal,          // PRE-TAX, always
      persq: norm.persq || 0,
      warrantyYears,
      originalTotal: norm.originalTotal ?? null,
      promoLabel: norm.promoLabel ?? null
    });
  }

  tiers.sort((a, b) => a.total - b.total);
  return tiers;
}

// Build a single-tier list from an engine result (repair / rejuvenation / gutters).
// engineResult is { lineItems, summary } from the repair/rejuvenation engines.
function singleTierFromEngine({ id, name, sub, tag, desc, perks, engineResult, warrantyYears = null }) {
  const summary = engineResult?.summary || {};
  const total = Number(summary.sellingPrice) || 0;   // PRE-TAX, exact
  const persq = Number(summary.pricePerSQ) || 0;
  return {
    id,
    name,
    sub: sub || '',
    tag: tag || '',
    desc: desc || '',
    perks: perks || [],
    total,
    persq,
    warrantyYears,
    originalTotal: null,
    promoLabel: null
  };
}

// Map engine lineItems -> ProposalData scope.lineItems ({label,value}).
function engineLineItemsToScope(engineResult) {
  const items = Array.isArray(engineResult?.lineItems) ? engineResult.lineItems : [];
  return items
    .filter(li => li && (li.included === undefined || li.included))
    .map(li => {
      const qty = Number(li.quantity);
      const unit = li.unit || '';
      const qtyLabel = qty > 0 && unit ? `${qty} ${unit}` : null;
      const cost = Number(li.total_cost ?? li.amount);
      const value = Number.isFinite(cost)
        ? (qtyLabel ? `${qtyLabel} · $${Math.round(cost).toLocaleString()}` : `$${Math.round(cost).toLocaleString()}`)
        : (qtyLabel || 'included');
      return { label: li.label || li.item_key || 'Line item', value };
    });
}

// Measured SQ for engines that need it (rejuvenation). Persisted-only, never
// fabricated. Walks calculated_packages for the first persisted measuredSQ, then
// the estimate's own roof_area_sqft as a last resort (footprint, not roof area,
// but the only persisted square figure when no package summary carries one).
function estimateMeasuredSQ(est) {
  const packages = (est && est.calculated_packages) || {};
  for (const pkg of Object.values(packages)) {
    const sq = deriveMeasuredSQ(est, pkg);
    if (sq > 0) return sq;
  }
  // Fall back to an explicitly persisted square count if present on the row.
  const direct = Number(est?.measured_sq) || Number(est?.roof_area_sq);
  if (direct > 0) return direct;
  return 0;
}

function estimateScopeMeasure(est) {
  const sq = estimateMeasuredSQ(est);
  return { sq: sq > 0 ? sq : null };
}

// ── Addons (legacy _addons cart + inline gutter package) ─────────────────────
function buildAddons(est) {
  const cp = est?.custom_prices || {};
  const base = Array.isArray(cp._addons) ? cp._addons.map(a => ({
    slug: a.slug || a.key || 'addon',
    label: a.label || 'Add-on',
    description: a.description || '',
    price: Number(a.price) || 0,
    details: Array.isArray(a.details) ? a.details.map(d => ({ label: d.label, cost: Number(d.cost) || 0 })) : [],
    selected: false
  })) : [];

  const gi = cp._gutter_inputs;
  if (gi && (Number(gi.lf_lower) > 0 || Number(gi.lf_upper) > 0)) {
    const gutter = calculateGutterQuote({ ...gi, distance_km: gi.distance_km ?? est.distance_km ?? 0 });
    base.push({
      slug: 'gutter-package',
      label: 'Gutter Package',
      description: `${gutter.inputs.lf_lower + gutter.inputs.lf_upper} LF of ${gutter.inputs.color || 'seamless'} aluminum gutters, supply + install, including downpipes, corners, and hardware.`,
      price: gutter.subtotal,                                // PRE-TAX subtotal
      details: gutter.lineItems.map(li => ({ label: li.label, cost: Number(li.amount) || 0 })),
      selected: false
    });
  }
  return base;
}

// ── Products assembly per product_plan.mode ──────────────────────────────────
function buildProducts({ est, productPlan, taxRate }) {
  const mode = String(productPlan?.mode || 'good_better_best').toLowerCase();
  const base = {
    mode,
    recommended: productPlan?.recommended ?? null,
    tiers: [],
    addons: buildAddons(est),
    twoPath: null,
    envelope: null,
    scope: {
      system: est?.proposal_mode || est?.system || 'asphalt',
      lineItems: [],
      measure: estimateScopeMeasure(est)
    },
    taxRate,
    financing: { ...DEFAULT_FINANCING }
  };

  if (mode === 'good_better_best') {
    base.tiers = buildGoodBetterBestTiers(est, productPlan?.offer_slugs);
    base.recommended = productPlan?.recommended
      || (base.tiers.find(t => t.id === 'platinum')?.id)
      || (base.tiers[Math.floor(base.tiers.length / 2)]?.id ?? null);
    base.scope.lineItems = scopeLineItemsFromEstimate(est);
    return base;
  }

  if (mode === 'repair') {
    const repairInput = (est?.custom_prices?._repair_inputs) || est?.repair_inputs || {};
    const result = calculateRepairQuote(repairInput);
    base.tiers = [singleTierFromEngine({
      id: 'repair',
      name: 'Roof Repair',
      sub: 'Targeted scope',
      tag: 'REPAIR',
      desc: 'A targeted repair scope priced as a single all-in number.',
      perks: [],
      engineResult: result
    })];
    base.recommended = 'repair';
    base.scope.system = 'repair';
    base.scope.lineItems = engineLineItemsToScope(result);
    return base;
  }

  if (mode === 'gutters') {
    const gi = est?.custom_prices?._gutter_inputs || {};
    const result = calculateGutterQuote({ ...gi, distance_km: gi.distance_km ?? est?.distance_km ?? 0 });
    // gutter engine emits { subtotal /*pre-tax*/, total /*incl HST*/, lineItems[{label,amount}] }.
    base.tiers = [{
      id: 'gutters',
      name: 'Seamless Gutters',
      sub: result.inputs?.color ? `${result.inputs.color} aluminum` : 'Seamless aluminum',
      tag: 'GUTTERS',
      desc: 'Seamless aluminum gutter package, supply + install.',
      perks: [],
      total: Number(result.subtotal) || 0,                 // PRE-TAX
      persq: 0,
      warrantyYears: 5,
      originalTotal: null,
      promoLabel: null
    }];
    base.recommended = 'gutters';
    base.mode = 'gutters';
    base.scope.system = 'gutters';
    base.scope.lineItems = (result.lineItems || []).map(li => ({
      label: li.label,
      value: `${li.qty} ${li.unit} · $${Math.round(li.amount).toLocaleString()}`
    }));
    base.scope.measure = { sq: null };
    return base;
  }

  if (mode === 'configurator') {
    // Pass the envelope config straight through, untouched. The renderer drives
    // the configurator math client-side; this seam just hands it the payload.
    base.envelope = est?.custom_prices?._envelope || null;
    base.mode = 'configurator';
    base.scope.system = 'exterior';
    base.scope.lineItems = scopeLineItemsFromEstimate(est);
    return base;
  }

  if (mode === 'two_path') {
    // Path B = full replacement good/better/best from calculated_packages.
    const pathBPlan = productPlan?.two_path?.pathB || {};
    const pathBTiers = buildGoodBetterBestTiers(est, pathBPlan.offer_slugs);
    const pathBRecommended = pathBPlan.recommended
      || (pathBTiers.find(t => t.id === 'platinum')?.id)
      || (pathBTiers[0]?.id ?? null);

    // Path A = single NuRoof Revive rejuvenation tier. Needs a persisted SQ;
    // when none exists the engine returns a $0 tier (never a fabricated SQ),
    // which the renderer can hide.
    const measuredSQ = estimateMeasuredSQ(est);
    const steep = est?.custom_prices?._rejuv_steep === true || est?.steep === true;
    const reviveResult = calculateRejuvenationQuote({ measuredSQ, steep });
    const pathATier = singleTierFromEngine({
      id: 'revive',
      name: 'NuRoof Revive',
      sub: 'Rejuvenation',
      tag: 'REJUVENATE',
      desc: 'Extend the life of your existing shingles with a NuRoof Revive treatment, roughly one third the cost of replacement.',
      perks: [
        'NuRoof Revive rejuvenation treatment',
        'Restores flexibility and granule adhesion',
        'No tear-off, no disruption',
        'Roughly one third the cost of full replacement'
      ],
      engineResult: reviveResult,
      warrantyYears: null
    });

    const pathAPlan = productPlan?.two_path?.pathA || {};
    base.mode = 'two_path';
    base.tiers = pathBTiers;                 // default flat list = the replacement ladder
    base.recommended = pathBRecommended;
    base.twoPath = {
      pathA: {
        label: pathAPlan.label || 'Rejuvenation',
        tiers: [pathATier],
        scope: {
          system: 'rejuvenation',
          lineItems: engineLineItemsToScope(reviveResult),
          measure: { sq: measuredSQ > 0 ? measuredSQ : null }
        }
      },
      pathB: {
        label: pathBPlan.label || 'Full Replacement',
        recommended: pathBRecommended,
        tiers: pathBTiers,
        scope: {
          system: 'asphalt',
          lineItems: scopeLineItemsFromEstimate(est),
          measure: estimateScopeMeasure(est)
        }
      }
    };
    base.scope.lineItems = scopeLineItemsFromEstimate(est);
    return base;
  }

  // Unknown mode: degrade to an empty single-mode shell rather than throwing.
  base.mode = 'single';
  base.scope.lineItems = scopeLineItemsFromEstimate(est);
  return base;
}

// Static "always included" scope narrative, with per-estimate measurements
// injected where available. Mirrors api/proposal.js buildScopeLineItems intent
// but emits the {label,value} ProposalData scope shape.
function scopeLineItemsFromEstimate(est) {
  const sqVal = Number(est?.roof_area_sqft) > 0 ? (Number(est.roof_area_sqft) / 100).toFixed(1) : null;
  const sel = String(est?.selected_package || 'platinum').toLowerCase();
  const prod = {
    gold: 'CertainTeed Landmark',
    platinum: 'CertainTeed Landmark Pro (Max Def)',
    diamond: 'CertainTeed Grand Manor'
  }[sel] || 'CertainTeed Landmark';
  const workmanship = { gold: '15 yr', platinum: '20 yr', diamond: '25 yr' }[sel] || '15 yr';
  const iwsProd = sel === 'gold' ? 'standard' : 'Grace';
  const underlayProd = sel === 'gold' ? 'standard synthetic' : 'Roof Runner';

  const eaves = Number(est?.eaves_lf) || 0;
  const rakes = Number(est?.rakes_lf) || 0;
  const ridges = Number(est?.ridges_lf) || 0;
  const valleys = Number(est?.valleys_lf) || 0;
  const pipes = Number(est?.pipes) || 0;
  const osb = Number(est?.osb_sheets) || 0;

  const items = [
    { label: `${prod} + install`, value: sqVal ? `${sqVal} SQ included` : 'included' },
    { label: 'Full tear-off to deck', value: 'included' },
    { label: `${iwsProd} ice & water shield`, value: eaves ? `${eaves}${valleys ? '+' + valleys : ''} LF eaves+valleys` : 'included' },
    { label: `${underlayProd} underlayment`, value: 'full deck' },
    { label: 'Drip edge', value: (eaves || rakes) ? `${eaves + rakes} LF` : 'included' },
    { label: 'Ridge venting', value: ridges ? `${ridges} LF` : 'included' },
    { label: 'Valley metal', value: valleys ? `${valleys} LF` : 'included where applicable' },
    { label: 'Pipe boots (3-inch)', value: pipes ? `${pipes} boots` : 'included' },
    { label: 'Hip and ridge caps', value: 'included' },
    { label: 'Substrate inspection + re-nail', value: 'included' }
  ];
  if (osb) items.push({ label: 'Rotten wood allowance', value: `${osb} sheets (above then $85/sheet, approved in advance)` });
  items.push({ label: 'Magnetic cleanup + debris haul', value: 'included' });
  items.push({ label: '50 to 100+ photo documentation', value: 'every stage via Company Cam' });
  items.push({ label: 'Internal QA checklist', value: 'every install' });
  items.push({ label: 'Manufacturer warranty', value: 'Lifetime limited + 10-yr SureStart' });
  items.push({ label: 'Plus Ultra workmanship', value: `${workmanship} + leak-free guarantee` });
  return items;
}

// ── Section resolution (LIVE preview) ────────────────────────────────────────
// Given the template's ordered section keys and the tenant's proposal_blocks,
// resolve each to { type: block_type, content: tokens-resolved block.content }.
async function resolveSections(tenantId, sectionKeys, vars, overrides) {
  const keys = Array.isArray(sectionKeys) ? sectionKeys : [];
  if (!keys.length) return [];

  let blocks = [];
  try {
    const { data } = await supabaseAdmin
      .from('proposal_blocks')
      .select('block_key, block_type, content')
      .eq('tenant_id', tenantId)
      .in('block_key', keys);
    blocks = Array.isArray(data) ? data : [];
  } catch {
    blocks = [];
  }
  const byKey = new Map(blocks.map(b => [b.block_key, b]));

  const sections = [];
  for (const key of keys) {
    const block = byKey.get(key);
    if (!block) continue;                     // template referenced an unseeded block
    let content = resolveTokens(block.content || {}, vars);
    // Per-proposal operator copy edits (the builder's right-rail editor) ride in as
    // an override map keyed by block_key. Merge them over the seeded block content
    // so the live preview and the frozen materialized snapshot stay identical.
    const ov = overrides && overrides[key];
    if (ov && typeof ov === 'object') {
      content = Object.assign({}, content, resolveTokens(ov, vars));
    }
    sections.push({ type: block.block_type, content });
  }
  return sections;
}

// Inject the estimate's real before/after photos into the proof section so the
// customer sees THEIR home, not stock. No-op when no captioned photos exist.
function enrichProofPhotos(sections, est) {
  const photos = Array.isArray(est?.photos) ? est.photos : [];
  if (!photos.length) return;
  // before/after roles live in the photo caption (mirror api/proposal.js).
  const cap = p => String(p.caption || '').toLowerCase().replace(/[\s_-]+/g, '_');
  const before = photos.find(p => cap(p) === 'before' && p.url);
  const after = photos.find(p => (cap(p) === 'after' || cap(p) === 'metal_after') && p.url);
  // Only swap in real photos as a TRUE pair. Mixing one real photo with a stock
  // placeholder reads worse than two consistent stock images.
  if (!before || !after) return;
  const proof = sections.find(s => s.type === 'proof' || s.type === 'before_after');
  if (!proof) return;
  proof.content = proof.content || {};
  proof.content.beforeImage = before.url;
  proof.content.afterImage = after.url;
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: live preview of an ad-hoc (unsaved) template from the builder.
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const estimateId = String(body.estimate || '').trim();
      if (!estimateId) return res.status(400).json({ error: 'POST needs { estimate, template }' });
      const r = await assembleProposalData(estimateId, body.template);
      if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
      return res.json(r.data);
    } catch (e) {
      console.error('[proposal-v2] preview error:', e?.message);
      return res.status(500).json({ error: 'Preview failed', message: String(e?.message || e) });
    }
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instance = String(req.query.instance || '').trim();
  const estimateId = String(req.query.estimate || '').trim();
  const templateSlug = String(req.query.template || '').trim();

  try {
    if (instance) {
      return await renderInstance(instance, res);
    }
    if (estimateId) {
      return await renderLivePreview(estimateId, templateSlug, res);
    }
    return res.status(400).json({ error: 'Missing ?instance=<slug|share_token> or ?estimate=<id>&template=<slug>' });
  } catch (e) {
    console.error('[proposal-v2] handler error:', e?.message, e?.stack);
    return res.status(500).json({ error: 'Proposal assembly failed', message: String(e?.message || e) });
  }
}

// Best-effort view counter bump; never blocks the response.
function trackInstanceView(row) {
  supabaseAdmin
    .from('proposal_instances')
    .update({ view_count: (Number(row.view_count) || 0) + 1, last_viewed_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(() => {}, () => {});
}

// ── Path A: frozen snapshot ──────────────────────────────────────────────────
// Load the proposal_instances row and render its frozen snapshot AS-IS. We do
// NOT re-resolve pricing, tokens, branding, or rep here. The snapshot is the
// contract that was sent. Honors the no-edits-to-sent rule.
async function renderInstance(instance, res) {
  // The instance can be addressed by its public slug or its share token. Try
  // both columns; either uniquely identifies the row.
  let row = null;
  const { data: bySlug } = await supabaseAdmin
    .from('proposal_instances')
    .select('*')
    .eq('slug', instance)
    .maybeSingle();
  row = bySlug || null;
  if (!row) {
    const { data: byToken } = await supabaseAdmin
      .from('proposal_instances')
      .select('*')
      .eq('share_token', instance)
      .maybeSingle();
    row = byToken || null;
  }
  if (!row) return res.status(404).json({ error: 'Proposal not found' });

  // Frozen snapshot fast-path: the materializer stores the complete ProposalData
  // in data_snapshot. Serve it verbatim (the no-edits-to-sent guarantee), only
  // refreshing meta.status + the view counter.
  if (row.data_snapshot && typeof row.data_snapshot === 'object') {
    const snap = row.data_snapshot;
    if (snap.meta) {
      snap.meta.status = row.status || snap.meta.status;
      snap.meta.instanceSlug = row.slug || snap.meta.instanceSlug;
    }
    trackInstanceView(row);
    return res.json(snap);
  }

  // Legacy/fallback: assemble from the structured columns. Fall back to the bare
  // row columns when an older snapshot didn't nest them.
  const branding = row.branding_snapshot || row.branding || { ...TENANT_BRANDING_DEFAULT };
  const rep = row.rep_snapshot || row.rep || repPublic(REPS.darcy);
  const customer = row.customer_snapshot || row.customer || { name: '', address: '', phone: '', email: '', coverImage: null };
  const variables = row.variables || {};
  const sections = Array.isArray(row.sections) ? row.sections : [];

  // The frozen pricing lives in pricing_snapshot; product_selection records the
  // chosen tier/addons at send time. Pass both through unchanged.
  const pricing = row.pricing_snapshot || {};
  const selection = row.product_selection || {};
  const products = {
    mode: pricing.mode || selection.mode || 'single',
    recommended: pricing.recommended ?? selection.recommended ?? null,
    tiers: Array.isArray(pricing.tiers) ? pricing.tiers : [],
    addons: Array.isArray(pricing.addons) ? pricing.addons : [],
    twoPath: pricing.twoPath ?? null,
    envelope: pricing.envelope ?? null,
    scope: pricing.scope || { system: 'asphalt', lineItems: [], measure: { sq: null } },
    taxRate: Number(pricing.taxRate) > 0 ? Number(pricing.taxRate) : DEFAULT_TAX_RATE,
    financing: pricing.financing || { ...DEFAULT_FINANCING }
  };

  const refId = row.ref_id
    || (row.estimate_number ? `PU-${row.estimate_number}` : `PU-${String(row.id || '').slice(0, 8).toUpperCase()}`);

  const data = {
    meta: {
      instanceSlug: row.slug || instance,
      refId,
      rendererVersion: 'v2',
      status: row.status || 'sent',
      tenantId: row.tenant_id || null,
      estimateId: row.estimate_id || null
    },
    branding,
    rep,
    customer,
    variables,
    sections,
    products
  };

  trackInstanceView(row);
  return res.json(data);
}

// ── Path B: live preview ─────────────────────────────────────────────────────
// Load estimate + template + blocks, resolve sections, build products live.
// Nothing is persisted here; this is the builder's preview surface.
async function renderLivePreview(estimateId, templateSlug, res) {
  const r = await assembleProposalData(estimateId, templateSlug);
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  return res.json(r.data);
}

// ── Shared assembler ─────────────────────────────────────────────────────────
// estimate + template -> full ProposalData. Used by the live preview (returns it
// as JSON) and by api/proposal-materialize.js (persists it as a frozen snapshot).
// Returns { ok:false, status, error } on failure, { ok:true, data, est, template,
// tenantId } on success.
export async function assembleProposalData(estimateId, templateInput) {
  const { data: est, error: estErr } = await supabaseAdmin
    .from('estimates')
    .select('*, customer:customers(*), photos:estimate_photos(*)')
    .eq('id', estimateId)
    .single();
  if (estErr || !est) return { ok: false, status: 404, error: 'Estimate not found' };

  const tenantId = est.tenant_id;

  // Template may be a saved slug (string) or an inline definition (object) from
  // the builder's live preview. Both carry { sections, product_plan }.
  let template = null;
  if (templateInput && typeof templateInput === 'object' && Array.isArray(templateInput.sections)) {
    template = {
      id: null,
      slug: templateInput.slug || '(preview)',
      name: templateInput.name || 'Preview',
      sections: templateInput.sections,
      product_plan: templateInput.product_plan || {}
    };
  } else if (templateInput) {
    const { data: tpl } = await supabaseAdmin
      .from('proposal_templates')
      .select('id, slug, name, sections, product_plan')
      .eq('tenant_id', tenantId)
      .eq('slug', String(templateInput))
      .maybeSingle();
    template = tpl || null;
  }
  if (!template) {
    return { ok: false, status: 404, error: `Template not found: ${templateInput || '(missing template)'}` };
  }

  const [branding, taxRate] = await Promise.all([
    resolveBranding(tenantId),
    resolveTaxRate(tenantId)
  ]);
  const repFull = resolveRepFromEstimate(est);
  const rep = repPublic(repFull);
  const coverImage = pickCoverImage(est);
  const customer = buildCustomer(est, coverImage);
  const refId = `PU-${est.estimate_number || String(est.id).slice(0, 8).toUpperCase()}`;

  // Inline preview/materialize payloads may carry per-section content overrides
  // (operator copy edits keyed by block_key); thread them into section resolution.
  const overrides = (templateInput && typeof templateInput === 'object'
    && templateInput._overrides && typeof templateInput._overrides === 'object')
    ? templateInput._overrides : null;

  const variables = buildVariables({ branding, rep, customer, est, refId });
  const sections = await resolveSections(tenantId, template.sections, variables, overrides);
  enrichProofPhotos(sections, est);
  const products = buildProducts({ est, productPlan: template.product_plan, taxRate });

  const data = {
    meta: {
      instanceSlug: null,
      refId,
      rendererVersion: 'v2',
      status: est.status || 'draft',
      tenantId: tenantId || null,
      estimateId: est.id
    },
    branding,
    rep,
    customer,
    variables,
    sections,
    products
  };

  return { ok: true, data, est, template, tenantId };
}

// Re-export for unit tests / downstream callers that want the assembly seam.
export { buildProducts, resolveTokens, buildGoodBetterBestTiers, scopeLineItemsFromEstimate, withHST };
