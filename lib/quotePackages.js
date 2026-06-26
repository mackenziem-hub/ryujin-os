// Ryujin OS - calculated_packages shaping (shared)
// ----------------------------------------------------------------------------
// Extracted from api/chat.js create_ryujin_proposal so the field live proposal
// (api/field-proposal.js) and the chat proposal builder shape engine output the
// SAME way. One shaper, no drift.
//
//   shapeCalculatedPackages(compare, { actualSQ, customPrices, taxRate })
//     compare       result of POST /api/quote?mode=compare ({ offers:{ gold, platinum, diamond } })
//     actualSQ      measured roof squares (canonicalSqFt / 100). The REAL measured
//                   value the customer has - used for the customer-facing per-SQ
//                   AND carried onto summary.measuredSQ so deriveMeasuredSQ works
//                   in the live preview. Never a sqft/pitch guess.
//     customPrices  per-tier manual override map (custom_prices); a positive number
//                   for a slug replaces the engine sellingPrice.
//     taxRate       optional override; otherwise per-tier summary.taxLabel decides
//                   GST (0.05) vs HST (0.15).
//
// Returns { gold?, platinum?, diamond? }, each:
//   { total, totalWithTax, persq, tax, margin, customPrice, lineItems, summary }
// total is ALWAYS pre-tax (matches the dual-shape contract in lib/proposalPricing.js;
// normalizeCalculatedPackages reads pkg.total first, so the carried summary never
// changes price - it only supplies a persisted measuredSQ).
// ----------------------------------------------------------------------------

export function shapeCalculatedPackages(compare, opts = {}) {
  const { actualSQ = 0, customPrices = null, taxRate: taxRateOverride = null } = opts;
  const shaped = {};
  for (const slug of ['gold', 'platinum', 'diamond']) {
    if (!compare?.offers?.[slug]) continue;
    const s = compare.offers[slug].summary || {};
    const cp = customPrices && customPrices[slug];
    const hasCustom = typeof cp === 'number' && cp > 0;
    const total = hasCustom ? cp : s.sellingPrice;
    const taxRate = taxRateOverride != null ? taxRateOverride : (s.taxLabel === 'GST' ? 0.05 : 0.15);
    const totalWithTax = hasCustom ? Math.round(total * (1 + taxRate)) : s.totalWithTax;
    const persqDisplay = actualSQ > 0 ? Math.round(total / actualSQ) : s.pricePerSQ;
    // measuredSQ: prefer the engine's own measured value, else the actual SQ we
    // were handed (both are REAL measured values, never derived from sqft/pitch).
    const measuredSQ = Number(s.measuredSQ) > 0
      ? Number(s.measuredSQ)
      : (actualSQ > 0 ? actualSQ : 0);
    shaped[slug] = {
      total,
      totalWithTax,
      persq: persqDisplay,
      tax: Math.round(total * taxRate),
      margin: s.netMargin,
      customPrice: hasCustom,
      lineItems: compare.offers[slug].lineItems,
      summary: { ...s, measuredSQ }
    };
  }
  return shaped;
}
