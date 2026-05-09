// Plus Ultra Roofing — Quote Calculation Engine
// Source: 2026 Sales Folder / Claude / 2026 Pricing Formula.docx (April 2026)
//        2026 Sales Folder / Internal Material Pricing Sheet.docx
//        2026 Sales Folder / Out of Town Pricing Formula.docx
//        2026 Sales Folder / Estimating and Pricing Formula.docx
//
// All prices in CAD. 1 SQ = 100 sq ft.
// Labor is calculated on MEASURED area (before waste).
// Materials are calculated on area WITH waste.

// ═══════════════════════════════════════════
// PITCH MULTIPLIERS (area adjustment)
// ═══════════════════════════════════════════
const PITCH_MULTIPLIERS = {
  '4/12': 1.054, '5/12': 1.083, '6/12': 1.118, '7/12': 1.158,
  '8/12': 1.202, '9/12': 1.250, '10/12': 1.302, '11/12': 1.357,
  '12/12': 1.414, '13/12': 1.474, '14/12': 1.537
};

// ═══════════════════════════════════════════
// ASPHALT LABOR (on measured SQ, before waste)
// ═══════════════════════════════════════════
function getAsphaltLaborRate(pitch) {
  const p = parseInt(pitch.split('/')[0]);
  if (p <= 6) return 130;      // flat/low
  if (p <= 9) return 160;      // moderate
  return 190;                   // steep (10/12+)
}

const LABOR_ADDERS = {
  extraLayer: 40,        // per SQ per additional layer
  cedarTearoff: 70,      // per SQ
  redecking: 30,         // per sheet (~$30 material + $30 labor = $60 total, but labor portion only here)
  valleyInstall: 1.50,   // per LF
  ridgeVentInstall: 2.00,// per LF (auto-applied to all ridge)
  pipeFlashing: 20,      // per penetration
  chimneyReflashing: 450,// per penetration
  maxVentInstall: 50,    // per vent
  smallChimneyFlashing: 125,
  largeChimneyFlashing: 350,
  cricketConstruction: 150
};

// ═══════════════════════════════════════════
// DISTANCE ADDERS
// ═══════════════════════════════════════════
function getDistanceAdder(distanceKM) {
  if (distanceKM <= 20) return 0;
  if (distanceKM <= 60) return 20;  // per SQ
  return 40;                         // per SQ
}

function getProjectType(distanceKM) {
  if (distanceKM <= 20) return 'local';
  if (distanceKM <= 60) return 'dayTrip';
  return 'extendedStay';
}

// ═══════════════════════════════════════════
// PACKAGE MULTIPLIERS (asphalt)
// ═══════════════════════════════════════════
const ASPHALT_MULTIPLIERS = {
  local:        { gold: 1.47, platinum: 1.52, diamond: 1.58 },
  dayTrip:      { gold: 1.62, platinum: 1.67, diamond: 1.74 },
  extendedStay: { gold: 1.22, platinum: 1.27, diamond: 1.33 }
};

const MARGIN_FLOORS = { gold: 0.10, platinum: 0.15, diamond: 0.20 };

// ═══════════════════════════════════════════
// WARRANTY ADDERS (added to hard cost before multiplier)
// ═══════════════════════════════════════════
const WARRANTY_ADDERS = { gold: 0, platinum: 25, diamond: 50 }; // per SQ

// ═══════════════════════════════════════════
// MATERIAL COSTS (Gold package baseline)
// ═══════════════════════════════════════════
const GOLD_MATERIALS = {
  shingles:      { price: 49, bundlesPerSQ: 3, desc: 'CertainTeed Landmark @ $49/bundle x 3' },
  underlayment:  { price: 125, coverageSQ: 10, desc: 'Synthetic underlayment @ $125/roll (10 SQ)' },
  iceAndWater:   { price: 116, coverageSQ: 2, desc: 'Standard I&W @ $116/roll (2 SQ)' },
  starter:       { price: 52, coverageLF: 120, desc: 'Starter strip @ $52/bundle (120 LF)' },
  ridgeCap:      { price: 55, coverageLF: 30, desc: 'Hip & Ridge cap @ $55/bundle (30 LF)' },
  dripEdge:      { price: 17.99, coverageLF: 10, desc: 'Aluminum drip edge 3" @ $17.99/piece (10 LF)' },
  pipeFlashing:  { price: 20, desc: 'Pipe flashing @ $20 each' },
  stepFlashing:  { price: 100, coverageLF: 50, desc: 'Step flashing bundle @ $100 (50 LF)' },
  coilNails:     { price: 57, desc: 'Roofing coil nails @ $57/box' },
  caulking:      { price: 12, desc: 'Caulking @ $12/tube' },
  ridgeVent:     { price: 125, desc: 'Ridge vent @ $125' }
};

const PLATINUM_MATERIALS = {
  shingles:      { price: 55, bundlesPerSQ: 3, desc: 'CertainTeed Landmark PRO @ $55/bundle x 3' },
  underlayment:  { price: 167, coverageSQ: 10, desc: 'Premium synthetic @ $167/roll (10 SQ)' },
  iceAndWater:   { price: 178, coverageSQ: 2, desc: 'Grace I&W @ $178/roll (2 SQ)' },
  valleyMetal:   { price: 32, coverageLF: 10, desc: 'Standard metal valley @ $32/sheet (10 LF)' }
};

const DIAMOND_MATERIALS = {
  shingles:      { price: 90, bundlesPerSQ: 4, desc: 'CertainTeed Presidential @ $90/bundle x 4' },
  underlayment:  { price: 167, coverageSQ: 10, desc: 'Premium synthetic @ $167/roll (10 SQ)' },
  iceAndWater:   { price: 178, coverageSQ: 2, desc: 'Grace I&W @ $178/roll (2 SQ)' }
};

// ═══════════════════════════════════════════
// DISPOSAL
// ═══════════════════════════════════════════
function getDisposalCost(distanceKM) {
  if (distanceKM <= 20) return 350;
  if (distanceKM <= 50) return 450;
  return 550;
}

// ═══════════════════════════════════════════
// DAILY OVERHEAD (for remote projects)
// ═══════════════════════════════════════════
const DAILY_OVERHEAD = 90; // $1,975/mo / 22 days
const CREW_SQ_PER_DAY = 12;
const HST_RATE = 0.15;

// ═══════════════════════════════════════════
// MATERIAL CALCULATOR
// ═══════════════════════════════════════════
function calculateMaterials(totalSQ, measuredSQ, pkg, eavesLF, rakesLF, ridgesLF, valleysLF, pipes, wallsLF) {
  const mats = pkg === 'diamond' ? DIAMOND_MATERIALS : pkg === 'platinum' ? PLATINUM_MATERIALS : GOLD_MATERIALS;
  const items = [];
  let total = 0;

  // Shingles
  const shingleBundles = Math.ceil(totalSQ * mats.shingles.bundlesPerSQ);
  const shingleCost = shingleBundles * mats.shingles.price;
  items.push({ item: mats.shingles.desc, qty: shingleBundles, unit: 'bundles', cost: shingleCost });
  total += shingleCost;

  // Underlayment
  const underlayRolls = Math.ceil(totalSQ / (mats.underlayment?.coverageSQ || GOLD_MATERIALS.underlayment.coverageSQ));
  const underlayPrice = mats.underlayment?.price || GOLD_MATERIALS.underlayment.price;
  const underlayCost = underlayRolls * underlayPrice;
  items.push({ item: (mats.underlayment || GOLD_MATERIALS.underlayment).desc, qty: underlayRolls, unit: 'rolls', cost: underlayCost });
  total += underlayCost;

  // Ice & Water — covers eaves + valleys, 2 SQ per roll
  const iwLF = (eavesLF || 0) + (valleysLF || 0);
  const iwSQ = Math.max(Math.ceil(iwLF / 100 * 2), Math.ceil(totalSQ * 0.15)); // minimum ~15% of roof
  const iwRolls = Math.ceil(iwSQ / (mats.iceAndWater?.coverageSQ || GOLD_MATERIALS.iceAndWater.coverageSQ));
  const iwPrice = mats.iceAndWater?.price || GOLD_MATERIALS.iceAndWater.price;
  const iwCost = iwRolls * iwPrice;
  items.push({ item: (mats.iceAndWater || GOLD_MATERIALS.iceAndWater).desc, qty: iwRolls, unit: 'rolls', cost: iwCost });
  total += iwCost;

  // Starter
  const starterLF = (eavesLF || 0) + (rakesLF || 0);
  const starterBundles = Math.max(Math.ceil(starterLF / 120), 2);
  const starterCost = starterBundles * GOLD_MATERIALS.starter.price;
  items.push({ item: GOLD_MATERIALS.starter.desc, qty: starterBundles, unit: 'bundles', cost: starterCost });
  total += starterCost;

  // Ridge cap
  const ridgeBundles = Math.max(Math.ceil((ridgesLF || 30) / 30), 1);
  const ridgeCost = ridgeBundles * GOLD_MATERIALS.ridgeCap.price;
  items.push({ item: GOLD_MATERIALS.ridgeCap.desc, qty: ridgeBundles, unit: 'bundles', cost: ridgeCost });
  total += ridgeCost;

  // Drip edge
  const dripLF = (eavesLF || 0) + (rakesLF || 0);
  const dripPieces = Math.max(Math.ceil(dripLF / 10), 4);
  const dripCost = dripPieces * GOLD_MATERIALS.dripEdge.price;
  items.push({ item: GOLD_MATERIALS.dripEdge.desc, qty: dripPieces, unit: 'pieces', cost: Math.round(dripCost * 100) / 100 });
  total += dripCost;

  // Pipe flashing
  if (pipes > 0) {
    const pipeCost = pipes * GOLD_MATERIALS.pipeFlashing.price;
    items.push({ item: GOLD_MATERIALS.pipeFlashing.desc, qty: pipes, unit: 'each', cost: pipeCost });
    total += pipeCost;
  }

  // Step flashing (wall flashing)
  if (wallsLF > 0) {
    const stepBundles = Math.ceil(wallsLF / 50);
    const stepCost = stepBundles * GOLD_MATERIALS.stepFlashing.price;
    items.push({ item: GOLD_MATERIALS.stepFlashing.desc, qty: stepBundles, unit: 'bundles', cost: stepCost });
    total += stepCost;
  }

  // Platinum: metal valleys
  if (pkg !== 'gold' && valleysLF > 0 && PLATINUM_MATERIALS.valleyMetal) {
    const vSheets = Math.ceil(valleysLF / 10);
    const vCost = vSheets * PLATINUM_MATERIALS.valleyMetal.price;
    items.push({ item: PLATINUM_MATERIALS.valleyMetal.desc, qty: vSheets, unit: 'sheets', cost: vCost });
    total += vCost;
  }

  // Ridge vent
  items.push({ item: GOLD_MATERIALS.ridgeVent.desc, qty: 1, unit: 'each', cost: GOLD_MATERIALS.ridgeVent.price });
  total += GOLD_MATERIALS.ridgeVent.price;

  // Nails + caulking
  const nailBoxes = Math.ceil(totalSQ / 15);
  items.push({ item: GOLD_MATERIALS.coilNails.desc, qty: nailBoxes, unit: 'boxes', cost: nailBoxes * GOLD_MATERIALS.coilNails.price });
  total += nailBoxes * GOLD_MATERIALS.coilNails.price;

  items.push({ item: GOLD_MATERIALS.caulking.desc, qty: 2, unit: 'tubes', cost: 24 });
  total += 24;

  return { items, total: Math.round(total * 100) / 100 };
}

// ═══════════════════════════════════════════
// MAIN QUOTE CALCULATOR
// ═══════════════════════════════════════════

/**
 * @param {Object} spec
 * @param {number} spec.squareFeet       - 2D roof area in sq ft
 * @param {string} [spec.pitch]          - e.g. '6/12' (default '5/12')
 * @param {string} [spec.complexity]     - 'simple'|'medium'|'complex' (waste: 10%/15%/20%)
 * @param {boolean} [spec.newConstruction]
 * @param {number} [spec.extraLayers]    - layers beyond first to remove
 * @param {number} [spec.chimneys]       - chimney reflashing count
 * @param {string} [spec.chimneySize]    - 'small'|'large' (default 'small')
 * @param {boolean} [spec.cricket]       - chimney cricket needed
 * @param {number} [spec.valleysLF]
 * @param {number} [spec.wallsLF]        - step flashing LF
 * @param {number} [spec.eavesLF]
 * @param {number} [spec.rakesLF]
 * @param {number} [spec.ridgesLF]
 * @param {number} [spec.pipes]          - pipe penetrations
 * @param {number} [spec.vents]          - maximum vents to install
 * @param {number} [spec.distanceKM]     - from Riverview
 * @param {number} [spec.stories]
 * @param {number} [spec.redeckSheets]   - OSB sheets to replace
 * @param {boolean} [spec.cedarTearoff]
 * @param {string} [spec.package]        - 'gold'|'platinum'|'diamond' (default: all three)
 */
export function calculateQuote(spec) {
  const {
    squareFeet, pitch = '5/12', complexity = 'medium',
    newConstruction = false, extraLayers = 0, chimneys = 0,
    chimneySize = 'small', cricket = false,
    valleysLF = 0, wallsLF = 0, eavesLF = 0, rakesLF = 0, ridgesLF = 0,
    pipes = 0, vents = 0, distanceKM = 0, stories = 1,
    redeckSheets = 0, cedarTearoff = false
  } = spec;

  if (!squareFeet || squareFeet <= 0) {
    return { error: 'squareFeet is required and must be > 0' };
  }

  // Step 1: Pitch-adjust the area
  const multiplier = PITCH_MULTIPLIERS[pitch] || 1.083;
  const adjustedSqFt = squareFeet * multiplier;

  // Measured SQ (before waste) — used for LABOR
  const measuredSQ = Math.ceil(adjustedSqFt / 100);

  // Step 2: Apply waste factor — used for MATERIALS
  const wasteFactors = { simple: 0.10, medium: 0.15, complex: 0.20 };
  const wastePct = wasteFactors[complexity] || 0.15;
  const totalSQ = Math.ceil(measuredSQ * (1 + wastePct));

  // Step 3: Project type
  const projectType = getProjectType(distanceKM);
  const distanceAdder = getDistanceAdder(distanceKM);
  const disposalCost = getDisposalCost(distanceKM);

  // Step 4: Labor calculation (on measuredSQ)
  const baseLaborRate = getAsphaltLaborRate(pitch);
  const laborItems = [];
  let laborTotal = 0;

  // Base labor
  const baseLaborCost = measuredSQ * baseLaborRate;
  laborItems.push({ item: `Base install labor (${pitch} pitch)`, qty: measuredSQ, unit: 'SQ', rate: baseLaborRate, cost: baseLaborCost });
  laborTotal += baseLaborCost;

  // Extra layers
  if (extraLayers > 0 && !newConstruction) {
    const layerCost = measuredSQ * LABOR_ADDERS.extraLayer * extraLayers;
    laborItems.push({ item: `Extra layer tear-off (${extraLayers} layers)`, qty: measuredSQ, unit: 'SQ', rate: LABOR_ADDERS.extraLayer * extraLayers, cost: layerCost });
    laborTotal += layerCost;
  }

  // Cedar tearoff
  if (cedarTearoff) {
    const cedarCost = measuredSQ * LABOR_ADDERS.cedarTearoff;
    laborItems.push({ item: 'Cedar tear-off', qty: measuredSQ, unit: 'SQ', rate: LABOR_ADDERS.cedarTearoff, cost: cedarCost });
    laborTotal += cedarCost;
  }

  // Redecking
  if (redeckSheets > 0) {
    const redeckCost = redeckSheets * LABOR_ADDERS.redecking;
    laborItems.push({ item: 'Redecking labor', qty: redeckSheets, unit: 'sheets', rate: LABOR_ADDERS.redecking, cost: redeckCost });
    laborTotal += redeckCost;
  }

  // Valley install
  if (valleysLF > 0) {
    const valleyCost = valleysLF * LABOR_ADDERS.valleyInstall;
    laborItems.push({ item: 'Valley install', qty: valleysLF, unit: 'LF', rate: LABOR_ADDERS.valleyInstall, cost: valleyCost });
    laborTotal += valleyCost;
  }

  // Ridge vent install
  if (ridgesLF > 0) {
    const rvCost = ridgesLF * LABOR_ADDERS.ridgeVentInstall;
    laborItems.push({ item: 'Ridge vent install', qty: ridgesLF, unit: 'LF', rate: LABOR_ADDERS.ridgeVentInstall, cost: rvCost });
    laborTotal += rvCost;
  }

  // Pipe flashing install
  if (pipes > 0) {
    const pipeCost = pipes * LABOR_ADDERS.pipeFlashing;
    laborItems.push({ item: 'Pipe flashing install', qty: pipes, unit: 'each', rate: LABOR_ADDERS.pipeFlashing, cost: pipeCost });
    laborTotal += pipeCost;
  }

  // Chimney work
  if (chimneys > 0) {
    const chRate = chimneySize === 'large' ? LABOR_ADDERS.largeChimneyFlashing : LABOR_ADDERS.smallChimneyFlashing;
    const chCost = chimneys * chRate;
    laborItems.push({ item: `Chimney flashing (${chimneySize})`, qty: chimneys, unit: 'each', rate: chRate, cost: chCost });
    laborTotal += chCost;
  }

  if (cricket) {
    laborItems.push({ item: 'Cricket construction', qty: 1, unit: 'each', rate: LABOR_ADDERS.cricketConstruction, cost: LABOR_ADDERS.cricketConstruction });
    laborTotal += LABOR_ADDERS.cricketConstruction;
  }

  // Vent install
  if (vents > 0) {
    const ventCost = vents * LABOR_ADDERS.maxVentInstall;
    laborItems.push({ item: 'Maximum vent install', qty: vents, unit: 'each', rate: LABOR_ADDERS.maxVentInstall, cost: ventCost });
    laborTotal += ventCost;
  }

  // Distance adder
  if (distanceAdder > 0) {
    const distCost = measuredSQ * distanceAdder;
    laborItems.push({ item: `Distance adder (${distanceKM} km)`, qty: measuredSQ, unit: 'SQ', rate: distanceAdder, cost: distCost });
    laborTotal += distCost;
  }

  // Step 5: Calculate for each package
  const packages = ['gold', 'platinum', 'diamond'];
  const results = {};

  for (const pkg of packages) {
    // Materials
    const materials = calculateMaterials(totalSQ, measuredSQ, pkg, eavesLF, rakesLF, ridgesLF, valleysLF, pipes, wallsLF);

    // Redecking materials (if needed)
    let redeckMaterialCost = 0;
    if (redeckSheets > 0) {
      redeckMaterialCost = redeckSheets * 20; // $20/sheet OSB
    }

    // Hard cost = materials + labor + disposal + redeck materials
    let hardCost = materials.total + laborTotal + disposalCost + redeckMaterialCost;

    // Warranty adder (added to hard cost before multiplier)
    const warrantyAdder = WARRANTY_ADDERS[pkg] * measuredSQ;
    hardCost += warrantyAdder;

    // Project overhead for remote
    let projectOverhead = 0;
    const workdays = Math.ceil(measuredSQ / CREW_SQ_PER_DAY);
    if (projectType !== 'local') {
      projectOverhead = DAILY_OVERHEAD * workdays;
      hardCost += projectOverhead;
    }

    // Selling price = hard cost x multiplier
    const multiplierSet = ASPHALT_MULTIPLIERS[projectType];
    const pkgMultiplier = multiplierSet[pkg];
    let sellingPrice = Math.round(hardCost * pkgMultiplier);

    // Round to nearest $25
    sellingPrice = Math.round(sellingPrice / 25) * 25;

    // Margin floor check
    const actualMargin = (sellingPrice - hardCost) / sellingPrice;
    const floorMargin = MARGIN_FLOORS[pkg];
    let marginProtected = false;
    if (actualMargin < floorMargin) {
      sellingPrice = Math.round((hardCost / (1 - floorMargin)) / 25) * 25;
      marginProtected = true;
    }

    const hst = Math.round(sellingPrice * HST_RATE * 100) / 100;
    const totalWithTax = Math.round((sellingPrice + hst) * 100) / 100;
    const finalMargin = Math.round(((sellingPrice - hardCost) / sellingPrice) * 1000) / 10;

    results[pkg] = {
      package: pkg.charAt(0).toUpperCase() + pkg.slice(1),
      hardCost: Math.round(hardCost * 100) / 100,
      multiplier: pkgMultiplier,
      warrantyAdder: warrantyAdder > 0 ? warrantyAdder : null,
      projectOverhead: projectOverhead > 0 ? projectOverhead : null,
      sellingPrice,
      hst,
      totalWithTax,
      pricePerSQ: Math.round(sellingPrice / measuredSQ),
      netMargin: `${finalMargin}%`,
      marginProtected,
      workmanshipWarranty: pkg === 'gold' ? '15 years' : pkg === 'platinum' ? '20 years' : '25 years',
      materialBreakdown: materials.items,
      materialTotal: materials.total
    };
  }

  const workdays = Math.ceil(measuredSQ / CREW_SQ_PER_DAY);

  return {
    type: 'quote_calculation',
    input: {
      squareFeet,
      pitch,
      pitchMultiplier: multiplier,
      complexity,
      wasteFactor: `${(wastePct * 100).toFixed(0)}%`,
      newConstruction,
      projectType,
      distanceKM: distanceKM || null
    },
    roofMetrics: {
      measured2D_sqft: squareFeet,
      adjustedForPitch_sqft: Math.round(adjustedSqFt),
      measuredSQ,
      totalSQ_withWaste: totalSQ,
      workdays,
      crewSize: 4
    },
    labor: {
      items: laborItems,
      total: Math.round(laborTotal * 100) / 100
    },
    disposal: disposalCost,
    packages: results,
    notes: [
      'Labor calculated on measured SQ (before waste). Materials calculated with waste.',
      newConstruction ? 'New construction — no tear-off labor included.' : null,
      projectType !== 'local' ? `${projectType} pricing — overhead calculated from actual daily rate ($${DAILY_OVERHEAD}/day).` : null,
      'All prices CAD. HST 15% (New Brunswick).',
      'Quote valid for 30 days. Round to nearest $25.',
      eavesLF === 0 && rakesLF === 0 ? 'Edge measurements not provided — material quantities estimated.' : null
    ].filter(Boolean),
    confidence: (eavesLF > 0 && rakesLF > 0 && ridgesLF > 0) ? 0.95 : 0.80,
    source: '2026 Sales Folder / 2026 Pricing Formula (April 2026)'
  };
}
