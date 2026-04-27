// Ryujin OS — Subcontractor Rate Sheets
// Codified from Plus Ultra "project_pay_sheet_system" memory + actualized 10 Edgewater invoice (Apr 20 2026).
// One block per known sub. Single source of truth used by /api/paysheet-calc.
//
// Adding a new sub: add a slug entry under SUB_RATES with the same shape, then
// the chat tool compute_paysheet_lines will accept it without code changes.

export const RATE_SHEET_VERSION = '2025-12-01_actualized_2026-04-20';

export const SUB_RATES = {
  'atlantic-roofing': {
    name: 'Atlantic Roofing & Contracting',
    contact: 'Ryan Robertson',
    email: 'southcentralroof@gmail.com',

    // Base labor per SQ, by pitch tier (uses /12 numerator)
    base_per_sq: {
      '4-6':   130,
      '7-9':   160,
      '10-12': 190,
      '13+':   200
    },

    // Tear-off + decking
    extra_layer_per_sq: 40,
    deck_pu_supplied_per_sheet: 60,
    deck_sub_supplied_per_sheet: 100,

    // Carpentry
    carpentry_full_day: 500,
    carpentry_half_day: 300,

    // Metal work
    metal_bend_sub_supplied: 200,
    metal_bend_pu_supplied: 100,
    metal_flashing_generalized: 250, // covers dormer counter + wall flashing + misc

    // Penetrations
    chimney_flash_small_med: 150,
    chimney_flash_large: 200,
    skylight_swap: 75,
    skylight_full_replacement: 500,
    pipe_boot_each: 20,
    dormer_counter_flash: 50,
    step_flash_spot_repair: 50,

    // Linear runs
    ridge_vent_per_lf: 1.50, // actualized — agreement says $1, Ryan bills $1.50 consistently
    valley_metal_per_lf: 1,

    // Specialty shingles
    grand_manor_premium_per_sq: 75,

    // Travel surcharge by distance (km from Riverview)
    travel_per_sq_40_60km: 20,
    travel_per_sq_60plus_km: 30,

    // Waste removal flat by distance band
    waste_removal_in_town: 350,      // 0-20 km (Moncton/Riverview/Dieppe proper)
    waste_removal_out_of_town: 450,  // 20-60 km (Indian Mountain, Shediac)
    waste_removal_far: 550           // 60+ km (Amherst NS, etc.)
  }
};

// Map "10/12", "12/12", "5/12" → tier key
export function pickPitchTier(pitch) {
  if (!pitch) return '4-6';
  // Accept "10/12", "10:12", "10", "10-in-12", etc. — pull first integer.
  const match = String(pitch).match(/(\d+)/);
  if (!match) return '4-6';
  const n = parseInt(match[1], 10);
  if (n <= 6) return '4-6';
  if (n <= 9) return '7-9';
  if (n <= 12) return '10-12';
  return '13+';
}

// Distance band → waste removal rate (uses Atlantic's tier numbers)
export function pickWasteRemovalRate(rates, distanceKm) {
  const km = Number(distanceKm) || 0;
  if (km < 20) return rates.waste_removal_in_town;
  if (km < 60) return rates.waste_removal_out_of_town;
  return rates.waste_removal_far;
}

// Distance band → per-SQ travel surcharge (0 if local)
export function pickTravelPerSQ(rates, distanceKm) {
  const km = Number(distanceKm) || 0;
  if (km < 40) return 0;
  if (km < 60) return rates.travel_per_sq_40_60km;
  return rates.travel_per_sq_60plus_km;
}

// Resolve a rate sheet by slug. Throws if unknown — better to fail loud than guess.
export function getRateSheet(slug) {
  const key = String(slug || '').toLowerCase().trim();
  const rates = SUB_RATES[key];
  if (!rates) {
    throw new Error(`Unknown subcontractor slug "${slug}". Known: ${Object.keys(SUB_RATES).join(', ')}`);
  }
  return rates;
}
