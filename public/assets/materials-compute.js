// Shared materials computation. Mirrors production-materials.html (which
// still carries the original inline copy until that page's next touch).
// Loaded as a non-module script -- attaches functions to window.RyMaterials.
//
// Source of truth for: tier -> product label, waste resolution, bundle math,
// edge-derived quantities (drip / starter / I&W / ridge cap / valley metal).
//
// Reads measurements from the workorder first, falls back to wo.estimate
// (matches the 95 Cornhill rescue path -- some WOs have no linked estimate).
(function(){
  const PRODUCTS = {
    gold: {
      shingle: 'CertainTeed Landmark',
      iws: 'Ice & Water Shield (standard)',
      underlay: 'Synthetic Underlayment (standard)'
    },
    platinum: {
      shingle: 'CertainTeed Landmark Pro',
      iws: 'Grace Ice & Water Shield',
      underlay: 'Roof Runner Synthetic Underlayment'
    },
    diamond: {
      shingle: 'CertainTeed Presidential',
      iws: 'Grace Ice & Water Shield',
      underlay: 'Roof Runner Synthetic Underlayment'
    },
    grand_manor: {
      shingle: 'CertainTeed Grand Manor',
      iws: 'Grace Ice & Water Shield',
      underlay: 'Roof Runner Synthetic Underlayment'
    }
  };

  const DEFAULT_WASTE = 0.15;
  const WASTE_BY_COMPLEXITY = { simple: 0.10, medium: 0.15, complex: 0.20 };
  const BUNDLES_PER_SQ = 3;
  const BUNDLES_PER_SQ_PREMIUM = 4;
  const RIDGE_CAP_LF_PER_BUNDLE = 33;
  const STARTER_LF_PER_BUNDLE = 120;
  const IWS_LF_PER_ROLL = 60;
  const UNDERLAY_SQ_PER_ROLL = 10;
  const DRIP_EDGE_LF_PER_PIECE = 10;
  const RIDGE_VENT_LF_PER_ROLL = 25;
  const NAILS_SQ_PER_BOX = 20;

  function resolveWaste(wo){
    if (wo && typeof wo.waste_pct === 'number') return wo.waste_pct;
    const c = (wo && wo.complexity) || (wo && wo.estimate && wo.estimate.complexity) || null;
    return WASTE_BY_COMPLEXITY[c] || DEFAULT_WASTE;
  }

  function bundlesForShingles(sq, tier, waste){
    const rate = ['diamond','grand_manor'].includes(tier) ? BUNDLES_PER_SQ_PREMIUM : BUNDLES_PER_SQ;
    const w = typeof waste === 'number' ? waste : DEFAULT_WASTE;
    const totalSQ = Math.ceil(sq * (1 + w));
    return totalSQ * rate;
  }

  function computeMaterials(wo){
    const sq = Number(wo.total_sq) || 0;
    const tier = (wo.package_tier || 'gold').toLowerCase();
    const color = wo.shingle_color || '';
    const est = wo.estimate || {};
    const pick = (woVal, estVal) => Number(woVal) || Number(estVal) || 0;
    const eaves = pick(wo.eaves_lf, est.eaves_lf);
    const rakes = pick(wo.rakes_lf, est.rakes_lf);
    const ridge = pick(wo.ridges_lf, est.ridges_lf);
    const hips = pick(wo.hips_lf, est.hips_lf);
    const valleys = pick(wo.valleys_lf, est.valleys_lf);
    const walls = pick(wo.walls_lf, est.walls_lf);
    const pipes = pick(wo.pipes, est.pipes) || 1;
    const chimneys = pick(wo.chimneys, est.chimneys);
    const osbSheets = pick(wo.osb_sheets, est.osb_sheets);
    const prod = PRODUCTS[tier] || PRODUCTS.gold;

    const measurementsMissing = eaves === 0 && rakes === 0 && valleys === 0;

    const waste = resolveWaste(wo);
    const shingleBundles = bundlesForShingles(sq, tier, waste);
    const ridgeCapBundles = ridge + hips > 0 ? Math.ceil((ridge + hips) / RIDGE_CAP_LF_PER_BUNDLE) : 0;
    const starterBundles = eaves + rakes > 0 ? Math.ceil((eaves + rakes) / STARTER_LF_PER_BUNDLE) : 0;
    const iwsRolls = eaves + valleys > 0 ? Math.ceil((eaves + valleys) / IWS_LF_PER_ROLL) : 0;
    const underlayRolls = Math.ceil(sq / UNDERLAY_SQ_PER_ROLL) || 1;
    const dripEdge = eaves + rakes > 0 ? Math.ceil((eaves + rakes) * 1.15 / DRIP_EDGE_LF_PER_PIECE) : 0;
    const valleyMetal = Math.ceil(valleys / 10);
    const ridgeVentRolls = Math.ceil(ridge / RIDGE_VENT_LF_PER_ROLL);
    const nailBoxes = Math.max(1, Math.ceil(sq / NAILS_SQ_PER_BOX));

    const shingleLabel = prod.shingle + (color ? ' — ' + color : '');
    const hasWallFlashing = walls > 0 || chimneys > 0;

    return {
      _measurementsMissing: measurementsMissing,
      shingles: { label: shingleLabel, qty: shingleBundles, unit: 'bundles',
        note: sq + ' SQ × ' + (tier==='diamond'||tier==='grand_manor'?4:3) + ' bundles/SQ × ' + (1 + waste).toFixed(2) + ' waste' },
      ridgeCap: { label: 'Hip and Ridge Caps', qty: ridgeCapBundles, unit: 'bundles',
        note: (ridge + hips) + ' LF (ridges + hips) ÷ 33 LF/bundle' },
      starter: { label: 'Starter Strip', qty: starterBundles, unit: 'bundles',
        note: (eaves + rakes) + ' LF (eaves + rakes) ÷ 120 LF/bundle' },
      iws: { label: prod.iws, qty: iwsRolls, unit: 'rolls',
        note: (eaves + valleys) + ' LF (eaves + valleys) ÷ 60 LF/roll' },
      underlay: { label: prod.underlay, qty: underlayRolls, unit: 'rolls',
        note: sq + ' SQ ÷ 10 SQ/roll' },
      dripEdge: { label: 'Drip Edge (aluminum, 10ft)', qty: dripEdge, unit: 'pieces',
        note: (eaves + rakes) + ' LF (eaves + rakes) × 1.15 waste ÷ 10 LF/piece' },
      valleyMetal: (valleys > 0 && ['platinum','diamond','grand_manor'].includes(tier)) ? { label: 'Valley Metal (V-style open, 10ft)', qty: valleyMetal, unit: 'pieces',
        note: valleys + ' LF ÷ 10 ft (Platinum+ only — Gold uses closed-cut asphalt valleys)' } : null,
      ridgeVent: ridge > 0 ? { label: 'Ridge Vent (25ft rolls)', qty: ridgeVentRolls, unit: 'rolls',
        note: ridge + ' LF ÷ 25 LF/roll' } : null,
      pipeBoots: { label: 'Pipe Boots (3-inch standard)', qty: pipes, unit: 'each',
        note: pipes + ' penetrations' },
      stepFlashing: hasWallFlashing ? { label: 'Step Flashing', qty: 1, unit: 'bundles',
        note: (chimneys ? chimneys + ' chimney(s)' : '') + (walls ? (chimneys?' + ':'') + walls + ' LF wall flashing' : '') } : null,
      chimney: chimneys > 0 ? { label: 'Chimney Flashing Kit', qty: chimneys, unit: 'each',
        note: 'Counter + base flashing' } : null,
      osb: osbSheets > 0 ? { label: 'OSB 7/16" Decking', qty: osbSheets, unit: 'sheets',
        note: 'Redeck allowance' } : null,
      nails: { label: 'Coil Nails (1 1/4")', qty: nailBoxes, unit: 'box',
        note: sq + ' SQ ÷ 20 SQ/box (shingle nailing only)' },
      cement: { label: 'Tar / Sealant', qty: 1, unit: 'tube',
        note: 'Flashing + pipe boot seal' }
    };
  }

  function pluralUnit(qty, unit){
    if (qty === 1 || unit === 'each') return unit;
    if (unit.endsWith('s')) return unit;
    if (unit === 'box') return 'boxes';
    if (unit === 'piece') return 'pieces';
    return unit + 's';
  }

  // Plain-text summary suitable for Coastal order placement (SMS / email / paste).
  // Header is address; one line per material with qty + label.
  function buildMaterialsTextSummary(mats, address){
    const lines = [address || '', ''];
    const all = [mats.shingles, mats.ridgeCap, mats.starter, mats.iws, mats.underlay,
                 mats.dripEdge, mats.valleyMetal, mats.ridgeVent, mats.stepFlashing,
                 mats.chimney, mats.osb, mats.nails, mats.pipeBoots, mats.cement].filter(Boolean);
    all.forEach(x => {
      if (!x.qty) return;
      lines.push(x.qty + ' ' + pluralUnit(x.qty, x.unit) + ' — ' + x.label);
    });
    return lines.join('\n').trim();
  }

  window.RyMaterials = { computeMaterials, resolveWaste, pluralUnit, buildMaterialsTextSummary };
})();
