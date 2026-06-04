// ═══════════════════════════════════════════════════════════════
// RYUJIN OS - Rejuvenation Quote Engine (NuRoof Revive)
//
// Prices the NuRoof Revive / asphalt-shingle rejuvenation service. This is
// NOT a shingle-replacement quote - it does NOT use the Gold/Plat/Diamond
// multiplier stack from quoteEngineV3. Rejuvenation is priced as
// MATERIAL + FLAT FEE + (steep surcharge) against a market anchor.
//
// Self-contained on purpose: this module never touches the offers table or
// quoteEngineV3 (CHECK-constraint landmines live there). All rejuvenation
// math stays here.
//
// Pricing model (per reference_rejuvenation_pricing_model + the May 26
// pricing correction):
//   - Retail market anchor ≈ $230/SQ pre-HST (sanity CEILING, not auto-fill).
//   - Material cost default $130/SQ.
//   - Flat fee $30 per job.
//   - STEEP-slope residential only: +$30/SQ surcharge.
//
//   sellingPrice = material + flatFee + steepSurcharge, where material and
//   steep are computed on measuredSQ. For standard slope this lands at/under
//   the $230/SQ anchor; the anchor is a check, not a fill.
//
// ⚠️ FLAGGED OPEN ITEM - CONFIRM WITH OWNER BEFORE QUOTING:
//   The material cost was recently moved from $180/SQ to $130/SQ. The $130
//   default here is the current working number but is NOT yet locked. Confirm
//   the per-SQ material cost with Mac before sending any rejuvenation quote.
//   Override via rates.materialCostPerSQ when the owner confirms.
//
// Emits the SAME contract as the repair / quoteEngineV3 engine:
//   { lineItems: [{ item_key, category, label, quantity, unit,
//                   unit_cost, total_cost, included }],
//     summary:   { hardCost, sellingPrice /* PRE-TAX */, tax, taxLabel:'HST',
//                  totalWithTax, pricePerSQ } }
// ═══════════════════════════════════════════════════════════════

// HST 15% (NB default; configurable per tenant via rates.taxRate).
const HST_RATE = 0.15;

// Tenant-configurable defaults. Override any of these via the `rates` arg.
const REJUVENATION_DEFAULTS = {
  // ⚠️ $130 vs $180 is a flagged open item - confirm with owner (see header).
  materialCostPerSQ: 130,
  flatFee: 30,
  steepSurchargePerSQ: 30,
  // Retail anchor used only as a sanity ceiling / reporting value, not an auto-fill.
  retailAnchorPerSQ: 230,
  taxRate: HST_RATE,
  taxLabel: 'HST'
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Calculate a NuRoof Revive / rejuvenation quote.
 *
 * @param {Object} input
 * @param {number} input.measuredSQ  Measured roof area in squares (1 SQ = 100 sq ft).
 * @param {boolean} [input.steep]    True if STEEP-slope residential (adds +$30/SQ).
 * @param {Object} [rates]           Tenant overrides (materialCostPerSQ, flatFee,
 *                                   steepSurchargePerSQ, retailAnchorPerSQ, taxRate, taxLabel).
 * @returns {{ lineItems: Array, summary: Object }}
 */
export function calculateRejuvenationQuote(input = {}, rates = {}) {
  const cfg = { ...REJUVENATION_DEFAULTS, ...(rates || {}) };

  const measuredSQ = Number(input.measuredSQ) || 0;
  const steep = input.steep === true;

  const materialPerSQ = Number(cfg.materialCostPerSQ) || 0;
  const flatFee = Number(cfg.flatFee) || 0;
  const steepPerSQ = steep ? (Number(cfg.steepSurchargePerSQ) || 0) : 0;
  const taxRate = Number(cfg.taxRate) || HST_RATE;

  // ── Line items (same shape as quoteEngineV3 line items) ──
  const materialTotal = round2(measuredSQ * materialPerSQ);
  const steepTotal = round2(measuredSQ * steepPerSQ);

  const lineItems = [
    {
      item_key: 'revive_material',
      category: 'materials',
      label: 'NuRoof Revive Treatment',
      quantity: measuredSQ,
      unit: 'SQ',
      unit_cost: materialPerSQ,
      total_cost: materialTotal,
      included: true
    },
    {
      item_key: 'revive_flat_fee',
      category: 'labor',
      label: 'Application Setup Fee',
      quantity: 1,
      unit: 'job',
      unit_cost: flatFee,
      total_cost: round2(flatFee),
      included: true
    },
    {
      item_key: 'revive_steep_surcharge',
      category: 'labor',
      label: 'Steep-Slope Surcharge',
      quantity: steep ? measuredSQ : 0,
      unit: 'SQ',
      unit_cost: steepPerSQ,
      total_cost: steepTotal,
      included: steep
    }
  ];

  // Hard cost = sum of included line items.
  const hardCost = round2(
    lineItems
      .filter(li => li.included)
      .reduce((sum, li) => sum + li.total_cost, 0)
  );

  // Rejuvenation is priced AT cost-stack (material + fee + steep). There is no
  // separate retail multiplier here - the material number already carries the
  // margin (material+market-anchor model). sellingPrice === stacked cost, which
  // for standard slope lands at/under the $230/SQ anchor.
  const sellingPrice = hardCost; // PRE-TAX
  const tax = round2(sellingPrice * taxRate);
  const totalWithTax = round2(sellingPrice + tax);
  const pricePerSQ = measuredSQ > 0 ? Math.round(sellingPrice / measuredSQ) : null;

  // Anchor is a sanity ceiling, not an auto-fill. Surface a flag if we blow past it.
  const anchor = Number(cfg.retailAnchorPerSQ) || REJUVENATION_DEFAULTS.retailAnchorPerSQ;
  const overAnchor = pricePerSQ != null && pricePerSQ > anchor;

  return {
    lineItems,
    summary: {
      hardCost,
      sellingPrice,            // PRE-TAX
      tax,
      taxLabel: cfg.taxLabel || 'HST',
      totalWithTax,
      pricePerSQ,
      // ── Rejuvenation-specific reporting (non-contract extras) ──
      retailAnchorPerSQ: anchor,
      overAnchor,
      anchorNote: overAnchor
        ? `Price/SQ $${pricePerSQ} exceeds the $${anchor}/SQ market anchor - review before quoting.`
        : null,
      steep,
      materialCostFlag: 'Material cost $130/SQ (was $180) is a flagged open item - confirm with owner before quoting.'
    }
  };
}

export default calculateRejuvenationQuote;

// ═══════════════════════════════════════════════════════════════
// SELF-TEST - `node lib/rejuvenationQuote.js`
// Guarded so importing the module never runs the assertions.
// ═══════════════════════════════════════════════════════════════
const isDirectRun = (() => {
  try {
    const invoked = (process.argv[1] || '').replace(/\\/g, '/');
    return invoked.endsWith('/rejuvenationQuote.js') || invoked.endsWith('rejuvenationQuote.js');
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  const { default: assert } = await import('node:assert');

  const q = calculateRejuvenationQuote({ measuredSQ: 20, steep: false });

  // Positive pre-tax selling price.
  assert(q.summary.sellingPrice > 0, 'sellingPrice should be positive');

  // pricePerSQ at or below ~$230 anchor for standard slope.
  assert(
    q.summary.pricePerSQ <= 230,
    `pricePerSQ ${q.summary.pricePerSQ} should be at or below ~230`
  );

  // totalWithTax === sellingPrice * 1.15 (within float tolerance).
  const expectedTotal = Math.round(q.summary.sellingPrice * 1.15 * 100) / 100;
  assert(
    Math.abs(q.summary.totalWithTax - expectedTotal) < 0.01,
    `totalWithTax ${q.summary.totalWithTax} should equal sellingPrice*1.15 ${expectedTotal}`
  );

  // Contract sanity: line items carry the required keys.
  for (const li of q.lineItems) {
    for (const k of ['item_key', 'category', 'label', 'quantity', 'unit', 'unit_cost', 'total_cost', 'included']) {
      assert(k in li, `line item missing key ${k}`);
    }
  }

  // taxLabel is HST.
  assert(q.summary.taxLabel === 'HST', 'taxLabel should be HST');

  // Steep variant adds the surcharge.
  const qSteep = calculateRejuvenationQuote({ measuredSQ: 20, steep: true });
  assert(
    qSteep.summary.sellingPrice > q.summary.sellingPrice,
    'steep selling price should exceed standard'
  );

  console.log('rejuvenationQuote selftest PASS');
  console.log('  standard 20SQ:', JSON.stringify(q.summary));
  console.log('  steep    20SQ:', JSON.stringify(qSteep.summary));
}
