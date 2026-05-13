// Restored 2026-05-13: file existed on prod (shipped May 12) but vanished from local fs.
// Math reconstructed from reference_gutter_rates_may12.md + Lefurgey #62 ($2,794.50 incl HST · 110 LF · 2 corners · 4 drops).
// If Lefurgey or any other live gutter quote needs to be matched exactly, verify against the saved estimate row.

const HST_RATE = 0.15;

const DEFAULTS = {
  materials_per_lf: 11,
  labor_per_lf_1story: 8,
  labor_per_lf_2story: 12,
  corner_each: 25,
  drop_each: 0,
  leaf_guard_per_lf: 6,
  travel_free_km: 40,
  travel_per_km: 5,
  hst_rate: HST_RATE
};

export async function loadGutterRates(supabaseAdmin, tenantId) {
  try {
    const { data } = await supabaseAdmin
      .from('tenant_settings')
      .select('gutter_rates')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    const stored = data?.gutter_rates || {};
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

export function calculateGutterQuote(input = {}, ratesIn = {}) {
  const rates = { ...DEFAULTS, ...(ratesIn || {}) };
  const lfLower = Number(input.lf_lower) || 0;
  const lfUpper = Number(input.lf_upper) || 0;
  const corners = Number(input.corners) || 0;
  const drops = Number(input.drops) || 0;
  const distanceKm = Number(input.distance_km) || 0;
  const leafGuardLf = input.leaf_guard ? (Number(input.leaf_guard_lf) || (lfLower + lfUpper)) : 0;
  const color = input.color || null;

  const totalLf = lfLower + lfUpper;
  const materials = totalLf * rates.materials_per_lf;
  const labor1 = lfLower * rates.labor_per_lf_1story;
  const labor2 = lfUpper * rates.labor_per_lf_2story;
  const cornersCost = corners * rates.corner_each;
  const dropsCost = drops * rates.drop_each;
  const leafGuardCost = leafGuardLf * rates.leaf_guard_per_lf;
  const travelCost = distanceKm > rates.travel_free_km
    ? (distanceKm - rates.travel_free_km) * rates.travel_per_km
    : 0;

  const subtotal = materials + labor1 + labor2 + cornersCost + dropsCost + leafGuardCost + travelCost;
  const hst = +(subtotal * rates.hst_rate).toFixed(2);
  const total = +(subtotal + hst).toFixed(2);

  const lineItems = [
    { label: 'Gutter materials',        qty: totalLf,      unit: 'LF',    rate: rates.materials_per_lf,        amount: +materials.toFixed(2) },
    { label: 'Labor — lower (1-story)', qty: lfLower,      unit: 'LF',    rate: rates.labor_per_lf_1story,     amount: +labor1.toFixed(2) },
    { label: 'Labor — upper (2-story)', qty: lfUpper,      unit: 'LF',    rate: rates.labor_per_lf_2story,     amount: +labor2.toFixed(2) },
    { label: 'Corners',                 qty: corners,      unit: 'each',  rate: rates.corner_each,             amount: +cornersCost.toFixed(2) },
    { label: 'Downspouts (drops)',      qty: drops,        unit: 'each',  rate: rates.drop_each,               amount: +dropsCost.toFixed(2) },
    { label: 'Leaf guard',              qty: leafGuardLf,  unit: 'LF',    rate: rates.leaf_guard_per_lf,       amount: +leafGuardCost.toFixed(2) },
    { label: 'Travel surcharge',        qty: Math.max(0, distanceKm - rates.travel_free_km), unit: 'km', rate: rates.travel_per_km, amount: +travelCost.toFixed(2) }
  ].filter(li => li.qty > 0 && li.amount >= 0);

  return {
    subtotal: +subtotal.toFixed(2),
    hst,
    total,
    lineItems,
    breakdown: {
      materials: +materials.toFixed(2),
      labor: +(labor1 + labor2).toFixed(2),
      corners: +cornersCost.toFixed(2),
      drops: +dropsCost.toFixed(2),
      leaf_guard: +leafGuardCost.toFixed(2),
      travel: +travelCost.toFixed(2)
    },
    inputs: { lf_lower: lfLower, lf_upper: lfUpper, corners, drops, color, distance_km: distanceKm, leaf_guard: !!input.leaf_guard, leaf_guard_lf: leafGuardLf },
    rates
  };
}
