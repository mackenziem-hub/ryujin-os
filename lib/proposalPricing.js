// Ryujin OS - Proposal Pricing Normalizer
// ----------------------------------------------------------------------------
// Single source of truth for the calculated_packages dual-shape footgun and the
// May-2026 render-time platinum promo. Ported verbatim from api/proposal.js
// (the dual-shape read at lines ~429/439/480 + the mayPromoDiscount block at
// lines ~88-117 and its application at ~426-442) so every consumer reads price
// the same way.
//
// THE DUAL SHAPE (see reference_calculated_packages_dual_shape):
//   calculated_packages[slug] arrives in one of two shapes depending on which
//   engine wrote it:
//     A) { total, persq, originalTotal, promoLabel, warranty_years }
//     B) { summary: { sellingPrice, pricePerSQ, measuredSQ, ... } }
//   In BOTH shapes the price is PRE-TAX. `pkg.total` is ALWAYS pre-tax (the card
//   shows "+HST"; breakdown/accept multiply by 1.15). Read price as
//   `pkg.total ?? pkg.summary?.sellingPrice ?? 0` and persq as
//   `pkg.persq ?? pkg.summary?.pricePerSQ ?? 0`.
//
// HST: callers round DISPLAY to nearest $25; the math here is exact, no rounding.
// ----------------------------------------------------------------------------

// ── May 2026 promo constants (mirror api/proposal.js MAY_PROMO) ──────────────
// Free 20-Year Extended Workmanship Warranty on Platinum. Auto-applies at render
// time for any Platinum quote whose estimate was created inside the window.
// Idempotent: skipped if the pkg already carries originalTotal/promoLabel.
// Discount math = warrantyAdderPerSQ × measuredSQ × tier multiplier, nearest $25.
const MAY_PROMO = {
  startISO: '2026-05-12T00:00:00Z',
  endISO:   '2026-06-01T00:00:00Z',
  tier: 'platinum',
  warrantyAdderPerSQ: 25,
  label: 'May Special · Free 20-Year Extended Warranty · Book by May 31'
};

// Platinum tier multipliers per pricing_formula_v2.md (mirror api/proposal.js).
const PLATINUM_MULTIPLIERS = { local: 1.52, day_trip: 1.67, extended_stay: 1.78, out_of_town: 1.85 };

// Map an estimate's free-text pricing_model onto a multiplier key. Verbatim port
// of pricingModelKey() in api/proposal.js so the promo math is identical.
export function pricingModelKey(est) {
  const m = String(est?.pricing_model || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (m.includes('day')) return 'day_trip';
  if (m.includes('extended')) return 'extended_stay';
  if (m.includes('out')) return 'out_of_town';
  return 'local';
}

// ── deriveMeasuredSQ ─────────────────────────────────────────────────────────
// Return the PERSISTED measured square count for a package, or null when none is
// available.
//
// CRITICAL DEVIATION FROM api/proposal.js (intentional):
// The original deriveMeasuredSQ() falls back to a geometric guess -
// `Math.ceil((roof_area_sqft * PITCH_MULTIPLIERS[pitch]) / 100)` - when
// summary.measuredSQ is missing. That fabricates SQ from a 2D footprint and a
// pitch lookup, which violates the measurements-must-persist rule
// (feedback_measurements_persist): eaves/rakes/valleys/hips/SQ are ALWAYS
// measured on site and must never be back-derived from sqrt(sqft) or any pitch
// projection. A fabricated SQ silently corrupts persq, the promo discount, and
// any per-SQ math downstream.
//
// So this normalizer returns ONLY a persisted value (pkg.summary.measuredSQ when
// > 0). If nothing was persisted it returns null and lets the caller decide
// (skip the promo, hide per-SQ, prompt for a re-measure) rather than inventing a
// number. Do NOT add a sqrt/pitch fallback here - that is the bug we are killing.
export function deriveMeasuredSQ(est, pkg) {
  const summary = pkg && pkg.summary;
  const persisted = Number(summary?.measuredSQ);
  if (persisted > 0) return persisted;
  // No persisted measuredSQ. Intentionally NOT derived from sqft/pitch - see note.
  return null;
}

// ── applyRenderPromo ─────────────────────────────────────────────────────────
// Pure port of the May-2026 platinum auto-promo (mayPromoDiscount + its
// application at api/proposal.js ~426-442). Returns the price after the
// strikethrough is applied. Never mutates pkg.
//
//   applyRenderPromo(est, tierId, pkg) -> { total, originalTotal, promoLabel }
//
// Guards (identical to source):
//   - only the configured tier (platinum)
//   - never on a signed/accepted/locked/won/closed deal (contract price is final)
//   - wall-clock gate: never show "Book by May 31" once we're past endISO
//   - estimate must have been created inside [startISO, endISO)
//   - idempotent: if pkg already has originalTotal/promoLabel, returns it untouched
//   - discount must be > 0 and strictly less than total to apply
export function applyRenderPromo(est, tierId, pkg) {
  const baseTotal = pkg?.total ?? pkg?.summary?.sellingPrice ?? 0;
  // Preserve any promo already baked into the package (idempotent passthrough).
  const existingOriginal = pkg?.originalTotal ?? null;
  const existingLabel = pkg?.promoLabel ?? null;
  const unchanged = { total: baseTotal, originalTotal: existingOriginal, promoLabel: existingLabel };

  const discount = mayPromoDiscount(est, tierId, pkg);
  if (discount > 0 && discount < baseTotal) {
    return {
      total: baseTotal - discount,
      originalTotal: baseTotal,
      promoLabel: MAY_PROMO.label
    };
  }
  return unchanged;
}

// Internal: dollar discount for the May promo, or 0 when it doesn't apply.
// Verbatim port of mayPromoDiscount() from api/proposal.js, except measuredSQ
// comes from the persisted-only deriveMeasuredSQ above (no geometric fallback),
// so a missing measurement yields 0 discount instead of a fabricated one.
function mayPromoDiscount(est, tierId, pkg) {
  if (tierId !== MAY_PROMO.tier) return 0;
  // Never retro-promo a signed/locked/accepted deal - the contract price is the price.
  if (est && (est.accepted_at || est.locked_at || est.final_accepted_total)) return 0;
  const status = String(est?.status || '').toLowerCase();
  if (status === 'signed' || status === 'accepted' || status === 'won' || status === 'closed') return 0;
  // Wall-clock gate: once we're past the promo end date, never show "Book by May 31".
  if (new Date().toISOString() >= MAY_PROMO.endISO) return 0;
  const created = est && est.created_at;
  if (!created) return 0;
  const iso = new Date(created).toISOString();
  if (iso < MAY_PROMO.startISO || iso >= MAY_PROMO.endISO) return 0;
  if (pkg && (pkg.originalTotal || pkg.promoLabel)) return 0; // already promoted
  const measuredSQ = deriveMeasuredSQ(est, pkg);
  if (!(measuredSQ > 0)) return 0; // null or <= 0 → no fabricated SQ, no discount
  const mult = PLATINUM_MULTIPLIERS[pricingModelKey(est)] || PLATINUM_MULTIPLIERS.local;
  const raw = MAY_PROMO.warrantyAdderPerSQ * measuredSQ * mult;
  return Math.round(raw / 25) * 25;
}

// ── withHST ──────────────────────────────────────────────────────────────────
// Exact HST math. NB default 15%, configurable per tenant. No rounding here -
// callers round DISPLAY to the nearest $25.
//
//   withHST(15000) -> { tax: 2250, total: 17250 }
export function withHST(preTax, rate = 0.15) {
  const tax = preTax * rate;
  return { tax, total: preTax * (1 + rate) };
}

// ── normalizeCalculatedPackages ──────────────────────────────────────────────
// The one read that kills the dual-shape footgun. For each slug key in
// `packages`, returns a flat, shape-agnostic record:
//
//   {
//     preTaxTotal,    // pkg.total ?? pkg.summary.sellingPrice ?? 0  (ALWAYS pre-tax)
//     persq,          // pkg.persq ?? pkg.summary.pricePerSQ ?? 0
//     perks,          // pkg.perks ?? [] (caller may swap warranty perks)
//     warrantyYears,  // pkg.warranty_years ?? null (null = use tier default)
//     originalTotal,  // strikethrough anchor if a promo applied, else null
//     promoLabel      // promo banner text if a promo applied, else null
//   }
//
// opts:
//   - applyPromo (default false): when true and `est` is supplied, runs
//     applyRenderPromo per slug so preTaxTotal/originalTotal/promoLabel reflect
//     the May render-time promo. When false, returns the package's own
//     persisted promo fields untouched (matches the dual-shape passthrough).
//   - est: the estimate row, required for promo evaluation.
export function normalizeCalculatedPackages(packages, opts = {}) {
  const { est = null, applyPromo = false } = opts;
  const out = {};
  if (!packages || typeof packages !== 'object') return out;

  for (const [slug, pkg] of Object.entries(packages)) {
    if (!pkg || typeof pkg !== 'object') continue;
    const summary = pkg.summary || {};

    // CRITICAL: pkg.total is ALWAYS pre-tax. Fall back to summary.sellingPrice.
    const basePreTax = pkg.total ?? summary.sellingPrice ?? 0;
    const basePersq = pkg.persq ?? summary.pricePerSQ ?? 0;

    let preTaxTotal = basePreTax;
    let originalTotal = pkg.originalTotal ?? null;
    let promoLabel = pkg.promoLabel ?? null;
    let persq = basePersq;

    if (applyPromo && est) {
      const promo = applyRenderPromo(est, slug, pkg);
      preTaxTotal = promo.total;
      originalTotal = promo.originalTotal;
      promoLabel = promo.promoLabel;
      // Recompute persq off the discounted total only when we have a real
      // persisted SQ (never fabricated). Mirrors api/proposal.js ~440.
      if (promoLabel && originalTotal != null && originalTotal !== preTaxTotal) {
        const measuredSQ = deriveMeasuredSQ(est, pkg);
        if (measuredSQ > 0) persq = Math.round(preTaxTotal / measuredSQ);
      }
    }

    out[slug] = {
      preTaxTotal,
      persq,
      perks: pkg.perks ?? [],
      warrantyYears: pkg.warranty_years ?? null,
      originalTotal,
      promoLabel
    };
  }

  return out;
}

// ── self-test ────────────────────────────────────────────────────────────────
// Run directly: `node lib/proposalPricing.js`
if (process.argv[1] && process.argv[1].endsWith('proposalPricing.js')) {
  const assert = await import('node:assert/strict').then(m => m.default);

  // Dual-shape: both shapes resolve to the same pre-tax total.
  const fromTotal = normalizeCalculatedPackages({ gold: { total: 15000 } });
  assert.equal(fromTotal.gold.preTaxTotal, 15000, 'shape A {total} -> 15000');

  const fromSummary = normalizeCalculatedPackages({ gold: { summary: { sellingPrice: 15000 } } });
  assert.equal(fromSummary.gold.preTaxTotal, 15000, 'shape B {summary.sellingPrice} -> 15000');

  // HST is exact.
  assert.deepEqual(withHST(15000), { tax: 2250, total: 17250 }, 'withHST(15000)');

  // No persisted measuredSQ -> null (NOT a fabricated number).
  const noSQ = deriveMeasuredSQ({ roof_area_sqft: 2000, roof_pitch: '8/12' }, { summary: {} });
  assert.equal(noSQ, null, 'deriveMeasuredSQ with no measuredSQ returns null');
  assert.notEqual(typeof noSQ, 'number', 'deriveMeasuredSQ must not fabricate a number');

  console.log('proposalPricing selftest PASS');
}
