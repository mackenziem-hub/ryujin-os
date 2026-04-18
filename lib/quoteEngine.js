// ═══════════════════════════════════════════════════════════════
// RYUJIN OS — Quote Calculation Engine v2.0
// Multi-system: Asphalt (Gold/Plat/Diamond/Economy), Metal, Performance Shell
// All prices in CAD. 1 SQ = 100 sq ft.
// Labor on MEASURED area (before waste). Materials on area WITH waste.
// ═══════════════════════════════════════════════════════════════

const PITCH_MULTIPLIERS = {
  '4/12': 1.054, '5/12': 1.083, '6/12': 1.118, '7/12': 1.158,
  '8/12': 1.202, '9/12': 1.250, '10/12': 1.302, '11/12': 1.357,
  '12/12': 1.414, '13/12': 1.474, '14/12': 1.537
};

// ═══════════════════════════════════════════
// ASPHALT LABOR
// ═══════════════════════════════════════════
function getAsphaltLaborRate(pitch) {
  const p = parseInt(pitch.split('/')[0]);
  if (p <= 6) return 130;
  if (p <= 9) return 160;
  return 190;
}

const LABOR_ADDERS = {
  extraLayer: 40,
  cedarTearoff: 70,
  redecking: 30,
  valleyInstall: 1.50,
  ridgeVentInstall: 2.00,
  pipeFlashing: 20,
  maxVentInstall: 50,
  smallChimneyFlashing: 125,
  largeChimneyFlashing: 350,
  cricketConstruction: 150
};

// ═══════════════════════════════════════════
// DISTANCE & PROJECT TYPE
// ═══════════════════════════════════════════
function getDistanceAdder(distanceKM) {
  if (distanceKM <= 20) return 0;
  if (distanceKM <= 60) return 20;
  return 40;
}

function getProjectType(distanceKM) {
  if (distanceKM <= 20) return 'local';
  if (distanceKM <= 60) return 'dayTrip';
  return 'extendedStay';
}

function getDisposalCost(distanceKM) {
  if (distanceKM <= 20) return 350;
  if (distanceKM <= 50) return 450;
  return 550;
}

// ═══════════════════════════════════════════
// ASPHALT MULTIPLIERS & MARGINS
// ═══════════════════════════════════════════
const ASPHALT_MULTIPLIERS = {
  local:        { economy: 1.40, gold: 1.47, platinum: 1.52, diamond: 1.58 },
  dayTrip:      { economy: 1.55, gold: 1.62, platinum: 1.67, diamond: 1.74 },
  extendedStay: { economy: 1.18, gold: 1.22, platinum: 1.27, diamond: 1.33 }
};

const MARGIN_FLOORS = { economy: 0.08, gold: 0.10, platinum: 0.15, diamond: 0.20 };
const WARRANTY_ADDERS = { economy: 0, gold: 0, platinum: 25, diamond: 50 };

// ═══════════════════════════════════════════
// MATERIAL SPECS PER PACKAGE
// ═══════════════════════════════════════════

// CRC Economy — IKO Cambridge via Birdstairs
const ECONOMY_MATERIALS = {
  shingles:      { price: 35, bundlesPerSQ: 3, desc: 'CRC (IKO Cambridge) @ $35/bundle x 3' },
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

const MATERIAL_SETS = {
  economy: ECONOMY_MATERIALS,
  gold: GOLD_MATERIALS,
  platinum: PLATINUM_MATERIALS,
  diamond: DIAMOND_MATERIALS
};

// ═══════════════════════════════════════════
// METAL ROOFING — DIVISOR METHOD (not multiplier)
// ═══════════════════════════════════════════
function getMetalLaborRate(pitch) {
  const p = parseInt(pitch.split('/')[0]);
  if (p <= 6) return 250;
  if (p <= 9) return 300;
  return 350;
}

const METAL_DIVISORS = {
  standard: 0.53,   // 12% net profit
  enhanced: 0.50,   // 15% net profit
  premium: 0.48     // 17% net profit
};

const METAL_PANELS = {
  americana: { rate: 2.80, unit: 'sqft', desc: 'Americana ribbed @ $2.80/sqft', strapping: 45 },
  standingSeam: { rate: 6.00, unit: 'sqft', desc: 'Standing seam @ $6.00/sqft (verify with supplier)' }
};

// ═══════════════════════════════════════════
// EXTERIOR / PERFORMANCE SHELL
// ═══════════════════════════════════════════
const EXTERIOR_RATES = {
  soffit: { low: 30, high: 40, desc: 'Soffit installed @ $30-$40/LF' },
  fascia: { low: 20, high: 30, desc: 'Fascia installed @ $20-$30/LF' },
  combined_sf: { low: 35, high: 45, desc: 'Combined soffit & fascia @ $35-$45/LF' },
  gutter: { low: 22, high: 30, laborPerLF: 10, desc: 'Gutters installed @ $22-$30/LF' },
  leafGuard: { labor: 2, desc: 'Leaf guard adder +$2/LF labor' },
  osbSubstrate: { labor: 30, desc: 'OSB substrate labor @ $30/sheet' }
};

function getRemediationAllowance(hardCost) {
  if (hardCost < 20000) return 1500;
  if (hardCost < 35000) return 2000;
  if (hardCost < 50000) return 2500;
  if (hardCost < 80000) return 3500;
  return 5000;
}

// ═══════════════════════════════════════════
// SHARED CONSTANTS
// ═══════════════════════════════════════════
const DAILY_OVERHEAD = 90;
const CREW_SQ_PER_DAY = 12;
const HST_RATE = 0.15;

// ═══════════════════════════════════════════
// MATERIAL CALCULATOR
// ═══════════════════════════════════════════
function calculateMaterials(totalSQ, measuredSQ, pkg, eavesLF, rakesLF, ridgesLF, valleysLF, pipes, wallsLF) {
  const mats = MATERIAL_SETS[pkg] || GOLD_MATERIALS;
  const base = GOLD_MATERIALS; // fallback for shared items
  const items = [];
  let total = 0;

  // Shingles
  const shingleBundles = Math.ceil(totalSQ * mats.shingles.bundlesPerSQ);
  const shingleCost = shingleBundles * mats.shingles.price;
  items.push({ item: mats.shingles.desc, qty: shingleBundles, unit: 'bundles', cost: shingleCost });
  total += shingleCost;

  // Underlayment
  const underlayRolls = Math.ceil(totalSQ / (mats.underlayment?.coverageSQ || base.underlayment.coverageSQ));
  const underlayPrice = mats.underlayment?.price || base.underlayment.price;
  const underlayCost = underlayRolls * underlayPrice;
  items.push({ item: (mats.underlayment || base.underlayment).desc, qty: underlayRolls, unit: 'rolls', cost: underlayCost });
  total += underlayCost;

  // Ice & Water
  const iwLF = (eavesLF || 0) + (valleysLF || 0);
  const iwSQ = Math.max(Math.ceil(iwLF / 100 * 2), Math.ceil(totalSQ * 0.15));
  const iwRolls = Math.ceil(iwSQ / (mats.iceAndWater?.coverageSQ || base.iceAndWater.coverageSQ));
  const iwPrice = mats.iceAndWater?.price || base.iceAndWater.price;
  const iwCost = iwRolls * iwPrice;
  items.push({ item: (mats.iceAndWater || base.iceAndWater).desc, qty: iwRolls, unit: 'rolls', cost: iwCost });
  total += iwCost;

  // Starter
  const starterLF = (eavesLF || 0) + (rakesLF || 0);
  const starterBundles = Math.max(Math.ceil(starterLF / 120), 2);
  const starterCost = starterBundles * (mats.starter?.price || base.starter.price);
  items.push({ item: (mats.starter || base.starter).desc, qty: starterBundles, unit: 'bundles', cost: starterCost });
  total += starterCost;

  // Ridge cap
  const ridgeBundles = Math.max(Math.ceil((ridgesLF || 30) / 30), 1);
  const ridgeCost = ridgeBundles * (mats.ridgeCap?.price || base.ridgeCap.price);
  items.push({ item: (mats.ridgeCap || base.ridgeCap).desc, qty: ridgeBundles, unit: 'bundles', cost: ridgeCost });
  total += ridgeCost;

  // Drip edge
  const dripLF = (eavesLF || 0) + (rakesLF || 0);
  const dripPieces = Math.max(Math.ceil(dripLF / 10), 4);
  const dripCost = dripPieces * (mats.dripEdge?.price || base.dripEdge.price);
  items.push({ item: (mats.dripEdge || base.dripEdge).desc, qty: dripPieces, unit: 'pieces', cost: Math.round(dripCost * 100) / 100 });
  total += dripCost;

  // Pipe flashing
  if (pipes > 0) {
    const pipeCost = pipes * (mats.pipeFlashing?.price || base.pipeFlashing.price);
    items.push({ item: (mats.pipeFlashing || base.pipeFlashing).desc, qty: pipes, unit: 'each', cost: pipeCost });
    total += pipeCost;
  }

  // Step flashing
  if (wallsLF > 0) {
    const stepBundles = Math.ceil(wallsLF / 50);
    const stepCost = stepBundles * (mats.stepFlashing?.price || base.stepFlashing.price);
    items.push({ item: (mats.stepFlashing || base.stepFlashing).desc, qty: stepBundles, unit: 'bundles', cost: stepCost });
    total += stepCost;
  }

  // Platinum+ metal valleys
  if ((pkg === 'platinum' || pkg === 'diamond') && valleysLF > 0 && PLATINUM_MATERIALS.valleyMetal) {
    const vSheets = Math.ceil(valleysLF / 10);
    const vCost = vSheets * PLATINUM_MATERIALS.valleyMetal.price;
    items.push({ item: PLATINUM_MATERIALS.valleyMetal.desc, qty: vSheets, unit: 'sheets', cost: vCost });
    total += vCost;
  }

  // Ridge vent
  items.push({ item: base.ridgeVent.desc, qty: 1, unit: 'each', cost: base.ridgeVent.price });
  total += base.ridgeVent.price;

  // Nails + caulking
  const nailBoxes = Math.ceil(totalSQ / 15);
  items.push({ item: base.coilNails.desc, qty: nailBoxes, unit: 'boxes', cost: nailBoxes * base.coilNails.price });
  total += nailBoxes * base.coilNails.price;
  items.push({ item: base.caulking.desc, qty: 2, unit: 'tubes', cost: 24 });
  total += 24;

  return { items, total: Math.round(total * 100) / 100 };
}

// ═══════════════════════════════════════════
// LABOR CALCULATOR (shared across asphalt packages)
// ═══════════════════════════════════════════
function calculateLabor(spec, measuredSQ) {
  const {
    pitch = '5/12', newConstruction = false, extraLayers = 0,
    chimneys = 0, chimneySize = 'small', cricket = false,
    valleysLF = 0, ridgesLF = 0, pipes = 0, vents = 0,
    distanceKM = 0, cedarTearoff = false, redeckSheets = 0
  } = spec;

  const baseLaborRate = getAsphaltLaborRate(pitch);
  const distanceAdder = getDistanceAdder(distanceKM);
  const items = [];
  let total = 0;

  const baseCost = measuredSQ * baseLaborRate;
  items.push({ item: `Base install labor (${pitch} pitch)`, qty: measuredSQ, unit: 'SQ', rate: baseLaborRate, cost: baseCost });
  total += baseCost;

  if (extraLayers > 0 && !newConstruction) {
    const cost = measuredSQ * LABOR_ADDERS.extraLayer * extraLayers;
    items.push({ item: `Extra layer tear-off (${extraLayers} layers)`, qty: measuredSQ, unit: 'SQ', rate: LABOR_ADDERS.extraLayer * extraLayers, cost });
    total += cost;
  }

  if (cedarTearoff) {
    const cost = measuredSQ * LABOR_ADDERS.cedarTearoff;
    items.push({ item: 'Cedar tear-off', qty: measuredSQ, unit: 'SQ', rate: LABOR_ADDERS.cedarTearoff, cost });
    total += cost;
  }

  if (redeckSheets > 0) {
    const cost = redeckSheets * LABOR_ADDERS.redecking;
    items.push({ item: 'Redecking labor', qty: redeckSheets, unit: 'sheets', rate: LABOR_ADDERS.redecking, cost });
    total += cost;
  }

  if (valleysLF > 0) {
    const cost = valleysLF * LABOR_ADDERS.valleyInstall;
    items.push({ item: 'Valley install', qty: valleysLF, unit: 'LF', rate: LABOR_ADDERS.valleyInstall, cost });
    total += cost;
  }

  if (ridgesLF > 0) {
    const cost = ridgesLF * LABOR_ADDERS.ridgeVentInstall;
    items.push({ item: 'Ridge vent install', qty: ridgesLF, unit: 'LF', rate: LABOR_ADDERS.ridgeVentInstall, cost });
    total += cost;
  }

  if (pipes > 0) {
    const cost = pipes * LABOR_ADDERS.pipeFlashing;
    items.push({ item: 'Pipe flashing install', qty: pipes, unit: 'each', rate: LABOR_ADDERS.pipeFlashing, cost });
    total += cost;
  }

  if (chimneys > 0) {
    const rate = chimneySize === 'large' ? LABOR_ADDERS.largeChimneyFlashing : LABOR_ADDERS.smallChimneyFlashing;
    const cost = chimneys * rate;
    items.push({ item: `Chimney flashing (${chimneySize})`, qty: chimneys, unit: 'each', rate, cost });
    total += cost;
  }

  if (cricket) {
    items.push({ item: 'Cricket construction', qty: 1, unit: 'each', rate: LABOR_ADDERS.cricketConstruction, cost: LABOR_ADDERS.cricketConstruction });
    total += LABOR_ADDERS.cricketConstruction;
  }

  if (vents > 0) {
    const cost = vents * LABOR_ADDERS.maxVentInstall;
    items.push({ item: 'Maximum vent install', qty: vents, unit: 'each', rate: LABOR_ADDERS.maxVentInstall, cost });
    total += cost;
  }

  if (distanceAdder > 0) {
    const cost = measuredSQ * distanceAdder;
    items.push({ item: `Distance adder (${spec.distanceKM} km)`, qty: measuredSQ, unit: 'SQ', rate: distanceAdder, cost });
    total += cost;
  }

  return { items, total: Math.round(total * 100) / 100 };
}

// ═══════════════════════════════════════════
// ASPHALT QUOTE (Gold / Platinum / Diamond / Economy)
// ═══════════════════════════════════════════
export function calculateAsphaltQuote(spec) {
  const {
    squareFeet, pitch = '5/12', complexity = 'medium',
    newConstruction = false, distanceKM = 0, redeckSheets = 0
  } = spec;

  if (!squareFeet || squareFeet <= 0) return { error: 'squareFeet is required and must be > 0' };

  const pitchMult = PITCH_MULTIPLIERS[pitch] || 1.083;
  const adjustedSqFt = squareFeet * pitchMult;
  const measuredSQ = Math.ceil(adjustedSqFt / 100);
  const wasteFactors = { simple: 0.10, medium: 0.15, complex: 0.20 };
  const wastePct = wasteFactors[complexity] || 0.15;
  const totalSQ = Math.ceil(measuredSQ * (1 + wastePct));

  const projectType = getProjectType(distanceKM);
  const disposalCost = getDisposalCost(distanceKM);
  const labor = calculateLabor(spec, measuredSQ);
  const workdays = Math.ceil(measuredSQ / CREW_SQ_PER_DAY);

  const packages = {};
  for (const pkg of ['economy', 'gold', 'platinum', 'diamond']) {
    const materials = calculateMaterials(totalSQ, measuredSQ, pkg,
      spec.eavesLF, spec.rakesLF, spec.ridgesLF, spec.valleysLF, spec.pipes, spec.wallsLF);

    let redeckMaterialCost = redeckSheets > 0 ? redeckSheets * 20 : 0;
    let hardCost = materials.total + labor.total + disposalCost + redeckMaterialCost;

    const warrantyAdder = (WARRANTY_ADDERS[pkg] || 0) * measuredSQ;
    hardCost += warrantyAdder;

    let projectOverhead = 0;
    if (projectType !== 'local') {
      projectOverhead = DAILY_OVERHEAD * workdays;
      hardCost += projectOverhead;
    }

    const multiplierSet = ASPHALT_MULTIPLIERS[projectType];
    const pkgMultiplier = multiplierSet[pkg];
    let sellingPrice = Math.round(hardCost * pkgMultiplier / 25) * 25;

    const actualMargin = (sellingPrice - hardCost) / sellingPrice;
    let marginProtected = false;
    if (actualMargin < MARGIN_FLOORS[pkg]) {
      sellingPrice = Math.round((hardCost / (1 - MARGIN_FLOORS[pkg])) / 25) * 25;
      marginProtected = true;
    }

    const hst = Math.round(sellingPrice * HST_RATE * 100) / 100;
    const totalWithTax = Math.round((sellingPrice + hst) * 100) / 100;
    const finalMargin = Math.round(((sellingPrice - hardCost) / sellingPrice) * 1000) / 10;

    const warrantyMap = { economy: '10 years', gold: '15 years', platinum: '20 years', diamond: '25 years' };

    packages[pkg] = {
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
      workmanshipWarranty: warrantyMap[pkg],
      materialBreakdown: materials.items,
      materialTotal: materials.total
    };
  }

  return {
    type: 'asphalt_quote',
    input: { squareFeet, pitch, pitchMultiplier: pitchMult, complexity, wasteFactor: `${(wastePct * 100).toFixed(0)}%`, newConstruction, projectType, distanceKM: distanceKM || null },
    roofMetrics: { measured2D_sqft: squareFeet, adjustedForPitch_sqft: Math.round(adjustedSqFt), measuredSQ, totalSQ_withWaste: totalSQ, workdays, crewSize: 4 },
    labor,
    disposal: disposalCost,
    packages,
    confidence: (spec.eavesLF > 0 && spec.rakesLF > 0 && spec.ridgesLF > 0) ? 0.95 : 0.80
  };
}

// ═══════════════════════════════════════════
// METAL QUOTE (Standard / Enhanced / Premium)
// Sell Price = Direct Cost / Divisor
// ═══════════════════════════════════════════
export function calculateMetalQuote(spec) {
  const {
    squareFeet, pitch = '5/12', complexity = 'medium',
    panelType = 'americana', distanceKM = 0,
    eavesLF = 0, rakesLF = 0, ridgesLF = 0, valleysLF = 0, pipes = 0
  } = spec;

  if (!squareFeet || squareFeet <= 0) return { error: 'squareFeet is required and must be > 0' };

  const pitchMult = PITCH_MULTIPLIERS[pitch] || 1.083;
  const adjustedSqFt = squareFeet * pitchMult;
  const measuredSQ = Math.ceil(adjustedSqFt / 100);
  const wasteFactors = { simple: 0.10, medium: 0.15, complex: 0.20 };
  const wastePct = wasteFactors[complexity] || 0.15;
  const totalSqFt = Math.ceil(adjustedSqFt * (1 + wastePct));

  const panel = METAL_PANELS[panelType] || METAL_PANELS.americana;
  const laborRate = getMetalLaborRate(pitch);
  const disposalCost = getDisposalCost(distanceKM);
  const projectType = getProjectType(distanceKM);
  const workdays = Math.ceil(measuredSQ / (CREW_SQ_PER_DAY * 0.6)); // metal is slower

  // Direct cost = panels + labor + disposal + strapping (if americana)
  const panelCost = totalSqFt * panel.rate;
  const laborCost = measuredSQ * laborRate;
  const strappingCost = panelType === 'americana' ? measuredSQ * panel.strapping : 0;

  let directCost = panelCost + laborCost + strappingCost + disposalCost;

  if (projectType !== 'local') {
    directCost += DAILY_OVERHEAD * workdays;
  }

  const packages = {};
  for (const [tier, divisor] of Object.entries(METAL_DIVISORS)) {
    let sellingPrice = Math.round((directCost / divisor) / 25) * 25;
    const hst = Math.round(sellingPrice * HST_RATE * 100) / 100;

    packages[tier] = {
      package: tier.charAt(0).toUpperCase() + tier.slice(1),
      directCost: Math.round(directCost * 100) / 100,
      divisor,
      sellingPrice,
      hst,
      totalWithTax: Math.round((sellingPrice + hst) * 100) / 100,
      pricePerSQ: Math.round(sellingPrice / measuredSQ),
      netProfit: tier === 'standard' ? '12%' : tier === 'enhanced' ? '15%' : '17%'
    };
  }

  return {
    type: 'metal_quote',
    input: { squareFeet, pitch, panelType, complexity, projectType },
    roofMetrics: { measured2D_sqft: squareFeet, adjustedForPitch_sqft: Math.round(adjustedSqFt), measuredSQ, totalSqFt_withWaste: totalSqFt, workdays },
    costBreakdown: {
      panels: Math.round(panelCost * 100) / 100,
      labor: Math.round(laborCost * 100) / 100,
      strapping: strappingCost > 0 ? strappingCost : null,
      disposal: disposalCost
    },
    packages
  };
}

// ═══════════════════════════════════════════
// PERFORMANCE SHELL / EXTERIOR QUOTE
// Adds to a base roof quote — OSB substrate + remediation
// ═══════════════════════════════════════════
export function calculateExteriorQuote(spec) {
  const {
    soffitLF = 0, fasciaLF = 0, gutterLF = 0, leafGuard = false,
    sidingSqFt = 0, osbSheets = 0, windowCount = 0, doorCount = 0,
    qualityTier = 'mid' // 'low', 'mid', 'high' — maps to rate ranges
  } = spec;

  const tierMultiplier = qualityTier === 'low' ? 0 : qualityTier === 'high' ? 1 : 0.5;
  const lerp = (low, high) => low + (high - low) * tierMultiplier;

  const items = [];
  let hardCost = 0;

  // Soffit
  if (soffitLF > 0) {
    const rate = lerp(EXTERIOR_RATES.soffit.low, EXTERIOR_RATES.soffit.high);
    const cost = Math.round(soffitLF * rate);
    items.push({ item: `Soffit @ $${rate.toFixed(0)}/LF`, qty: soffitLF, unit: 'LF', rate, cost });
    hardCost += cost;
  }

  // Fascia
  if (fasciaLF > 0) {
    const rate = lerp(EXTERIOR_RATES.fascia.low, EXTERIOR_RATES.fascia.high);
    const cost = Math.round(fasciaLF * rate);
    items.push({ item: `Fascia @ $${rate.toFixed(0)}/LF`, qty: fasciaLF, unit: 'LF', rate, cost });
    hardCost += cost;
  }

  // Gutters
  if (gutterLF > 0) {
    const rate = lerp(EXTERIOR_RATES.gutter.low, EXTERIOR_RATES.gutter.high);
    const cost = Math.round(gutterLF * rate);
    items.push({ item: `Gutters installed @ $${rate.toFixed(0)}/LF`, qty: gutterLF, unit: 'LF', rate, cost });
    hardCost += cost;

    if (leafGuard) {
      const lgCost = Math.round(gutterLF * EXTERIOR_RATES.leafGuard.labor);
      items.push({ item: 'Leaf guard adder', qty: gutterLF, unit: 'LF', rate: EXTERIOR_RATES.leafGuard.labor, cost: lgCost });
      hardCost += lgCost;
    }
  }

  // Siding (using basic installed rate — tenant can configure)
  if (sidingSqFt > 0) {
    // Default: Gentec vinyl ~$5-7/sqft installed
    const rate = lerp(5, 7);
    const cost = Math.round(sidingSqFt * rate);
    items.push({ item: `Vinyl siding installed @ $${rate.toFixed(2)}/sqft`, qty: sidingSqFt, unit: 'sqft', rate, cost });
    hardCost += cost;
  }

  // OSB substrate (Performance Shell mandatory)
  if (osbSheets > 0) {
    const laborCost = osbSheets * EXTERIOR_RATES.osbSubstrate.labor;
    const materialCost = osbSheets * 20; // ~$20/sheet material
    const totalOsb = laborCost + materialCost;
    items.push({ item: `OSB substrate (${osbSheets} sheets) — labor + material`, qty: osbSheets, unit: 'sheets', rate: 50, cost: totalOsb });
    hardCost += totalOsb;
  }

  // Remediation allowance (mandatory on Performance Shell)
  const remediationAllowance = (osbSheets > 0 || sidingSqFt > 0) ? getRemediationAllowance(hardCost) : 0;
  if (remediationAllowance > 0) {
    items.push({ item: 'Remediation allowance', qty: 1, unit: 'allowance', rate: remediationAllowance, cost: remediationAllowance });
    hardCost += remediationAllowance;
  }

  const hst = Math.round(hardCost * HST_RATE * 100) / 100;

  return {
    type: 'exterior_quote',
    items,
    hardCost: Math.round(hardCost * 100) / 100,
    remediationAllowance,
    hst,
    totalWithTax: Math.round((hardCost + hst) * 100) / 100,
    note: 'Exterior pricing uses installed rates. OSB substrate + remediation are mandatory for Performance Shell scope.'
  };
}

// ═══════════════════════════════════════════
// COMBINED QUOTE — roof + exterior in one
// ═══════════════════════════════════════════
export function calculateCombinedQuote(spec) {
  const roofQuote = spec.system === 'metal'
    ? calculateMetalQuote(spec)
    : calculateAsphaltQuote(spec);

  if (roofQuote.error) return roofQuote;

  const hasExterior = (spec.soffitLF > 0 || spec.fasciaLF > 0 || spec.gutterLF > 0 || spec.sidingSqFt > 0);
  const exteriorQuote = hasExterior ? calculateExteriorQuote(spec) : null;

  return {
    type: 'combined_quote',
    roof: roofQuote,
    exterior: exteriorQuote,
    combined: exteriorQuote ? {
      note: 'Add exterior hard cost to each roof package before final pricing.',
      exteriorHardCost: exteriorQuote.hardCost,
      exteriorHST: exteriorQuote.hst
    } : null
  };
}
