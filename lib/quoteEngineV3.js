// ═══════════════════════════════════════════════════════════════
// RYUJIN OS — Quote Engine v3.1
// Scope-aware, merchant-backed, offer-driven, tenant-configurable
//
// Three modes:
//   1. Guided — answer ~5 questions, engine fills everything else
//   2. Advanced — all line items open, fill/override at will
//   3. Override — post-generation, any line item manually adjustable
//
// Pricing: Materials + Labor + Multiplier (unified for all systems)
// Price resolution: override → merchant DB → regional median → fallback
//
// Systems: Residential (Gold/Plat/Diamond), Commercial (Econ/Std/Prem),
//          Custom (Performance Shell), Metal, Flat
// ═══════════════════════════════════════════════════════════════

// ─── Constants (geometry — never tenant-configurable) ────────
const PITCH_MULTIPLIERS = {
  '4/12': 1.054, '5/12': 1.083, '6/12': 1.118, '7/12': 1.158,
  '8/12': 1.202, '9/12': 1.250, '10/12': 1.302, '11/12': 1.357,
  '12/12': 1.414, '13/12': 1.474, '14/12': 1.537,
  'flat': 1.00  // 0/12 — flat roofing
};

const WASTE_FACTORS = { simple: 0.10, medium: 0.15, complex: 0.20 };

// ─── Hardcoded defaults (used ONLY when tenant_settings not loaded) ───
const DEFAULTS = {
  taxRate: 0.15,
  dailyOverhead: 90,
  crewSqPerDay: 12,
  crewExteriorSqftPerDay: 500,
  priceRounding: 25,
  laborRoofing: {
    asphalt: { low: 130, moderate: 160, steep: 190 },
    metal: { low: 250, moderate: 300, steep: 350 },
    flat: { low: 100, moderate: 130, steep: 160 },
    extra_layer: 40,
    cedar_tearoff: 70,
    redecking: 30,
    valley_install: 1.50,
    ridge_vent_install: 2.00,
    pipe_flashing: 20,
    small_chimney_flashing: 125,
    large_chimney_flashing: 350,
    cricket_construction: 150,
    max_vent_install: 50
  },
  laborExterior: {
    strip_existing: 1.50,
    sheathing_inspection: 0.25,
    housewrap_install: 0.15,
    eps_foam_install: 0.40,
    ventigrid_install: 0.20,
    osb_substrate: 30,
    soffit: { low: 30, mid: 35, high: 40 },
    fascia: { low: 20, mid: 25, high: 30 },
    gutter: { low: 22, mid: 26, high: 30 },
    leaf_guard: 6,
    siding_install: {
      vinyl: { low: 4, mid: 5, high: 6 },
      fiber_cement: { low: 6, mid: 8, high: 10 },
      steel: { low: 5, mid: 7, high: 9 },
      aluminum: { low: 6, mid: 8.50, high: 11 }
    },
    window_capping: 75,
    door_capping: 100,
    window_install: { small: 200, medium: 250, large: 350 }
  },
  distanceTiers: {
    local_max_km: 20,
    day_trip_max_km: 60,
    adders: { local: 0, day_trip: 20, extended: 40 },
    disposal: { local: 350, day_trip: 450, extended: 550 }
  }
};


// ═══════════════════════════════════════════════════════════════
// TENANT SETTINGS LOADER
// Pulls tenant_settings from DB, merges with defaults
// ═══════════════════════════════════════════════════════════════

async function loadTenantSettings(supabase, tenantId) {
  const { data } = await supabase
    .from('tenant_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .single();

  if (!data) {
    return {
      taxRate: DEFAULTS.taxRate,
      taxLabel: 'HST',
      dailyOverhead: DEFAULTS.dailyOverhead,
      crewSqPerDay: DEFAULTS.crewSqPerDay,
      crewExteriorSqftPerDay: DEFAULTS.crewExteriorSqftPerDay,
      priceRounding: DEFAULTS.priceRounding,
      roofing: DEFAULTS.laborRoofing,
      exterior: DEFAULTS.laborExterior,
      distance: DEFAULTS.distanceTiers,
      mobilization: null,
      remediation: null
    };
  }

  return {
    taxRate: parseFloat(data.tax_rate) || DEFAULTS.taxRate,
    taxLabel: data.tax_label || 'HST',
    dailyOverhead: parseFloat(data.daily_overhead) || DEFAULTS.dailyOverhead,
    crewSqPerDay: parseFloat(data.crew_sq_per_day) || DEFAULTS.crewSqPerDay,
    crewExteriorSqftPerDay: parseFloat(data.crew_exterior_sqft_per_day) || DEFAULTS.crewExteriorSqftPerDay,
    priceRounding: data.price_rounding || DEFAULTS.priceRounding,
    roofing: data.labor_rates_roofing || DEFAULTS.laborRoofing,
    exterior: data.labor_rates_exterior || DEFAULTS.laborExterior,
    distance: data.distance_tiers || DEFAULTS.distanceTiers,
    mobilization: data.mobilization_rules || null,
    remediation: data.remediation_tiers || null,
    multipliers: data.default_multipliers || null,
    marginFloors: data.margin_floors || null,
    branding: {
      companyName: data.company_name,
      phone: data.company_phone,
      email: data.company_email,
      website: data.company_website,
      logoUrl: data.logo_url,
      accentColor: data.accent_color,
      tagline: data.tagline
    }
  };
}


// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS (now settings-aware)
// ═══════════════════════════════════════════════════════════════

function getLaborPitchTier(pitch) {
  const p = parseInt((pitch || '5/12').split('/')[0]);
  if (p <= 6) return 'low';
  if (p <= 9) return 'moderate';
  return 'steep';
}

function getDistanceAdder(km, settings) {
  const d = settings.distance;
  if (km <= d.local_max_km) return d.adders.local;
  if (km <= d.day_trip_max_km) return d.adders.day_trip;
  return d.adders.extended;
}

function getProjectType(km, settings) {
  const d = settings.distance;
  if (km <= d.local_max_km) return 'local';
  if (km <= d.day_trip_max_km) return 'dayTrip';
  return 'extendedStay';
}

function getDisposalCost(km, settings) {
  const d = settings.distance;
  if (km <= d.local_max_km) return d.disposal.local;
  if (km <= d.day_trip_max_km) return d.disposal.day_trip;
  return d.disposal.extended;
}

function getRemediationAllowance(hardCost, settings) {
  if (settings.remediation && Array.isArray(settings.remediation)) {
    for (const tier of settings.remediation) {
      if (tier.max_hard_cost === null || hardCost < tier.max_hard_cost) {
        return tier.allowance;
      }
    }
  }
  // Fallback
  if (hardCost < 20000) return 1500;
  if (hardCost < 35000) return 2000;
  if (hardCost < 50000) return 2500;
  if (hardCost < 80000) return 3500;
  return 5000;
}

function roundToNearest(value, nearest) {
  return Math.round(value / nearest) * nearest;
}


// ═══════════════════════════════════════════════════════════════
// PRICE RESOLVER — merchant DB → regional → fallback
// Single item resolver + batch resolver to avoid N+1
// ═══════════════════════════════════════════════════════════════

export async function resolvePrice(supabase, productId, tenantId, fallbackPrice = 0) {
  if (!productId) return { price: fallbackPrice, source: 'default', detail: 'No product linked' };

  try {
    const { data: merchantPrices } = await supabase
      .from('merchant_products')
      .select('price, merchant:merchants(name, city)')
      .eq('product_id', productId)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .eq('in_stock', true)
      .order('price', { ascending: true })
      .limit(1);

    if (merchantPrices && merchantPrices.length > 0) {
      const mp = merchantPrices[0];
      return {
        price: mp.price,
        source: 'merchant',
        detail: `${mp.merchant?.name} @ $${mp.price}`
      };
    }

    const { data: product } = await supabase
      .from('products').select('category_id').eq('id', productId).single();

    if (product) {
      const { data: regional } = await supabase
        .from('regional_pricing')
        .select('median_price, low_price, high_price, labor_rate, geo_level, geo_value, confidence')
        .or(`product_id.eq.${productId},category_id.eq.${product.category_id}`)
        .order('geo_level')
        .limit(1);

      if (regional && regional.length > 0 && regional[0].median_price) {
        return {
          price: regional[0].median_price,
          source: 'regional',
          detail: `${regional[0].geo_value} median @ $${regional[0].median_price} (${regional[0].confidence} confidence)`,
          laborRate: regional[0].labor_rate,
          confidence: regional[0].confidence,
          estimated: regional[0].confidence !== 'high'
        };
      }
    }
  } catch (e) {
    // DB error — fall through to fallback
  }

  return { price: fallbackPrice, source: 'fallback', detail: 'Hardcoded default', estimated: true };
}

// Batch resolve: fetch all merchant + regional prices in 2 queries instead of N*3
export async function resolvePricesBatch(supabase, productIds, tenantId) {
  const unique = [...new Set(productIds.filter(Boolean))];
  if (unique.length === 0) return {};

  const results = {};

  try {
    // 1. Batch fetch merchant prices for all products
    const { data: merchantPrices } = await supabase
      .from('merchant_products')
      .select('product_id, price, merchant:merchants(name, city)')
      .in('product_id', unique)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .eq('in_stock', true)
      .order('price', { ascending: true });

    // Group by product_id, keep cheapest
    const merchantMap = {};
    for (const mp of (merchantPrices || [])) {
      if (!merchantMap[mp.product_id]) {
        merchantMap[mp.product_id] = mp;
      }
    }

    // 2. Batch fetch regional prices for remaining products
    const needRegional = unique.filter(id => !merchantMap[id]);
    let regionalMap = {};

    if (needRegional.length > 0) {
      const { data: regional } = await supabase
        .from('regional_pricing')
        .select('product_id, median_price, low_price, high_price, labor_rate, geo_level, geo_value, confidence')
        .in('product_id', needRegional)
        .order('geo_level');

      for (const rp of (regional || [])) {
        if (!regionalMap[rp.product_id] && rp.median_price) {
          regionalMap[rp.product_id] = rp;
        }
      }
    }

    // Build results
    for (const id of unique) {
      if (merchantMap[id]) {
        const mp = merchantMap[id];
        results[id] = {
          price: mp.price,
          source: 'merchant',
          detail: `${mp.merchant?.name} @ $${mp.price}`
        };
      } else if (regionalMap[id]) {
        const rp = regionalMap[id];
        results[id] = {
          price: rp.median_price,
          source: 'regional',
          detail: `${rp.geo_value} median @ $${rp.median_price} (${rp.confidence} confidence)`,
          laborRate: rp.labor_rate,
          confidence: rp.confidence,
          estimated: rp.confidence !== 'high'
        };
      } else {
        results[id] = { price: 0, source: 'fallback', detail: 'No pricing data', estimated: true };
      }
    }
  } catch (e) {
    // On error, return empty — callers use fallback
  }

  return results;
}


// ═══════════════════════════════════════════════════════════════
// GUIDED MODE — Question Flow
// Returns the questions needed based on system type
// Answers auto-fill measurements + choices for the engine
// ═══════════════════════════════════════════════════════════════

export function getGuidedQuestions(system) {
  const common = [
    {
      key: 'address',
      label: 'Property address',
      type: 'text',
      required: true,
      hint: 'Used for distance calculation and project file'
    },
    {
      key: 'distanceKM',
      label: 'Distance from shop (km)',
      type: 'number',
      required: true,
      default: 10,
      hint: 'Riverview to job site'
    }
  ];

  switch (system) {
    case 'residential':
    case 'asphalt':
      return [
        ...common,
        {
          key: 'squareFeet',
          label: 'Roof area (sq ft)',
          type: 'number',
          required: true,
          hint: 'From EagleView report or tape measure. 2D footprint — engine applies pitch multiplier.'
        },
        {
          key: 'pitch',
          label: 'Roof pitch',
          type: 'select',
          required: true,
          default: '5/12',
          options: Object.keys(PITCH_MULTIPLIERS).filter(k => k !== 'flat'),
          hint: 'Measured or from EagleView'
        },
        {
          key: 'complexity',
          label: 'Roof complexity',
          type: 'select',
          required: true,
          default: 'medium',
          options: ['simple', 'medium', 'complex'],
          hint: 'Simple = basic gable. Medium = hip/valley. Complex = cut-up, dormers, steep.'
        },
        {
          key: 'stories',
          label: 'Number of stories',
          type: 'select',
          default: 1,
          options: [1, 1.5, 2, 2.5, 3]
        },
        {
          key: 'extraLayers',
          label: 'Existing shingle layers to remove',
          type: 'select',
          default: 1,
          options: [0, 1, 2, 3],
          hint: '0 = new construction, no tear-off'
        }
      ];

    case 'metal':
      return [
        ...common,
        {
          key: 'squareFeet',
          label: 'Roof area (sq ft)',
          type: 'number',
          required: true
        },
        {
          key: 'pitch',
          label: 'Roof pitch',
          type: 'select',
          required: true,
          default: '5/12',
          options: Object.keys(PITCH_MULTIPLIERS)
        },
        {
          key: 'panelType',
          label: 'Panel type',
          type: 'select',
          default: 'americana',
          options: ['americana', 'standingSeam'],
          labels: { americana: 'Americana Ribbed ($2.80/sqft)', standingSeam: 'Standing Seam ($6.00/sqft)' }
        },
        {
          key: 'complexity',
          label: 'Roof complexity',
          type: 'select',
          default: 'medium',
          options: ['simple', 'medium', 'complex']
        }
      ];

    case 'flat':
    case 'commercial_flat':
      return [
        ...common,
        {
          key: 'squareFeet',
          label: 'Roof area (sq ft)',
          type: 'number',
          required: true
        },
        {
          key: 'flatSystem',
          label: 'Flat roof system',
          type: 'select',
          default: 'tpo',
          options: ['tpo', 'epdm', 'mod_bit', 'bur'],
          labels: {
            tpo: 'TPO Membrane *',
            epdm: 'EPDM Rubber *',
            mod_bit: 'Modified Bitumen *',
            bur: 'Built-Up Roofing (BUR) *'
          },
          hint: '* Estimated pricing — verify with supplier before quoting'
        },
        {
          key: 'complexity',
          label: 'Roof complexity',
          type: 'select',
          default: 'medium',
          options: ['simple', 'medium', 'complex'],
          hint: 'Penetrations, curbs, drains, parapets'
        }
      ];

    case 'exterior':
    case 'performance_shell':
    case 'custom':
      return [
        ...common,
        {
          key: 'wallSqFt',
          label: 'Total exterior wall area (sq ft)',
          type: 'number',
          required: true,
          hint: 'All sides combined. Subtract window/door openings or estimate gross.'
        },
        {
          key: 'sidingChoice',
          label: 'Siding material',
          type: 'select',
          required: true,
          default: 'vinyl_standard',
          options: ['vinyl_standard', 'vinyl_premium', 'vinyl_signature', 'hardie_lap', 'steel_ribbed', 'steel_board_batten', 'aluminum'],
          labels: {
            vinyl_standard: 'Vinyl — Standard (Gentek Sovereign)',
            vinyl_premium: 'Vinyl — Premium (Gentek Sequoia)',
            vinyl_signature: 'Vinyl — Signature (Gentek Premium)',
            hardie_lap: 'HardiePlank Fiber Cement',
            steel_ribbed: 'Steel Ribbed Panel',
            steel_board_batten: 'Steel Board & Batten',
            aluminum: 'Aluminum Panel'
          }
        },
        {
          key: 'soffitLF',
          label: 'Soffit linear feet',
          type: 'number',
          default: 0
        },
        {
          key: 'fasciaLF',
          label: 'Fascia linear feet',
          type: 'number',
          default: 0
        },
        {
          key: 'windowCount',
          label: 'Number of windows to cap/replace',
          type: 'number',
          default: 0
        }
      ];

    case 'combined':
      return [
        ...common,
        {
          key: 'squareFeet',
          label: 'Roof area (sq ft)',
          type: 'number',
          required: true
        },
        {
          key: 'pitch',
          label: 'Roof pitch',
          type: 'select',
          required: true,
          default: '5/12',
          options: Object.keys(PITCH_MULTIPLIERS).filter(k => k !== 'flat')
        },
        {
          key: 'complexity',
          label: 'Roof complexity',
          type: 'select',
          default: 'medium',
          options: ['simple', 'medium', 'complex']
        },
        {
          key: 'wallSqFt',
          label: 'Total exterior wall area (sq ft)',
          type: 'number',
          hint: 'Leave 0 if roof only'
        },
        {
          key: 'sidingChoice',
          label: 'Siding material (if exterior included)',
          type: 'select',
          default: 'vinyl_standard',
          options: ['vinyl_standard', 'vinyl_premium', 'vinyl_signature', 'hardie_lap', 'steel_ribbed', 'steel_board_batten', 'aluminum']
        }
      ];

    default:
      return common;
  }
}


// ═══════════════════════════════════════════════════════════════
// GUIDED MODE — Answer Processor
// Takes guided answers → returns measurements + choices for engine
// ═══════════════════════════════════════════════════════════════

export function processGuidedAnswers(answers, system) {
  const measurements = {
    squareFeet: answers.squareFeet || 0,
    pitch: answers.pitch || '5/12',
    complexity: answers.complexity || 'medium',
    distanceKM: answers.distanceKM || 10,
    stories: answers.stories || 1,
    extraLayers: answers.extraLayers ?? 1,
    // Exterior
    wallSqFt: answers.wallSqFt || 0,
    soffitLF: answers.soffitLF || 0,
    fasciaLF: answers.fasciaLF || 0,
    gutterLF: answers.gutterLF || 0,
    windowCount: answers.windowCount || 0,
    doorCount: answers.doorCount || 0,
    // Auto-estimates from guided answers
    pipes: answers.pipes || 3,              // reasonable default
    chimneys: answers.chimneys || 0,
    vents: answers.vents || 2,
    // Perimeter estimates from sq footage (for guided mode)
    eavesLF: answers.eavesLF || 0,
    rakesLF: answers.rakesLF || 0,
    ridgesLF: answers.ridgesLF || 0,
    valleysLF: answers.valleysLF || 0
  };

  // Smart defaults: estimate perimeter from square footage if not provided
  if (measurements.squareFeet > 0 && measurements.eavesLF === 0) {
    const side = Math.sqrt(measurements.squareFeet);
    measurements.eavesLF = Math.round(side * 2);  // two eaves
    measurements.rakesLF = Math.round(side * 2);   // two rakes
    measurements.ridgesLF = Math.round(side);       // one ridge
    if (measurements.complexity === 'complex') {
      measurements.valleysLF = Math.round(side * 0.5);
    }
  }

  // Metal-specific
  if (system === 'metal') {
    measurements.panelType = answers.panelType || 'americana';
  }

  // Flat-specific
  if (system === 'flat' || system === 'commercial_flat') {
    measurements.pitch = 'flat';
    measurements.flatSystem = answers.flatSystem || 'tpo';
  }

  const choices = {
    siding: answers.sidingChoice || 'vinyl_standard',
    housewrap: answers.housewrapChoice || 'tyvek_standard'
  };

  return { measurements, choices, address: answers.address };
}


// ═══════════════════════════════════════════════════════════════
// QUANTITY CALCULATOR
// ═══════════════════════════════════════════════════════════════

function calculateQuantities(itemKey, measurements, config = {}) {
  const {
    measuredSQ = 0, totalSQ = 0, eavesLF = 0, rakesLF = 0,
    ridgesLF = 0, valleysLF = 0, wallsLF = 0, pipes = 0,
    chimneys = 0, vents = 0, stories = 1, extraLayers = 0,
    redeckSheets = 0, soffitLF = 0, fasciaLF = 0, gutterLF = 0,
    sidingSqFt = 0, osbSheets = 0, windowCount = 0, doorCount = 0,
    wallSqFt = 0, windowSmall = 0, windowMedium = 0, windowLarge = 0,
    jChannelPieces = 0, outsideCorners = 0, insideCorners = 0,
    windowTrimPieces = 0, undersillPieces = 0, starterStripPieces = 0,
    dripCapPieces = 0
  } = measurements;

  const effectiveWallSqFt = wallSqFt || sidingSqFt;
  const effectiveOsbSheets = osbSheets || (effectiveWallSqFt > 0 ? Math.ceil(effectiveWallSqFt / 32) : 0);

  switch (itemKey) {
    // ── Roofing Materials ──
    case 'shingles': {
      const bps = config.bundles_per_sq || 3;
      return { qty: Math.ceil(totalSQ * bps), unit: 'bundle' };
    }
    case 'underlayment':
      return { qty: Math.ceil(totalSQ / 10), unit: 'roll' };
    case 'ice_water': {
      const iwLF = eavesLF + valleysLF;
      const iwSQ = Math.max(Math.ceil(iwLF / 100 * 2), Math.ceil(totalSQ * 0.15));
      return { qty: Math.ceil(iwSQ / 2), unit: 'roll' };
    }
    case 'starter':
      return { qty: Math.max(Math.ceil((eavesLF + rakesLF) / 120), 2), unit: 'bundle' };
    case 'ridge_cap':
      return { qty: Math.max(Math.ceil((ridgesLF || 30) / 30), 1), unit: 'bundle' };
    case 'drip_edge':
      return { qty: Math.max(Math.ceil((eavesLF + rakesLF) / 10), 4), unit: 'piece' };
    case 'valley_metal':
      return { qty: valleysLF > 0 ? Math.ceil(valleysLF / 10) : 0, unit: 'sheet' };
    case 'pipe_flashing':
      return { qty: pipes, unit: 'each' };
    case 'step_flashing':
      return { qty: wallsLF > 0 ? Math.ceil(wallsLF / 50) : 0, unit: 'bundle' };
    case 'ridge_vent':
      return { qty: 1, unit: 'each' };
    case 'nails':
      return { qty: Math.ceil(totalSQ / 15), unit: 'box' };
    case 'caulking':
      return { qty: 2, unit: 'tube' };

    // ── Roofing Labor ──
    case 'base_labor':
      return { qty: measuredSQ, unit: 'SQ' };
    case 'tearoff_labor':
      return { qty: measuredSQ, unit: 'SQ' };
    case 'extra_layer_labor':
      return { qty: measuredSQ * extraLayers, unit: 'SQ' };
    case 'cedar_tearoff_labor':
      return { qty: measuredSQ, unit: 'SQ' };
    case 'redeck_labor':
      return { qty: redeckSheets, unit: 'sheet' };
    case 'valley_labor':
      return { qty: valleysLF, unit: 'LF' };
    case 'ridge_vent_labor':
      return { qty: ridgesLF, unit: 'LF' };
    case 'pipe_labor':
      return { qty: pipes, unit: 'each' };
    case 'chimney_labor':
      return { qty: chimneys, unit: 'each' };
    case 'cricket_labor':
      return { qty: config.cricket ? 1 : 0, unit: 'each' };
    case 'vent_labor':
      return { qty: vents, unit: 'each' };

    // ── Metal Roofing ──
    case 'metal_panels':
      return { qty: Math.ceil(totalSQ * 100), unit: 'sqft' };
    case 'metal_strapping':
      return { qty: measuredSQ, unit: 'SQ' };

    // ── Flat Roofing ──
    case 'flat_membrane':
      return { qty: Math.ceil(totalSQ * 100), unit: 'sqft' };
    case 'flat_insulation':
      return { qty: Math.ceil(totalSQ * 100 / 32), unit: 'sheet' };
    case 'flat_adhesive':
      return { qty: Math.ceil(totalSQ / 5), unit: 'pail' };

    // ── Wall Assembly ──
    case 'strip_existing':
      return { qty: effectiveWallSqFt, unit: 'sqft' };
    case 'sheathing_inspection':
      return { qty: effectiveWallSqFt, unit: 'sqft' };
    case 'osb_substrate':
      return { qty: effectiveOsbSheets, unit: 'sheet' };
    case 'housewrap': {
      const coveragePerRoll = config.default === 'tyvek_drainwrap' ? 1125 : 900;
      return { qty: effectiveWallSqFt > 0 ? Math.ceil(effectiveWallSqFt / coveragePerRoll) : 0, unit: 'roll' };
    }
    case 'eps_foam':
      return { qty: effectiveWallSqFt > 0 ? Math.ceil(effectiveWallSqFt / 32) : 0, unit: 'sheet' };
    case 'ventigrid':
      return { qty: effectiveWallSqFt, unit: 'sqft' };
    case 'siding': {
      const material = config.material || config.default || 'vinyl_standard';
      if (material.startsWith('vinyl') || material === 'vinyl') {
        return { qty: effectiveWallSqFt > 0 ? Math.ceil((effectiveWallSqFt * 1.10) / 100) : 0, unit: 'square' };
      }
      return { qty: effectiveWallSqFt > 0 ? Math.ceil(effectiveWallSqFt * 1.10) : 0, unit: 'sqft' };
    }

    // ── Siding Accessories ──
    case 'j_channel':
      return { qty: jChannelPieces || Math.max(Math.ceil(soffitLF / 12) + (windowCount + doorCount) * 2, 4), unit: 'piece' };
    case 'corner_posts_outside':
      return { qty: outsideCorners || Math.max(stories * 4, 4), unit: 'piece' };
    case 'corner_posts_inside':
      return { qty: insideCorners || 0, unit: 'piece' };
    case 'window_trim':
      return { qty: windowTrimPieces || (windowCount + doorCount), unit: 'piece' };
    case 'undersill_trim':
      return { qty: undersillPieces || windowCount, unit: 'piece' };
    case 'starter_strip_siding': {
      const perimeterLF = effectiveWallSqFt > 0 ? Math.ceil(Math.sqrt(effectiveWallSqFt) * 4) : 0;
      return { qty: starterStripPieces || Math.ceil(perimeterLF / 12), unit: 'piece' };
    }
    case 'drip_cap':
      return { qty: dripCapPieces || (windowCount + doorCount), unit: 'piece' };

    // ── Exterior ──
    case 'soffit':
      return { qty: soffitLF, unit: 'LF' };
    case 'fascia':
      return { qty: fasciaLF, unit: 'LF' };
    case 'gutters':
      return { qty: gutterLF, unit: 'LF' };
    case 'leaf_guard':
      return { qty: gutterLF, unit: 'LF' };
    case 'window_capping':
      return { qty: windowCount, unit: 'each' };
    case 'door_capping':
      return { qty: doorCount, unit: 'each' };
    case 'window_replacement': {
      return { qty: windowSmall + windowMedium + windowLarge, unit: 'each' };
    }

    // ── Other ──
    case 'remediation':
      return { qty: 1, unit: 'allowance' };
    case 'disposal':
      return { qty: 1, unit: 'job' };
    case 'metal_trim':
      return { qty: effectiveWallSqFt > 0 ? Math.ceil(Math.sqrt(effectiveWallSqFt) * 4) : 0, unit: 'LF' };

    default:
      return { qty: 0, unit: 'each' };
  }
}


// ═══════════════════════════════════════════════════════════════
// LABOR COST RESOLVER (settings-aware)
// ═══════════════════════════════════════════════════════════════

function resolveLaborOrCalculatedCost(key, pitchTier, distanceKM, config, measurements, settings) {
  const r = settings.roofing;
  const e = settings.exterior;
  const sidingMaterial = config.material || config.default || 'vinyl';

  function getSidingType(m) {
    if (m.includes('hardie') || m.includes('fiber_cement')) return 'fiber_cement';
    if (m.includes('steel') || m.includes('metal')) return 'steel';
    if (m.includes('aluminum')) return 'aluminum';
    return 'vinyl';
  }

  switch (key) {
    // ── Roofing ──
    case 'base_labor':
      return (r.asphalt && r.asphalt[pitchTier]) || 130;
    case 'tearoff_labor':
      return (r.asphalt && r.asphalt[pitchTier]) || 130;
    case 'extra_layer_labor':
      return r.extra_layer || 40;
    case 'cedar_tearoff_labor':
      return r.cedar_tearoff || 70;
    case 'redeck_labor':
      return r.redecking || 30;
    case 'valley_labor':
      return r.valley_install || 1.50;
    case 'ridge_vent_labor':
      return r.ridge_vent_install || 2.00;
    case 'pipe_labor':
      return r.pipe_flashing || 20;
    case 'chimney_labor':
      return (config.chimneySize === 'large') ? (r.large_chimney_flashing || 350) : (r.small_chimney_flashing || 125);
    case 'cricket_labor':
      return r.cricket_construction || 150;
    case 'vent_labor':
      return r.max_vent_install || 50;
    case 'metal_labor':
      return (r.metal && r.metal[pitchTier]) || 250;
    case 'flat_labor':
      return (r.flat && r.flat[pitchTier]) || 100;
    case 'disposal':
      return getDisposalCost(distanceKM, settings);

    // ── Wall Assembly ──
    case 'strip_existing':
      return e.strip_existing || 1.50;
    case 'sheathing_inspection':
      return e.sheathing_inspection || 0.25;
    case 'osb_substrate':
      return (config.labor_per_sheet || e.osb_substrate || 30) + (config.material_per_sheet || 20);
    case 'housewrap':
      return 0; // Material from product resolver
    case 'eps_foam':
      return ((config.material_per_sqft || 0.85) + (config.labor_per_sqft || e.eps_foam_install || 0.40)) * 32;
    case 'ventigrid':
      return (config.material_per_sqft || 0.30) + (config.labor_per_sqft || e.ventigrid_install || 0.20);

    // ── Siding ──
    case 'siding': {
      const st = getSidingType(sidingMaterial);
      const rates = (e.siding_install && e.siding_install[st]) || { low: 5, mid: 6, high: 7 };
      return rates[config.quality || 'mid'] || rates.mid;
    }

    // ── Exterior ──
    case 'soffit':
      return (e.soffit && e.soffit[config.quality || 'mid']) || 35;
    case 'fascia':
      return (e.fascia && e.fascia[config.quality || 'mid']) || 25;
    case 'gutters':
      return (e.gutter && e.gutter[config.quality || 'mid']) || 26;
    case 'leaf_guard':
      return e.leaf_guard || 6;
    case 'window_capping':
      return e.window_capping || 75;
    case 'door_capping':
      return e.door_capping || 100;
    case 'metal_trim':
      return 8;

    // ── Accessories (priced from product DB) ──
    case 'j_channel':
    case 'corner_posts_outside':
    case 'corner_posts_inside':
    case 'window_trim':
    case 'undersill_trim':
    case 'starter_strip_siding':
    case 'drip_cap':
    case 'window_replacement':
      return 0;

    case 'remediation':
      return 0;
    default:
      return 0;
  }
}


// ═══════════════════════════════════════════════════════════════
// WINDOW REPLACEMENT — per-size sub-items
// ═══════════════════════════════════════════════════════════════

async function resolveWindowLineItems(supabase, tenantId, measurements, overrides, settings) {
  const { windowSmall = 0, windowMedium = 0, windowLarge = 0 } = measurements;
  const windowInstallRates = (settings.exterior && settings.exterior.window_install) || { small: 200, medium: 250, large: 350 };
  const items = [];

  const sizes = [
    { key: 'window_small', count: windowSmall, label: 'Window — Small (24x36)', productId: 'b0000000-0000-0000-0000-000000000090', laborDefault: windowInstallRates.small },
    { key: 'window_medium', count: windowMedium, label: 'Window — Medium (36x48)', productId: 'b0000000-0000-0000-0000-000000000091', laborDefault: windowInstallRates.medium },
    { key: 'window_large', count: windowLarge, label: 'Window — Large (48x60)', productId: 'b0000000-0000-0000-0000-000000000092', laborDefault: windowInstallRates.large }
  ];

  for (const sz of sizes) {
    if (sz.count <= 0) continue;
    const override = overrides[sz.key] || {};

    let supplyCost = 0;
    let laborCost = sz.laborDefault;
    let priceSource = 'default';
    let sourceDetail = '';

    if (override.unit_cost !== undefined) {
      supplyCost = override.unit_cost;
      priceSource = 'override';
      sourceDetail = 'Manual override';
    } else {
      const resolved = await resolvePrice(supabase, sz.productId, tenantId);
      supplyCost = resolved.price;
      priceSource = resolved.source;
      sourceDetail = resolved.detail;
      if (resolved.laborRate) laborCost = resolved.laborRate;
    }

    const unitCost = supplyCost + laborCost;
    items.push({
      item_key: sz.key,
      category: 'materials',
      label: sz.label,
      config: { supply: supplyCost, labor: laborCost },
      quantity: sz.count,
      unit: 'each',
      unit_cost: unitCost,
      total_cost: Math.round(sz.count * unitCost * 100) / 100,
      price_source: priceSource,
      source_product_id: sz.productId,
      source_detail: `Supply: $${supplyCost} + Labor: $${laborCost}. ${sourceDetail}`,
      is_override: priceSource === 'override',
      included: true,
      estimated: priceSource !== 'merchant',
      sort_order: 800
    });
  }
  return items;
}


// ═══════════════════════════════════════════════════════════════
// MOBILIZATION DISCOUNT CALCULATOR
// "While we're already here" phased upsell pricing
// ═══════════════════════════════════════════════════════════════

export function calculateMobilizationDiscount(baseJobPrice, addOnPrice, settings) {
  const rules = settings.mobilization;
  if (!rules || !rules.enabled) return null;

  for (const tier of rules.tiers) {
    const min = tier.add_on_min || 0;
    const max = tier.add_on_max || Infinity;
    if (addOnPrice >= min && addOnPrice < max) {
      const discountAmt = Math.round(addOnPrice * (tier.discount_pct / 100));
      return {
        eligible: true,
        discountPct: tier.discount_pct,
        discountAmount: discountAmt,
        discountedPrice: addOnPrice - discountAmt,
        label: rules.discount_label,
        framing: rules.framing,
        note: tier.note,
        bundledTotal: baseJobPrice + addOnPrice - discountAmt
      };
    }
  }
  return { eligible: false };
}


// ═══════════════════════════════════════════════════════════════
// SIDING PRODUCT RESOLVER
// ═══════════════════════════════════════════════════════════════

function resolveSidingProductId(config, userChoice) {
  const choice = userChoice || config.default || 'vinyl_standard';
  if (config.product_map && config.product_map[choice]) {
    return config.product_map[choice];
  }
  return null;
}


// ═══════════════════════════════════════════════════════════════
// MAIN QUOTE CALCULATOR v3
// Unified: Materials + Labor + Multiplier (all systems)
// ═══════════════════════════════════════════════════════════════

export async function calculateQuoteV3(supabase, {
  tenantId,
  offerId,
  measurements = {},
  overrides = {},
  choices = {},
  mode = 'advanced'
}) {
  // 1. Load offer + tenant settings in parallel
  let offerResult, settings;
  try {
    [offerResult, settings] = await Promise.all([
      supabase.from('offers').select('*').eq('id', offerId).single(),
      loadTenantSettings(supabase, tenantId)
    ]);
  } catch (e) {
    return { error: 'Failed to load offer or settings' };
  }

  const { data: offer, error: offerErr } = offerResult;
  if (offerErr || !offer) return { error: 'Offer not found' };

  // Pre-fetch all product prices in batch (2 queries instead of N*3)
  const scopeTemplate = offer.scope_template || [];
  const allProductIds = scopeTemplate.map(t => t.product_id).filter(Boolean);
  const priceCache = await resolvePricesBatch(supabase, allProductIds, tenantId);

  // 2. Calculate roof metrics
  const pitch = measurements.pitch || '5/12';
  const sqft = measurements.squareFeet || 0;
  const complexity = measurements.complexity || 'medium';
  const distanceKM = measurements.distanceKM || 0;

  const pitchMult = PITCH_MULTIPLIERS[pitch] || 1.083;
  const adjustedSqFt = sqft * pitchMult;
  const measuredSQ = sqft > 0 ? Math.ceil(adjustedSqFt / 100) : 0;
  const wastePct = WASTE_FACTORS[complexity] || 0.15;
  const totalSQ = measuredSQ > 0 ? Math.ceil(measuredSQ * (1 + wastePct)) : 0;
  const projectType = getProjectType(distanceKM, settings);
  const pitchTier = getLaborPitchTier(pitch);
  const roofWorkdays = measuredSQ > 0 ? Math.ceil(measuredSQ / settings.crewSqPerDay) : 0;

  const wallSqFt = measurements.wallSqFt || measurements.sidingSqFt || 0;
  const exteriorWorkdays = wallSqFt > 0 ? Math.ceil(wallSqFt / settings.crewExteriorSqftPerDay) : 0;
  const effectiveWorkdays = Math.max(roofWorkdays, exteriorWorkdays) || 1;

  const fullMeasurements = {
    measuredSQ, totalSQ, pitchTier,
    eavesLF: measurements.eavesLF || 0,
    rakesLF: measurements.rakesLF || 0,
    ridgesLF: measurements.ridgesLF || 0,
    valleysLF: measurements.valleysLF || 0,
    wallsLF: measurements.wallsLF || 0,
    pipes: measurements.pipes || 0,
    chimneys: measurements.chimneys || 0,
    vents: measurements.vents || 0,
    stories: measurements.stories || 1,
    extraLayers: measurements.extraLayers || 0,
    redeckSheets: measurements.redeckSheets || 0,
    soffitLF: measurements.soffitLF || 0,
    fasciaLF: measurements.fasciaLF || 0,
    gutterLF: measurements.gutterLF || 0,
    sidingSqFt: measurements.sidingSqFt || 0,
    osbSheets: measurements.osbSheets || 0,
    windowCount: measurements.windowCount || 0,
    doorCount: measurements.doorCount || 0,
    wallSqFt,
    windowSmall: measurements.windowSmall || 0,
    windowMedium: measurements.windowMedium || 0,
    windowLarge: measurements.windowLarge || 0,
    jChannelPieces: measurements.jChannelPieces || 0,
    outsideCorners: measurements.outsideCorners || 0,
    insideCorners: measurements.insideCorners || 0,
    windowTrimPieces: measurements.windowTrimPieces || 0,
    undersillPieces: measurements.undersillPieces || 0,
    starterStripPieces: measurements.starterStripPieces || 0,
    dripCapPieces: measurements.dripCapPieces || 0
  };

  // 3. Resolve each line item from scope template
  const lineItems = [];
  let hardCost = 0;
  let hasEstimatedPricing = false;

  for (const tmpl of scopeTemplate) {
    const key = tmpl.key;
    const override = overrides[key] || {};
    const config = {
      ...(tmpl.config || {}),
      ...(override.config || {}),
      chimneySize: measurements.chimneySize,
      cricket: measurements.cricket
    };

    // Decision point gating
    if (config.decision_point && override.included === false) {
      lineItems.push({
        item_key: key, category: tmpl.category, label: tmpl.label,
        config, quantity: 0, unit: 'each', unit_cost: 0, total_cost: 0,
        price_source: 'calculated', included: false, sort_order: scopeTemplate.indexOf(tmpl),
        notes: 'Decision point — skipped by user'
      });
      continue;
    }

    // Configurable siding
    let effectiveProductId = tmpl.product_id || null;
    if (key === 'siding' && config.product_map) {
      const sidingChoice = choices.siding || config.default;
      effectiveProductId = resolveSidingProductId(config, sidingChoice);
      config.material = sidingChoice;
    }

    // Configurable housewrap
    if (key === 'housewrap' && config.options) {
      const wrapChoice = choices.housewrap || config.default || 'tyvek_standard';
      effectiveProductId = wrapChoice === 'tyvek_drainwrap'
        ? 'b0000000-0000-0000-0000-000000000061'
        : 'b0000000-0000-0000-0000-000000000060';
      config.default = wrapChoice;
    }

    // Window replacement: expand into per-size sub-items
    if (key === 'window_replacement') {
      const totalWindows = (measurements.windowSmall || 0) + (measurements.windowMedium || 0) + (measurements.windowLarge || 0);
      if (totalWindows > 0) {
        const windowItems = await resolveWindowLineItems(supabase, tenantId, measurements, overrides, settings);
        for (const wi of windowItems) {
          lineItems.push(wi);
          if (wi.included) hardCost += wi.total_cost;
          if (wi.estimated) hasEstimatedPricing = true;
        }
      }
      continue;
    }

    // Calculate quantity
    let { qty, unit } = calculateQuantities(key, fullMeasurements, config);
    if (override.quantity !== undefined) qty = override.quantity;

    if (qty === 0 && !tmpl.required) continue;

    // Resolve unit cost
    let unitCost = 0;
    let priceSource = 'default';
    let sourceDetail = '';
    let estimated = false;

    if (override.unit_cost !== undefined) {
      unitCost = override.unit_cost;
      priceSource = 'override';
      sourceDetail = 'Manual override';
    } else if (effectiveProductId) {
      // Use batch-cached price, fall back to single resolve for dynamic product IDs
      const resolved = priceCache[effectiveProductId] || await resolvePrice(supabase, effectiveProductId, tenantId);
      unitCost = resolved.price;
      priceSource = resolved.source;
      sourceDetail = resolved.detail;
      estimated = resolved.estimated || false;

      // Wall assembly items: add labor from scope template config on top of material price
      if (config.labor_per_sheet) {
        // OSB substrate: material from DB + labor from config
        unitCost = resolved.price + (config.labor_per_sheet || 0);
        sourceDetail += ` + labor $${config.labor_per_sheet}/sheet`;
      } else if (config.labor_per_sqft !== undefined) {
        // VentiGrid, EPS: material from config + labor from config (priced per sqft, not per unit)
        // These items have material_per_sqft + labor_per_sqft in config
        const matPerSqft = config.material_per_sqft || 0;
        const labPerSqft = config.labor_per_sqft || 0;
        if (matPerSqft > 0 || labPerSqft > 0) {
          if (unit === 'sqft') {
            // VentiGrid: priced per sqft directly
            unitCost = matPerSqft + labPerSqft;
            sourceDetail = `Material $${matPerSqft}/sqft + labor $${labPerSqft}/sqft (SOP rates)`;
            priceSource = 'calculated';
            estimated = false;
          } else if (unit === 'sheet') {
            // EPS foam: priced per sheet (32 sqft/sheet)
            const sqftPerSheet = 32;
            unitCost = (matPerSqft + labPerSqft) * sqftPerSheet;
            sourceDetail = `($${matPerSqft} + $${labPerSqft})/sqft × ${sqftPerSheet} sqft/sheet (SOP rates)`;
            priceSource = 'calculated';
            estimated = false;
          }
        }
      } else if (key === 'siding' && resolved.laborRate) {
        unitCost = resolved.price + resolved.laborRate;
        sourceDetail += ` + labor $${resolved.laborRate}/sqft`;
      }
    } else {
      unitCost = resolveLaborOrCalculatedCost(key, pitchTier, distanceKM, config, fullMeasurements, settings);
      priceSource = 'calculated';
      sourceDetail = 'Tenant labor rates';
    }

    const totalCost = Math.round(qty * unitCost * 100) / 100;
    const included = override.included !== undefined ? override.included : (qty > 0);
    if (estimated) hasEstimatedPricing = true;

    lineItems.push({
      item_key: key, category: tmpl.category, label: tmpl.label,
      config, quantity: qty, unit, unit_cost: unitCost, total_cost: totalCost,
      price_source: priceSource,
      source_product_id: effectiveProductId,
      source_detail: sourceDetail,
      is_override: priceSource === 'override',
      original_cost: priceSource === 'override' ? null : unitCost,
      included, estimated,
      sort_order: scopeTemplate.indexOf(tmpl),
      notes: override.notes || null
    });

    if (included) hardCost += totalCost;
  }

  // 4. Auto-calculated add-ons

  // Distance adder
  const distAdder = getDistanceAdder(distanceKM, settings);
  if (distAdder > 0 && measuredSQ > 0) {
    const distCost = measuredSQ * distAdder;
    lineItems.push({
      item_key: 'distance_adder', category: 'labor',
      label: `Distance adder (${distanceKM} km)`,
      config: {}, quantity: measuredSQ, unit: 'SQ', unit_cost: distAdder,
      total_cost: distCost, price_source: 'calculated', included: true, sort_order: 900
    });
    hardCost += distCost;
  }

  // Overhead for remote
  let projectOverhead = 0;
  if (projectType !== 'local' && effectiveWorkdays > 0) {
    projectOverhead = settings.dailyOverhead * effectiveWorkdays;
    lineItems.push({
      item_key: 'project_overhead', category: 'overhead',
      label: `Daily overhead (${effectiveWorkdays} days @ $${settings.dailyOverhead})`,
      config: {}, quantity: effectiveWorkdays, unit: 'day',
      unit_cost: settings.dailyOverhead, total_cost: projectOverhead,
      price_source: 'calculated', included: true, sort_order: 910
    });
    hardCost += projectOverhead;
  }

  // Warranty adder
  const warrantyAdder = (offer.warranty_adder_per_sq || 0) * measuredSQ;
  if (warrantyAdder > 0) {
    lineItems.push({
      item_key: 'warranty', category: 'warranty',
      label: `${offer.warranty_years}-year warranty adder`,
      config: {}, quantity: measuredSQ, unit: 'SQ',
      unit_cost: offer.warranty_adder_per_sq, total_cost: warrantyAdder,
      price_source: 'calculated', included: true, sort_order: 920
    });
    hardCost += warrantyAdder;
  }

  // Remediation
  const remItem = lineItems.find(li => li.item_key === 'remediation' && li.included);
  if (remItem) {
    const remAllowance = getRemediationAllowance(hardCost, settings);
    remItem.unit_cost = remAllowance;
    remItem.total_cost = remAllowance;
    remItem.source_detail = `Scaled: $${Math.round(hardCost)} hard cost → $${remAllowance}`;
    hardCost += remAllowance;
  }

  // 5. Unified pricing: Materials + Labor + Multiplier
  const multipliers = offer.multipliers || {};
  const multiplier = multipliers[projectType] || 1.47;
  let sellingPrice = roundToNearest(hardCost * multiplier, settings.priceRounding);

  // Margin floor
  const marginFloor = (offer.margin_floor || 10) / 100;
  let marginProtected = false;
  const actualMargin = sellingPrice > 0 ? (sellingPrice - hardCost) / sellingPrice : 0;
  if (actualMargin < marginFloor) {
    sellingPrice = roundToNearest(hardCost / (1 - marginFloor), settings.priceRounding);
    marginProtected = true;
  }

  const hst = Math.round(sellingPrice * settings.taxRate * 100) / 100;
  const totalWithTax = Math.round((sellingPrice + hst) * 100) / 100;
  const netMargin = sellingPrice > 0
    ? Math.round(((sellingPrice - hardCost) / sellingPrice) * 1000) / 10
    : 0;

  // Category subtotals
  const categorySums = {};
  for (const li of lineItems) {
    if (!li.included) continue;
    const cat = li.category || 'other';
    categorySums[cat] = (categorySums[cat] || 0) + li.total_cost;
  }

  return {
    type: 'quote_v3',
    offer: {
      id: offer.id, name: offer.name, slug: offer.slug,
      system: offer.system, badge: offer.badge,
      warranty_years: offer.warranty_years,
      pricing_method: 'multiplier' // unified
    },
    measurements: {
      input_sqft: sqft, wallSqFt, pitch,
      pitchMultiplier: pitchMult, complexity,
      measuredSQ, totalSQ_withWaste: totalSQ,
      workdays: effectiveWorkdays, projectType, distanceKM
    },
    choices,
    lineItems,
    summary: {
      byCategory: Object.fromEntries(
        Object.entries(categorySums).map(([k, v]) => [k, Math.round(v * 100) / 100])
      ),
      hardCost: Math.round(hardCost * 100) / 100,
      multiplier,
      sellingPrice,
      tax: hst,
      taxLabel: settings.taxLabel,
      totalWithTax,
      pricePerSQ: measuredSQ > 0 ? Math.round(sellingPrice / measuredSQ) : null,
      pricePerSqFt: wallSqFt > 0 ? Math.round(sellingPrice / wallSqFt * 100) / 100 : null,
      netMargin: `${netMargin}%`,
      marginProtected,
      hasEstimatedPricing,
      estimatedNote: hasEstimatedPricing ? '* Some line items use estimated regional pricing — verify with supplier before quoting.' : null
    },
    mode,
    calculatedAt: new Date().toISOString()
  };
}


// ═══════════════════════════════════════════════════════════════
// MULTI-OFFER QUOTE
// ═══════════════════════════════════════════════════════════════

export async function calculateMultiOfferQuote(supabase, {
  tenantId, offerIds, measurements, overrides = {}, choices = {}
}) {
  // Run all offer calculations in parallel
  const promises = offerIds.map(offerId =>
    calculateQuoteV3(supabase, {
      tenantId, offerId, measurements,
      overrides: overrides[offerId] || {},
      choices: choices[offerId] || choices,
      mode: 'advanced'
    })
  );
  const allResults = await Promise.all(promises);

  const results = {};
  for (const result of allResults) {
    if (!result.error) results[result.offer.slug] = result;
  }
  return { type: 'multi_offer_quote', offers: results, measurements, calculatedAt: new Date().toISOString() };
}


// ═══════════════════════════════════════════════════════════════
// LINE ITEM PERSISTENCE
// ═══════════════════════════════════════════════════════════════

export async function persistLineItems(supabase, { estimateId, tenantId, offerId, lineItems }) {
  await supabase
    .from('quote_line_items').delete()
    .eq('estimate_id', estimateId).eq('tenant_id', tenantId).eq('offer_id', offerId);

  const rows = lineItems.map(li => ({
    estimate_id: estimateId, tenant_id: tenantId, offer_id: offerId,
    item_key: li.item_key, category: li.category, label: li.label,
    config: li.config || {}, quantity: li.quantity, unit: li.unit,
    unit_cost: li.unit_cost, total_cost: li.total_cost,
    price_source: li.price_source || 'default',
    source_merchant_id: li.source_merchant_id || null,
    source_product_id: li.source_product_id || null,
    source_detail: li.source_detail || null,
    is_override: li.is_override || false,
    original_cost: li.original_cost || null,
    included: li.included !== false,
    sort_order: li.sort_order || 0,
    notes: li.notes || null
  }));

  const { data, error } = await supabase.from('quote_line_items').insert(rows).select('id');
  if (error) return { error: error.message, saved: 0 };
  return { saved: rows.length, ids: data.map(r => r.id) };
}


// ═══════════════════════════════════════════════════════════════
// MATERIAL LIST GENERATOR
// ═══════════════════════════════════════════════════════════════

export function generateMaterialList(quoteResult) {
  const materials = quoteResult.lineItems
    .filter(li => li.included && li.category === 'materials')
    .map(li => ({
      item: li.label, quantity: li.quantity, unit: li.unit,
      unitCost: li.unit_cost, totalCost: li.total_cost,
      source: li.source_detail || 'TBD',
      priceSource: li.price_source,
      estimated: li.estimated || false,
      confidence: li.price_source === 'merchant' ? 'verified' :
                  li.price_source === 'regional' ? 'estimated' : 'default'
    }));

  return {
    type: 'material_list',
    offer: quoteResult.offer.name,
    items: materials,
    totalMaterialCost: Math.round(materials.reduce((s, m) => s + m.totalCost, 0) * 100) / 100,
    itemCount: materials.length,
    verifiedCount: materials.filter(m => m.confidence === 'verified').length,
    estimatedCount: materials.filter(m => m.confidence === 'estimated').length,
    generatedAt: new Date().toISOString()
  };
}
