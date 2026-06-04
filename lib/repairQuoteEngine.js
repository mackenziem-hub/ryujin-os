// ═══════════════════════════════════════════════════════════════
// RYUJIN OS — Repair Quote Engine
// Prices localized roofing REPAIRS (flashings, patches, mobilization).
//
// Companion to lib/quoteEngineV3.js (full replacement/exterior quotes).
// This module fills the gap for small repair work the main engine doesn't
// model: pipe/hydro-mast/chimney flashing swaps, localized re-shingle, and
// a mobilization fee so tiny jobs aren't underpriced.
//
// OUTPUT CONTRACT — matches quoteEngineV3.calculateQuoteV3 so downstream
// (proposals, contracts, sales pages, persistence) stays uniform:
//   {
//     lineItems: [{ item_key, category, label, quantity, unit,
//                   unit_cost, total_cost, included }],
//     summary: { hardCost, sellingPrice /* PRE-TAX */, tax,
//                taxLabel: 'HST', totalWithTax, pricePerSQ }
//   }
//
// Pricing source: flashing rate card (reference_flashing_rates +
// reference_flashing_labor_vs_material). Values below are the Plus Ultra
// tenant DEFAULTS; pass a `rates` override object to retune per tenant.
//
// HST 15%. summary.sellingPrice is EXACT (pre-tax). Display rounding to
// the nearest $25 is available via roundToNearestDisplay() but is NOT
// baked into summary.sellingPrice — same discipline as the main engine,
// where the rounded number is for the card and exact drives tax math.
// ═══════════════════════════════════════════════════════════════

// ─── Tenant default rates (flashing rate card) ───────────────────
export const DEFAULT_REPAIR_RATES = {
  taxRate: 0.15,
  taxLabel: 'HST',
  // Flashing unit costs (labor + material baked into the card rate).
  pipeFlashing: 25,          // labor + material
  hydroMastFlashing: 25,     // labor only
  steelChimneyFlashing: 50,  // labor only
  masonryChimneyFlashing: 150, // labor + material
  // Localized re-shingle / patch, per affected SQ (1 SQ = 100 sq ft).
  reshinglePerSQ: 200,
  // Mobilization — explicit line so tiny repairs carry their truck-roll cost.
  mobilizationFee: 350,
  // Display rounding for the customer-facing price card (not applied to
  // summary.sellingPrice, which stays exact).
  priceRounding: 25
};

// Baseline flashing assumption when the caller doesn't specify counts:
// every roof has at least 1 plumbing stack + 1 hydro mast.
const BASELINE_PIPES = 1;
const BASELINE_HYDRO_MASTS = 1;

// ─── Helpers ─────────────────────────────────────────────────────

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Round a value to the nearest `nearest` dollars — used for the display
// price card only. summary.sellingPrice keeps the exact figure.
export function roundToNearestDisplay(value, nearest = 25) {
  if (!nearest || nearest <= 0) return round2(value);
  return Math.round(value / nearest) * nearest;
}

// ═══════════════════════════════════════════════════════════════
// MAIN REPAIR CALCULATOR
//
// input = {
//   pipes,            // # pipe flashings (defaults to baseline if all unset)
//   hydroMasts,       // # hydro mast flashings
//   steelChimneys,    // # steel chimney flashings
//   masonryChimneys,  // # masonry chimney flashings
//   reshingleSQ,      // affected SQ for localized re-shingle / patch
//   custom: [{ label, cost }]  // ad-hoc repair lines (cost = total $)
// }
// rates = optional partial override of DEFAULT_REPAIR_RATES
// ═══════════════════════════════════════════════════════════════

export function calculateRepairQuote(input = {}, rates = {}) {
  const r = { ...DEFAULT_REPAIR_RATES, ...rates };

  // Normalize counts. If the caller specified NOTHING about flashings,
  // fall back to the baseline (1 pipe + 1 hydro mast). If they specified
  // ANY flashing/repair field, honor exactly what they gave (no baseline
  // padding) — explicit zero means zero.
  const specifiedAnything =
    input.pipes != null || input.hydroMasts != null ||
    input.steelChimneys != null || input.masonryChimneys != null ||
    input.reshingleSQ != null ||
    (Array.isArray(input.custom) && input.custom.length > 0);

  const pipes = input.pipes != null
    ? Math.max(0, Number(input.pipes) || 0)
    : (specifiedAnything ? 0 : BASELINE_PIPES);
  const hydroMasts = input.hydroMasts != null
    ? Math.max(0, Number(input.hydroMasts) || 0)
    : (specifiedAnything ? 0 : BASELINE_HYDRO_MASTS);
  const steelChimneys = Math.max(0, Number(input.steelChimneys) || 0);
  const masonryChimneys = Math.max(0, Number(input.masonryChimneys) || 0);
  const reshingleSQ = Math.max(0, Number(input.reshingleSQ) || 0);
  const custom = Array.isArray(input.custom) ? input.custom : [];

  const lineItems = [];
  let sortOrder = 0;

  // Push a line item only when qty > 0. total_cost is exact (rounded to
  // cents). included mirrors the main engine (true when qty > 0).
  function pushItem({ item_key, category, label, quantity, unit, unit_cost }) {
    if (quantity <= 0) return;
    const total = round2(quantity * unit_cost);
    lineItems.push({
      item_key,
      category,
      label,
      quantity,
      unit,
      unit_cost: round2(unit_cost),
      total_cost: total,
      included: true,
      sort_order: sortOrder++
    });
  }

  // ── Flashings ──
  pushItem({
    item_key: 'pipe_flashing_repair',
    category: 'repair',
    label: 'Pipe flashing (labor + material)',
    quantity: pipes,
    unit: 'each',
    unit_cost: r.pipeFlashing
  });
  pushItem({
    item_key: 'hydro_mast_flashing_repair',
    category: 'repair',
    label: 'Hydro mast flashing (labor)',
    quantity: hydroMasts,
    unit: 'each',
    unit_cost: r.hydroMastFlashing
  });
  pushItem({
    item_key: 'steel_chimney_flashing_repair',
    category: 'repair',
    label: 'Steel chimney flashing (labor)',
    quantity: steelChimneys,
    unit: 'each',
    unit_cost: r.steelChimneyFlashing
  });
  pushItem({
    item_key: 'masonry_chimney_flashing_repair',
    category: 'repair',
    label: 'Masonry chimney flashing (labor + material)',
    quantity: masonryChimneys,
    unit: 'each',
    unit_cost: r.masonryChimneyFlashing
  });

  // ── Localized re-shingle / patch ──
  pushItem({
    item_key: 'localized_reshingle',
    category: 'repair',
    label: 'Localized re-shingle / patch',
    quantity: round2(reshingleSQ),
    unit: 'SQ',
    unit_cost: r.reshinglePerSQ
  });

  // ── Custom ad-hoc repair lines ──
  // cost is a TOTAL dollar amount for the line (qty 1).
  for (const c of custom) {
    if (!c) continue;
    const cost = Number(c.cost) || 0;
    if (cost <= 0) continue;
    pushItem({
      item_key: 'custom_repair',
      category: 'repair',
      label: c.label || 'Custom repair',
      quantity: 1,
      unit: 'job',
      unit_cost: cost
    });
  }

  // ── Mobilization ──
  // Always an explicit, separate line (clearer for the customer than
  // silently bumping the subtotal up to a minimum). Sum-of-items + this fee.
  pushItem({
    item_key: 'mobilization',
    category: 'mobilization',
    label: 'Mobilization (truck roll, setup, minimum site visit)',
    quantity: 1,
    unit: 'job',
    unit_cost: r.mobilizationFee
  });

  // ── Totals ──
  // hardCost == sellingPrice here: the rate-card figures are already retail
  // (labor + material + margin baked in), so there's no separate multiplier
  // step the way the replacement engine has. sellingPrice is PRE-TAX + exact.
  const sellingPrice = round2(
    lineItems.reduce((sum, li) => sum + (li.included ? li.total_cost : 0), 0)
  );
  const hardCost = sellingPrice;
  const tax = round2(sellingPrice * r.taxRate);
  const totalWithTax = round2(sellingPrice + tax);
  const pricePerSQ = reshingleSQ > 0 ? Math.round(sellingPrice / reshingleSQ) : null;

  return {
    lineItems,
    summary: {
      hardCost,
      sellingPrice,        // PRE-TAX, exact
      tax,
      taxLabel: r.taxLabel,
      totalWithTax,
      pricePerSQ,
      // Convenience: rounded display price for the customer-facing card.
      // Not load-bearing for tax math — sellingPrice stays exact.
      sellingPriceRounded: roundToNearestDisplay(sellingPrice, r.priceRounding)
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// SELF-TEST — run via:  node lib/repairQuoteEngine.js
// ═══════════════════════════════════════════════════════════════
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('lib/repairQuoteEngine.js')) {
  const { strict: assert } = await import('node:assert');

  const q = calculateRepairQuote({ pipes: 2, masonryChimneys: 1 });

  // 2 pipes line
  const pipeLine = q.lineItems.find(li => li.item_key === 'pipe_flashing_repair');
  assert.ok(pipeLine, 'expected a pipe flashing line item');
  assert.equal(pipeLine.quantity, 2, 'pipe quantity should be 2');
  assert.equal(pipeLine.unit_cost, 25, 'pipe unit_cost should be $25');
  assert.equal(pipeLine.total_cost, 50, 'pipe total_cost should be $50');

  // 1 masonry chimney line
  const masonryLine = q.lineItems.find(li => li.item_key === 'masonry_chimney_flashing_repair');
  assert.ok(masonryLine, 'expected a masonry chimney flashing line item');
  assert.equal(masonryLine.quantity, 1, 'masonry quantity should be 1');
  assert.equal(masonryLine.total_cost, 150, 'masonry total_cost should be $150');

  // mobilization line
  const mobLine = q.lineItems.find(li => li.item_key === 'mobilization');
  assert.ok(mobLine, 'expected a mobilization line item');
  assert.equal(mobLine.total_cost, 350, 'mobilization total_cost should be $350');

  // No baseline padding when flashings explicitly specified: no hydro mast line.
  const hydroLine = q.lineItems.find(li => li.item_key === 'hydro_mast_flashing_repair');
  assert.equal(hydroLine, undefined, 'no baseline hydro mast when input is explicit');

  // Positive pre-tax selling price = 50 + 150 + 350 = 550
  assert.equal(q.summary.sellingPrice, 550, 'sellingPrice should be 550');
  assert.ok(q.summary.sellingPrice > 0, 'sellingPrice should be positive');
  assert.equal(q.summary.hardCost, 550, 'hardCost should equal sellingPrice (550)');

  // Tax + total math
  assert.equal(q.summary.taxLabel, 'HST', "taxLabel should be 'HST'");
  assert.equal(q.summary.tax, round2(550 * 0.15), 'tax should be 15% of selling price');
  assert.equal(
    round2(q.summary.totalWithTax),
    round2(q.summary.sellingPrice * 1.15),
    'totalWithTax === sellingPrice * 1.15'
  );

  // Baseline path: empty input → 1 pipe + 1 hydro mast + mobilization.
  const base = calculateRepairQuote({});
  assert.ok(base.lineItems.find(li => li.item_key === 'pipe_flashing_repair'), 'baseline pipe');
  assert.ok(base.lineItems.find(li => li.item_key === 'hydro_mast_flashing_repair'), 'baseline hydro mast');
  assert.equal(base.summary.sellingPrice, 25 + 25 + 350, 'baseline selling price 400');

  console.log('repairQuoteEngine selftest PASS');
}
