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
import { withSentry } from '../lib/sentry.js';
import {
  normalizeCalculatedPackages,
  withHST,
  deriveMeasuredSQ,
  applyRenderPromo
} from '../lib/proposalPricing.js';
import { calculateRepairQuote } from '../lib/repairQuoteEngine.js';
import { calculateRejuvenationQuote } from '../lib/rejuvenationQuote.js';
import { calculateGutterQuote } from '../lib/gutterQuoteEngine.js';
import { isMetalSlug, getMetalCopy, METAL_TIER_COPY } from '../lib/metalProposalCopy.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

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

  // Default rep is the owner now that Darcy is off proposals (Jun 30). An explicit
  // sales_owner:darcy tag still resolves to Darcy above for any legacy deal.
  return REPS.mackenzie;
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
// mergeMetals=false skips the variant collapse: used by path builds where the
// metal grades ARE the ladder and every grade must keep its own card.
function buildGoodBetterBestTiers(est, offerSlugs, { mergeMetals = true } = {}) {
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

    let name, sub, tag, desc, perks, warrantyYears, toggle = null;
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
      toggle = metalCopy.toggleLabel || null;
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
      promoLabel: norm.promoLabel ?? null,
      toggle
    });
  }

  tiers.sort((a, b) => a.total - b.total);
  return mergeMetals ? mergeMetalVariants(tiers) : tiers;
}

// Two or more metal-* packages collapse into ONE card with a variant toggle
// instead of widening the grid to a fifth card. Default variant is the
// lowest-priced metal (tiers arrive price-sorted, so metals[0]); the euro-clay
// and flat-panel slugs were removed, so there is no special-case default lookup.
function mergeMetalVariants(tiers) {
  const metals = tiers.filter(t => isMetalSlug(t.id));
  if (metals.length < 2) return tiers;
  const def = metals[0];
  const merged = { ...def, variants: [def, ...metals.filter(m => m !== def)] };
  const out = tiers.filter(t => !isMetalSlug(t.id));
  out.push(merged);
  out.sort((a, b) => a.total - b.total);
  return out;
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

// Build one ProposalData path object for a tier ladder. Resolves the path system
// from the ladder ('metal' when every grade is metal, else the plan-declared
// system or `defaultSystem`), attaches per-panel re-pricing on a metal ladder,
// emits the system-correct scope, and picks a recommended grade. Mutates `tiers`.
function buildLadderPath(est, tiers, planRaw, defaultLabel, defaultSystem) {
  const plan = planRaw || {};
  const isMetal = isMetalTierList(tiers);
  const system = isMetal ? 'metal' : (plan.system || defaultSystem || 'shingle');
  let panels = null, defaultPanel = null;
  if (isMetal) {
    const panelInfo = decorateMetalPathTiers(est, tiers);
    if (panelInfo) { panels = panelInfo.panels; defaultPanel = panelInfo.defaultPanel; }
  }
  const recommended = plan.recommended || (tiers[Math.floor(tiers.length / 2)]?.id ?? null);
  const path = {
    label: plan.label || defaultLabel,
    system,
    recommended,
    tiers,
    scope: {
      system,
      lineItems: scopeForSystem(est, system, { grade: metalGradeForTier(recommended) }),
      measure: estimateScopeMeasure(est)
    }
  };
  if (panels) { path.panels = panels; path.defaultPanel = defaultPanel; }
  return path;
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
    // Build the ladder ONCE (unmerged), derive isMetal from it, then collapse
    // metal variants only when it is NOT an all-metal ladder. A metal
    // good/better/best ladder keeps every grade as its own card (no variant
    // merge) so panel re-pricing can attach per grade. mergeMetalVariants() is
    // exactly what buildGoodBetterBestTiers(..., { mergeMetals: true }) applies,
    // so the output is identical to the prior two-build path.
    const tiers = buildGoodBetterBestTiers(est, productPlan?.offer_slugs, { mergeMetals: false });
    const isMetal = isMetalTierList(tiers);
    base.tiers = isMetal ? tiers : mergeMetalVariants(tiers);
    const system = isMetal ? 'metal' : 'shingle';
    if (isMetal) {
      const panelInfo = decorateMetalPathTiers(est, base.tiers);
      if (panelInfo) { base.panels = panelInfo.panels; base.defaultPanel = panelInfo.defaultPanel; }
      base.scope.system = 'metal';
    }
    base.recommended = productPlan?.recommended
      || (base.tiers.find(t => t.id === 'platinum')?.id)
      || (base.tiers[Math.floor(base.tiers.length / 2)]?.id ?? null);
    base.scope.lineItems = scopeForSystem(est, system, { grade: metalGradeForTier(base.recommended) });
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
    const pathAPlanRaw = productPlan?.two_path?.pathA || {};

    // Generic dual-ladder flavor: when pathA declares its own offer_slugs,
    // BOTH paths draw tier ladders from calculated_packages (e.g. a Shingles
    // vs Metal system switch). No metal merge inside a path: the path IS the
    // ladder, so every grade keeps its own card.
    if (Array.isArray(pathAPlanRaw.offer_slugs) && pathAPlanRaw.offer_slugs.length) {
      const pathBPlanRaw = productPlan?.two_path?.pathB || {};
      const pathATiers = buildGoodBetterBestTiers(est, pathAPlanRaw.offer_slugs, { mergeMetals: false });
      const pathBTiers = buildGoodBetterBestTiers(est, pathBPlanRaw.offer_slugs, { mergeMetals: false });

      // Resolve each path's system from its own ladder ('metal' when every grade
      // is a metal-* slug, else 'shingle'), falling back to the plan's declared
      // system. A metal ladder gets per-panel re-pricing attached to every grade.
      const pathAObj = buildLadderPath(est, pathATiers, pathAPlanRaw, 'Option A', 'shingle');
      const pathBObj = buildLadderPath(est, pathBTiers, pathBPlanRaw, 'Option B', 'metal');
      const recA = pathAObj.recommended;
      const recB = pathBObj.recommended;
      const defaultPath = String(productPlan?.two_path?.default_path || 'A').toUpperCase() === 'B' ? 'B' : 'A';

      base.mode = 'two_path';
      base.tiers = defaultPath === 'A' ? pathATiers : pathBTiers;
      base.recommended = defaultPath === 'A' ? recA : recB;
      // Surface the default path's panel info at the top level so the renderer
      // can read panels off DATA.products for the initially shown ladder.
      const defObj = defaultPath === 'A' ? pathAObj : pathBObj;
      if (defObj.panels) { base.panels = defObj.panels; base.defaultPanel = defObj.defaultPanel; }
      base.twoPath = { defaultPath, pathA: pathAObj, pathB: pathBObj };
      base.scope.lineItems = defObj.scope.lineItems;
      base.scope.system = defObj.system;
      return base;
    }

    // Legacy flavor: Path A = single NuRoof Revive rejuvenation tier,
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
        system: 'rejuvenation',
        tiers: [pathATier],
        scope: {
          system: 'rejuvenation',
          // Revive carries its own engine line items; scopeForSystem's
          // rejuvenation stub is the fallback when no engine result exists.
          lineItems: engineLineItemsToScope(reviveResult),
          measure: { sq: measuredSQ > 0 ? measuredSQ : null }
        }
      },
      pathB: {
        label: pathBPlan.label || 'Full Replacement',
        system: 'shingle',
        recommended: pathBRecommended,
        tiers: pathBTiers,
        scope: {
          system: 'asphalt',
          lineItems: scopeForSystem(est, 'shingle'),
          measure: estimateScopeMeasure(est)
        }
      }
    };
    base.scope.lineItems = scopeForSystem(est, 'shingle');
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

// ── Metal scope (the core unification fix) ───────────────────────────────────
// The asphalt scope above is shingle-specific (CertainTeed, ice & water, hip and
// ridge caps). When the path system is metal, the old code emitted that shingle
// copy verbatim, which is the defect this fixes. metalScopeLineItemsFromEstimate
// emits METAL-correct customer-facing line items per grade, sourcing the panel
// system + warranty copy from lib/metalProposalCopy.js. It never hardcodes
// shingle copy. Grade is one of 'standard' | 'enhanced' | 'premium'; an unknown
// grade degrades to standard.
const METAL_GRADE_COPY = {
  standard: METAL_TIER_COPY['metal-standard'],
  enhanced: METAL_TIER_COPY['metal-enhanced'],
  premium: METAL_TIER_COPY['metal-premium']
};

function metalScopeLineItemsFromEstimate(est, { grade = 'standard' } = {}) {
  const g = String(grade || 'standard').toLowerCase();
  const copy = METAL_GRADE_COPY[g] || METAL_GRADE_COPY.standard;
  const isEnhanced = g === 'enhanced';
  const isPremium = g === 'premium';
  const deckPrep = isEnhanced || isPremium;          // tear-off + deck seal grades

  // Persisted measurements, same fields the shingle scope reads. Never fabricated.
  const sqVal = Number(est?.roof_area_sqft) > 0 ? (Number(est.roof_area_sqft) / 100).toFixed(1) : null;
  const eaves = Number(est?.eaves_lf) || 0;
  const rakes = Number(est?.rakes_lf) || 0;
  const ridges = Number(est?.ridges_lf) || 0;
  const valleys = Number(est?.valleys_lf) || 0;
  const pipes = Number(est?.pipes) || 0;

  // Panel system + install per grade (copy.name carries the grade-correct system).
  const items = [
    { label: `${copy.name} metal panel system + install`, value: sqVal ? `${sqVal} SQ included` : 'included' }
  ];

  // Tear-off / substrate.
  if (deckPrep) {
    items.push({ label: 'Full tear-off to deck + deck inspection', value: 'included' });
    if (isPremium) {
      items.push({ label: 'New 7/16 OSB roof sheathing (full redeck)', value: 'included' });
    }
    items.push({ label: 'Peel-and-stick deck seal', value: 'full deck' });
  } else {
    items.push({ label: 'Wood strapping over existing shingles', value: 'fastening + airflow' });
  }

  // Underlayment: enhanced/premium use high-temp synthetic + Grace ice & water.
  if (deckPrep) {
    items.push({ label: 'High-temperature underlayment', value: 'full deck' });
    items.push({ label: 'Grace ice & water shield', value: eaves ? `${eaves}${valleys ? '+' + valleys : ''} LF eaves+valleys` : 'full deck coverage' });
  } else {
    items.push({ label: 'Synthetic underlayment', value: 'full deck' });
  }

  // Metal perimeter: drip edge + closures / Z-trim, ridge cap/vent, valley metal.
  items.push({ label: 'Metal drip edge + closures / Z-trim', value: (eaves || rakes) ? `${eaves + rakes} LF perimeter` : 'included' });
  items.push({ label: isPremium ? 'Custom-bent ridge cap + ridge vent' : 'Metal ridge cap + ridge vent', value: ridges ? `${ridges} LF` : 'included' });
  items.push({ label: 'Open metal valley', value: valleys ? `${valleys} LF` : 'included where applicable' });
  items.push({ label: 'Pre-bent chimney + pipe flashings', value: pipes ? `${pipes} penetrations` : 'included' });
  items.push({ label: 'Screw-and-clip fastening', value: deckPrep ? 'concealed / butyl-sealed at every fastener' : 'butyl tape + sealed at every fastener' });

  // Disposal / QA / warranty.
  items.push({ label: 'Magnetic cleanup + debris haul', value: 'included' });
  items.push({ label: '50 to 100+ photo documentation', value: 'every stage via Company Cam' });
  items.push({ label: 'Manufacturer warranty', value: copy.warrantyLabel || `${copy.warrantyYears}-year` });
  items.push({ label: 'Plus Ultra workmanship', value: `${copy.warrantyYears}-yr + leak-free guarantee` });
  return items;
}

// ── scopeForSystem dispatcher ────────────────────────────────────────────────
// Routes the scope build by the path's system so the metal path renders METAL
// line items, not shingle copy. The DEFAULT branch is the existing asphalt
// scopeLineItemsFromEstimate(est) VERBATIM, so the asphalt path is unchanged.
//   metal        -> metalScopeLineItemsFromEstimate
//   rejuvenation -> TODO stub (Revive is a later unit); shingle copy for now
//   default      -> scopeLineItemsFromEstimate (asphalt, unchanged)
function scopeForSystem(est, system, opts = {}) {
  const sys = String(system || 'shingle').toLowerCase();
  if (sys === 'metal') {
    return metalScopeLineItemsFromEstimate(est, { grade: opts.grade });
  }
  if (sys === 'rejuvenation') {
    // TODO: Revive (rejuvenation) scope is its own unit. Until then fall through
    // to the shingle scope so the renderer never shows raw braces or blanks.
    return scopeLineItemsFromEstimate(est);
  }
  return scopeLineItemsFromEstimate(est);
}

// ── Metal panel re-pricing (divisor method) ──────────────────────────────────
// Mac's UX: the metal path shows a panel-profile toggle (flat / wavy / stand)
// ABOVE the Standard/Enhanced/Premium cards. Each card re-prices live by panel.
// We emit, per metal tier, a panelPrices map { flat, wavy, stand } (PRE-TAX); the
// renderer applies HST + $25 rounding and the panel default.
//
// Cost stack (per SQ), divisor method (Sell = DirectCost / divisor):
//   panel material $/SQ: flat $230 (Community Barn ribbed/standard),
//                        wavy $290 (European clay imitation, +30%),
//                        stand $800 (standing seam).
//   labour band: moderate $290/SQ baseline, steep $350/SQ (12/12). Labour is
//   NEVER $0; a metal install always carries crew labour.
//   Grade divisors: Standard /0.53, Enhanced /0.50, Premium /0.48.
const METAL_PANEL_MATERIAL_PER_SQ = { flat: 230, wavy: 290, stand: 800 };
const METAL_MODERATE_LABOUR_PER_SQ = 290;
const METAL_STEEP_LABOUR_PER_SQ = 350;
const METAL_GRADE_DIVISOR = { standard: 0.53, enhanced: 0.50, premium: 0.48 };
const METAL_PANELS = ['flat', 'wavy', 'stand'];
const METAL_DEFAULT_PANEL = 'flat';

// Pre-tax sell per panel for one grade, on the persisted measured SQ. Returns a
// { flat, wavy, stand } map of pre-tax dollars, or null when no persisted SQ
// exists (never fabricate SQ; the renderer/path falls back to package pricing).
function metalPanelPrices(est, grade) {
  const measuredSQ = estimateMeasuredSQ(est);
  if (!(measuredSQ > 0)) return null;
  const g = String(grade || 'standard').toLowerCase();
  const divisor = METAL_GRADE_DIVISOR[g] || METAL_GRADE_DIVISOR.standard;
  const steep = est?.custom_prices?._metal_steep === true || est?.steep === true;
  const labourPerSQ = steep ? METAL_STEEP_LABOUR_PER_SQ : METAL_MODERATE_LABOUR_PER_SQ;
  const out = {};
  for (const panel of METAL_PANELS) {
    const directPerSQ = (METAL_PANEL_MATERIAL_PER_SQ[panel] || 0) + labourPerSQ;
    const directCost = directPerSQ * measuredSQ;
    out[panel] = Math.round(directCost / divisor);   // PRE-TAX
  }
  return out;
}

// Map a metal tier id to its canonical grade ('standard'|'enhanced'|'premium').
function metalGradeForTier(id) {
  const s = String(id || '').toLowerCase();
  if (s.includes('premium')) return 'premium';
  if (s.includes('enhanced') || s.includes('standing-seam')) return 'enhanced';
  return 'standard';
}

// True when every priced tier in the list is a metal-* slug. Used to decide
// whether a path/ladder is the metal system and should carry panel re-pricing.
function isMetalTierList(tiers) {
  return Array.isArray(tiers) && tiers.length > 0 && tiers.every(t => isMetalSlug(t.id));
}

// Attach per-panel re-pricing to each tier of a metal ladder. Each tier gets a
// panelPrices map (PRE-TAX), and the tier `total` is re-anchored to the default
// panel so the data is internally consistent for clients that read `total`
// directly. Premium carries has_estimated_pricing=true (standing-seam supply is
// an estimate). Returns the list of panels + the default so the path can expose
// them. Mutates the tiers in place (they are freshly built per call).
function decorateMetalPathTiers(est, tiers) {
  if (!isMetalTierList(est && tiers ? tiers : [])) return null;
  let priced = false;
  tiers.forEach(t => {
    const grade = metalGradeForTier(t.id);
    const panelPrices = metalPanelPrices(est, grade);
    if (panelPrices) {
      t.panelPrices = panelPrices;
      t.total = panelPrices[METAL_DEFAULT_PANEL];   // PRE-TAX, default panel
      t.persq = 0;                                  // per-SQ varies by panel now
      // A re-priced metal tier supersedes any package promo strike.
      t.originalTotal = null;
      t.promoLabel = null;
      priced = true;
    }
    if (grade === 'premium') t.has_estimated_pricing = true;
  });
  if (!priced) return null;                         // no persisted SQ; leave as-is
  tiers.sort((a, b) => a.total - b.total);
  return { panels: METAL_PANELS.slice(), defaultPanel: METAL_DEFAULT_PANEL };
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

// ── Stale-snapshot section auto-heal ─────────────────────────────────────────
// A proposal frozen before its tenant's block library + template were seeded
// gets stored with sections: []. The renderer then serves a price-only page
// (no intro, scope, proof, reviews, guarantee) which reads as half a proposal.
// rehydrateSectionsIfEmpty rebuilds the missing sections at render time from the
// now-seeded template + blocks, resolving tokens against the instance's OWN
// frozen variables so the copy matches what was sent. Pricing, branding, rep,
// and customer stay frozen and untouched. Healthy snapshots (sections already
// present) are never altered, and every failure path leaves sections as-is, so
// the heal can only restore content, never degrade a working proposal.
const DEFAULT_TEMPLATE_BY_SYSTEM = {
  asphalt: 'asphalt-good-better-best',
  metal: 'metal',
  flat: 'flat-commercial',
  exterior: 'configurator-shell',
  shell: 'configurator-shell'
};

async function rehydrateSectionsIfEmpty(row, served) {
  const current = Array.isArray(served.sections) ? served.sections : [];
  if (current.length) return current;            // healthy snapshot, leave frozen
  if (!row || !row.tenant_id) return current;

  try {
    // 1. Resolve the template that defined this proposal's ordered section keys.
    let template = null;
    if (row.template_id) {
      const { data } = await supabaseAdmin
        .from('proposal_templates')
        .select('slug, sections')
        .eq('id', row.template_id)
        .maybeSingle();
      template = data || null;
    }
    if (!template) {
      // Older rows carry no template_id; fall back to the active template for
      // the frozen system so the heal still applies.
      const system = served?.products?.scope?.system || row?.pricing_snapshot?.scope?.system || 'asphalt';
      const slug = DEFAULT_TEMPLATE_BY_SYSTEM[system] || DEFAULT_TEMPLATE_BY_SYSTEM.asphalt;
      const { data } = await supabaseAdmin
        .from('proposal_templates')
        .select('slug, sections')
        .eq('tenant_id', row.tenant_id)
        .eq('slug', slug)
        .maybeSingle();
      template = data || null;
    }
    if (!template || !Array.isArray(template.sections) || !template.sections.length) return current;

    // 2. Resolve against the instance's frozen variables so copy matches send time.
    const vars = served.variables || row.variables || {};
    const sections = await resolveSections(row.tenant_id, template.sections, vars, null);
    if (!sections.length) return current;          // blocks still unseeded; do not degrade

    // 3. Best-effort: swap in the estimate's real before/after photos.
    if (row.estimate_id) {
      try {
        const { data: est } = await supabaseAdmin
          .from('estimates')
          .select('photos:estimate_photos(*)')
          .eq('id', row.estimate_id)
          .maybeSingle();
        if (est) enrichProofPhotos(sections, est);
      } catch { /* photos are optional */ }
    }

    // 4. Best-effort: persist so the same link is permanently repaired.
    persistHealedSections(row, sections);
    return sections;
  } catch (e) {
    console.error('[proposal-v2] section rehydrate failed:', e?.message);
    return current;
  }
}

// Write rehydrated sections back into the frozen row so the repair is permanent.
// Repairs a corrupt (empty) snapshot to its intended content; never touches
// pricing. Never blocks the response (mirrors trackInstanceView).
function persistHealedSections(row, sections) {
  const patch = { sections };
  if (row.data_snapshot && typeof row.data_snapshot === 'object') {
    patch.data_snapshot = { ...row.data_snapshot, sections };
  }
  supabaseAdmin
    .from('proposal_instances')
    .update(patch)
    .eq('id', row.id)
    .then(() => {}, () => {});
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════════════
async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── PRIVILEGED: estimate-by-id LIVE preview ────────────────────────────────
  // POST {estimate,template} and GET ?estimate=<id> both assemble a proposal
  // directly from an estimate row (full customer PII + raw pricing) with NO
  // share_token. That bypasses the public share model and is an IDOR if left
  // open, so it requires an owner/admin (or service) session and is scoped to
  // that session's tenant. The public GET ?instance=<slug|share_token> snapshot
  // path below stays open (that IS the share model).
  const wantsEstimatePath =
    req.method === 'POST' ||
    (req.method === 'GET'
      && String(req.query.estimate || '').trim()
      && !String(req.query.instance || '').trim());

  if (wantsEstimatePath) {
    return requirePortalSessionAndTenant(handleEstimatePath)(req, res);
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instance = String(req.query.instance || '').trim();
  if (!instance) {
    return res.status(400).json({ error: 'Missing ?instance=<slug|share_token> or ?estimate=<id>&template=<slug>' });
  }

  try {
    return await renderInstance(instance, res);
  } catch (e) {
    console.error('[proposal-v2] handler error:', e?.message, e?.stack);
    return res.status(500).json({ error: 'Proposal assembly failed', message: String(e?.message || e) });
  }
}

// Gated estimate-by-id assembler path. The wrapper sets req.session + req.tenant;
// every estimate read here is scoped to req.tenant.id so a logged-in user of one
// tenant cannot read another tenant's estimate by id.
async function handleEstimatePath(req, res) {
  const tenantId = req.tenant?.id || null;

  // POST: live preview of an ad-hoc (unsaved) template from the builder.
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const estimateId = String(body.estimate || '').trim();
      if (!estimateId) return res.status(400).json({ error: 'POST needs { estimate, template }' });
      const r = await assembleProposalData(estimateId, body.template, tenantId);
      if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
      return res.json(r.data);
    } catch (e) {
      console.error('[proposal-v2] preview error:', e?.message);
      return res.status(500).json({ error: 'Preview failed', message: String(e?.message || e) });
    }
  }

  // GET ?estimate=<id>&template=<slug>
  const estimateId = String(req.query.estimate || '').trim();
  const templateSlug = String(req.query.template || '').trim();
  try {
    const r = await assembleProposalData(estimateId, templateSlug, tenantId);
    if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
    return res.json(r.data);
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
    // Heal price-only snapshots frozen before the block library was seeded.
    snap.sections = await rehydrateSectionsIfEmpty(row, snap);
    // Surface the live acceptance so the contract page can recover the tier /
    // panel / addons the customer actually accepted. The snapshot is frozen at
    // materialize time (before acceptance), so this is read from the live row.
    snap.accepted_payload = row.accepted_payload || null;
    snap.product_selection = row.product_selection || null;
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
    products,
    accepted_payload: row.accepted_payload || null,
    product_selection: row.product_selection || null
  };

  // Heal price-only instances frozen before the block library was seeded.
  data.sections = await rehydrateSectionsIfEmpty(row, data);
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
export async function assembleProposalData(estimateId, templateInput, expectedTenantId = null) {
  const { data: est, error: estErr } = await supabaseAdmin
    .from('estimates')
    .select('*, customer:customers(*), photos:estimate_photos(*)')
    .eq('id', estimateId)
    .single();
  if (estErr || !est) return { ok: false, status: 404, error: 'Estimate not found' };

  // Tenant isolation: supabaseAdmin bypasses RLS, so when a caller supplies the
  // authenticated tenant (estimate-by-id live preview), enforce that the loaded
  // estimate belongs to it. Return 404 (not 403) so cross-tenant probes cannot
  // confirm an id exists. Callers that pass no tenant (in-process materialize,
  // which runs its own tenant check) keep the prior behavior.
  if (expectedTenantId && est.tenant_id !== expectedTenantId) {
    return { ok: false, status: 404, error: 'Estimate not found' };
  }

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
// metalPanelPrices + metalGradeForTier + METAL_DEFAULT_PANEL are shared with
// api/proposal-accept.js so the accept path can re-derive the metal panel price
// SERVER-side (never trusting a client-posted dollar) when no frozen snapshot
// panelPrices are available.
export { buildProducts, resolveTokens, buildGoodBetterBestTiers, scopeLineItemsFromEstimate, withHST };
export { metalPanelPrices, metalGradeForTier, METAL_DEFAULT_PANEL };

// Request handler wrapped with Sentry error reporting (no-op until SENTRY_DSN is set).
export default withSentry(handler);
