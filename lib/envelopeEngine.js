// Ryujin OS — Envelope Configurator Engine
//
// Pure functions for the Performance Shell configurator. Given an envelope
// definition (the full menu of components + tiers + multipliers, stored on
// the estimate at custom_prices._envelope) and a customer's current
// selections (which roof tier, which siding tier, which trim toggles), this
// module computes:
//
//   • The dynamic package name ("Performance Shell Plus + Ultra Eve Protection")
//   • The bundle price (selected hard costs × tier multiplier)
//   • The standalone "alone" price (per-component, with mob premium)
//   • The savings number (alone − bundle, displayed as a $ amount)
//   • The cash discount status (threshold met / amount unlocked)
//
// No DB calls here. The envelope structure must be hydrated by the caller
// (typically from estimates.custom_prices._envelope at proposal-render time).
// This keeps the math testable and side-effect-free.

// ── Default values ─────────────────────────────────────────────────────────
// These mirror the Mountain Road config + Plus Ultra Pricing SOP v2. Don't
// reach for them at runtime — let the envelope on the estimate override.

export const DEFAULT_BUNDLE_MULTIPLIERS = {
  shell:       { score: 2,        mult: 1.47, name: 'Performance Shell',             margin: 12 },
  shell_plus:  { score: [3, 4],   mult: 1.52, name: 'Performance Shell Plus',        margin: 17, popular: true },
  shell_ultra: { score: [5, 6],   mult: 1.58, name: 'Performance Shell Plus Ultra',  margin: 23 }
};

export const DEFAULT_EVE_PROTECTION_MODIFIERS = {
  1: 'Basic Eve Protection',
  2: 'Eve Protection',
  3: 'Ultra Eve Protection'
};

export const DEFAULT_CASH_DISCOUNT_TIERS = [
  { threshold: 50000,  pct: 3, label: 'Pay-in-full · 3% cash discount' },
  { threshold: 75000,  pct: 5, label: 'Pay-in-full · 5% cash discount' },
  { threshold: 100000, pct: 7, label: 'Pay-in-full · 7% cash discount' }
];

export const DEFAULT_STANDALONE_MOB_PREMIUM = 1200;
export const DEFAULT_STANDALONE_MULTIPLIER  = 1.52;

// ── Selection lookups ──────────────────────────────────────────────────────

function getRoofTier(envelope, system, slug) {
  const key = system === 'asphalt' ? 'roof_asphalt' : 'roof_metal';
  const tiers = envelope?.components?.[key]?.tiers || [];
  return tiers.find(t => t.slug === slug) || null;
}

function getSidingTier(envelope, slug) {
  const tiers = envelope?.components?.siding?.tiers || [];
  return tiers.find(t => t.slug === slug) || null;
}

function getTrim(envelope, key) {
  return envelope?.components?.[`trim_${key}`] || null;
}

// ── Pricing math (pure) ────────────────────────────────────────────────────

/**
 * Compute the standalone "alone" price for a single component at a given tier.
 * Formula: (hard + mob_premium) × standalone_multiplier
 * Used to show "$X if bought separately" next to each tier option.
 */
export function computeStandalone(envelope, hardCost) {
  const mob = envelope?.standalone_mob_premium ?? DEFAULT_STANDALONE_MOB_PREMIUM;
  const mult = envelope?.standalone_multiplier  ?? DEFAULT_STANDALONE_MULTIPLIER;
  return Math.round((hardCost + mob) * mult);
}

/**
 * Resolve the bundle tier definition based on combined roof + siding score.
 * If no siding picked, returns null (no bundle yet — just roof).
 */
export function resolveBundleTier(envelope, roofTier, sidingTier) {
  if (!roofTier || !sidingTier || sidingTier.tier === 0) return null;
  const score = (roofTier.tier || 0) + (sidingTier.tier || 0);
  const tiers = envelope?.bundle_multipliers || DEFAULT_BUNDLE_MULTIPLIERS;
  for (const key of Object.keys(tiers)) {
    const def = tiers[key];
    const matches = Array.isArray(def.score) ? def.score.includes(score) : def.score === score;
    if (matches) return { ...def, key, score };
  }
  return null;
}

/**
 * Resolve the eve-protection modifier from the count of trim toggles selected.
 * Only fires if at least one trim item is on.
 */
export function resolveEveModifier(envelope, trimSelections) {
  const count = ['gutters', 'soffit', 'fascia'].filter(k => !!trimSelections?.[k]).length;
  if (count === 0) return null;
  const map = envelope?.eve_protection_modifiers || DEFAULT_EVE_PROTECTION_MODIFIERS;
  return map[count] || null;
}

/**
 * Build the dynamic package name. Three regimes:
 *   - Roof only (no siding): roof tier name (e.g., "Metal Enhanced")
 *   - Roof + siding: Performance Shell tier name (e.g., "Performance Shell Plus")
 *   - Plus optional eve-protection modifier
 */
export function getPackageName(envelope, selections) {
  const system    = selections?.system || envelope?.default_system || 'metal';
  const roofTier  = getRoofTier(envelope, system, selections?.roof);
  const sidingTier = getSidingTier(envelope, selections?.siding);
  const bundleTier = resolveBundleTier(envelope, roofTier, sidingTier);
  const eveMod    = resolveEveModifier(envelope, selections?.trim || {});

  let body;
  if (bundleTier) {
    body = bundleTier.name;
  } else if (roofTier) {
    body = roofTier.label || (roofTier.slug || 'Roof Package');
  } else {
    body = 'Build Your Package';
  }

  return eveMod ? `${body} + ${eveMod}` : body;
}

/**
 * Compute total bundle hard cost and selling price.
 * Bundle = roof + (siding includes wall assembly) + selected trim items.
 * Trim items are always added at hard cost (never discounted out of bundle).
 * The bundle multiplier is determined by roof + siding score; if no siding
 * picked, falls back to standalone roof pricing for the roof component.
 */
export function computeBundle(envelope, selections) {
  const system    = selections?.system || envelope?.default_system || 'metal';
  const roofTier  = getRoofTier(envelope, system, selections?.roof);
  const sidingTier = getSidingTier(envelope, selections?.siding);
  const bundleTier = resolveBundleTier(envelope, roofTier, sidingTier);

  const trimSel = selections?.trim || {};
  const trimItems = ['gutters', 'soffit', 'fascia']
    .filter(k => !!trimSel[k])
    .map(k => ({ key: k, ...(getTrim(envelope, k) || {}) }))
    .filter(t => t.hard != null);

  // Bundle path: roof + siding (with wall assembly) + trim, all × tier multiplier
  if (bundleTier) {
    const wallHard   = envelope?.components?.wall_assembly?.hard || 0;
    const roofHard   = roofTier?.hard || 0;
    const sidingHard = sidingTier?.hard || 0;
    const trimHard   = trimItems.reduce((s, t) => s + (t.hard || 0), 0);
    const totalHard  = roofHard + wallHard + sidingHard + trimHard;
    const sellingPre = Math.round(totalHard * bundleTier.mult);
    return {
      mode: 'bundle',
      tier: bundleTier,
      breakdown: {
        roof:   { hard: roofHard,   label: roofTier.label },
        wall:   { hard: wallHard,   label: 'Wall assembly (OSB + foam + VentiGrid)' },
        siding: { hard: sidingHard, label: sidingTier.label },
        trim:   { hard: trimHard,   items: trimItems.map(t => ({ key: t.key, label: t.label, hard: t.hard })) }
      },
      totalHard,
      sellingPre,
      sellingWithTax: Math.round(sellingPre * 1.15)
    };
  }

  // Standalone path: just roof (or roof + trim, no shell)
  const roofStandalone = roofTier
    ? computeStandalone(envelope, roofTier.hard || 0)
    : 0;
  const trimStandaloneTotal = trimItems.reduce(
    (s, t) => s + computeStandalone(envelope, t.hard || 0),
    0
  );
  const sellingPre = roofStandalone + trimStandaloneTotal;
  return {
    mode: 'standalone_roof',
    tier: null,
    breakdown: {
      roof:   { hard: roofTier?.hard || 0, label: roofTier?.label || 'No roof selected', selling: roofStandalone },
      siding: null,
      wall:   null,
      trim:   { items: trimItems.map(t => ({ key: t.key, label: t.label, hard: t.hard, selling: computeStandalone(envelope, t.hard || 0) })) }
    },
    totalHard: (roofTier?.hard || 0) + trimItems.reduce((s, t) => s + (t.hard || 0), 0),
    sellingPre,
    sellingWithTax: Math.round(sellingPre * 1.15)
  };
}

/**
 * Compute the "$X if bought separately" comparison number.
 * Sum of standalone prices for each selected component.
 */
export function computeAloneTotal(envelope, selections) {
  const system    = selections?.system || envelope?.default_system || 'metal';
  const roofTier  = getRoofTier(envelope, system, selections?.roof);
  const sidingTier = getSidingTier(envelope, selections?.siding);
  const trimSel = selections?.trim || {};

  let total = 0;
  if (roofTier) total += computeStandalone(envelope, roofTier.hard || 0);
  if (sidingTier && sidingTier.tier > 0) {
    // Siding alone includes wall assembly (since you can't install siding without it)
    const wallHard = envelope?.components?.wall_assembly?.hard || 0;
    total += computeStandalone(envelope, (sidingTier.hard || 0) + wallHard);
  }
  for (const k of ['gutters', 'soffit', 'fascia']) {
    if (trimSel[k]) {
      const t = getTrim(envelope, k);
      if (t) total += computeStandalone(envelope, t.hard || 0);
    }
  }
  return total;
}

/**
 * Resolve which cash discount tier (if any) applies for a given bundle price.
 * Returns the matching tier object plus computed dollar amount.
 */
export function getCashDiscount(envelope, bundlePreTax) {
  const tiers = envelope?.cash_discount_tiers || DEFAULT_CASH_DISCOUNT_TIERS;
  // Highest matching threshold wins
  const sorted = [...tiers].sort((a, b) => b.threshold - a.threshold);
  for (const t of sorted) {
    if (bundlePreTax >= t.threshold) {
      const dollars = Math.round(bundlePreTax * t.pct / 100);
      return { ...t, applies: true, dollars };
    }
  }
  // Otherwise return next-up target so the UI can render the meter
  const ascending = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const next = ascending.find(t => t.threshold > bundlePreTax);
  return next
    ? { ...next, applies: false, dollars: Math.round(next.threshold * next.pct / 100), distance: next.threshold - bundlePreTax }
    : null;
}

/**
 * Top-level compute. Returns everything the configurator UI needs to render.
 *   { packageName, bundle, alonePreTax, savings, cashDiscount, finalSelling, finalWithTax }
 */
export function computeEnvelope(envelope, selections) {
  if (!envelope) {
    return { error: 'No envelope configured for this estimate' };
  }
  const bundle = computeBundle(envelope, selections);
  const alonePreTax = computeAloneTotal(envelope, selections);
  const savings = Math.max(0, alonePreTax - bundle.sellingPre);
  const cashDiscount = getCashDiscount(envelope, bundle.sellingPre);
  const cashOff = (cashDiscount && cashDiscount.applies) ? cashDiscount.dollars : 0;
  const finalSelling = bundle.sellingPre - cashOff;
  const finalWithTax = Math.round(finalSelling * 1.15);

  return {
    packageName: getPackageName(envelope, selections),
    selections,
    bundle,
    alonePreTax,
    aloneWithTax: Math.round(alonePreTax * 1.15),
    savings,
    savingsWithTax: Math.round(savings * 1.15),
    cashDiscount,
    cashOff,
    finalSelling,
    finalWithTax
  };
}
