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
    chimney_flash_steel: 75,             // steel/metal chimney or wood-stove flue (smaller scope than brick)
    skylight_swap: 75,
    skylight_full_replacement: 500,
    pipe_boot_each: 25,                   // pipe boots, hydro masts, and similar small flashings (was 20, raised Apr 27)
    dormer_counter_flash: 50,
    step_flash_spot_repair: 50,

    // Linear runs
    ridge_vent_per_lf: 1.50, // actualized — agreement says $1, Ryan bills $1.50 consistently
    valley_metal_per_lf: 1,

    // Specialty shingles
    grand_manor_premium_per_sq: 75,

    // Architectural details (flat rates, per occurrence)
    pigeon_brow_single_story: 50,    // flat per occurrence
    pigeon_brow_two_story: 75,        // flat per occurrence
    bay_window_standard: 100,         // flat per occurrence
    bay_window_oversized: 125,        // flat per occurrence
    mansard_treatment: 'steep_tier',  // signals: price mansard SQ at the steep pitch tier rate (10-12/12 = $190/SQ)
    mansard_per_sq_override: 190,     // explicit fallback if the helper isn't used


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

// ─── Shared compute ──────────────────────────────────────────
// Single source of truth used by BOTH:
//   - api/paysheet-calc.js (pre-job sub paysheet preview)
//   - lib/quoteEngineV3.js (replace flat $130/SQ labor with the real cost stack)
//
// Inputs:
//   measurements: { totalSQ, pitch, distanceKM, extraLayers, redeck_sheets_count,
//                   deck_supply, pipes, vents, chimneys, skylights_swap,
//                   skylights_full_replacement, ridgesLF, valleysLF }
//   package_tier: optional string ('grand_manor' triggers premium per-SQ)
//   scope_extras: { metal_bend_sub_supplied, metal_bend_pu_supplied,
//                   dormer_counter_flash_count, pigeon_brows_single,
//                   pigeon_brows_two_story, bay_windows_standard,
//                   bay_windows_oversized, mansard_sq, custom_lines: [...] }
//   sub_slug: rate sheet key (default: 'atlantic-roofing')
//
// Returns: { labour_breakdown, add_ons, surcharges, subtotal, hst, total,
//            computed_from }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function line(label, qty, unit, rate, total) {
  return {
    label,
    qty: round2(qty),
    unit,
    rate: round2(rate),
    total: round2(total)
  };
}

export function computeSubPaysheet(measurements = {}, package_tier = null, scope_extras = {}, sub_slug = 'atlantic-roofing') {
  const m = measurements || {};
  const totalSQ = Number(m.totalSQ) || 0;
  if (!totalSQ || totalSQ <= 0) {
    throw new Error('measurements.totalSQ is required and must be > 0');
  }

  const rates = getRateSheet(sub_slug);
  const pitchTier = pickPitchTier(m.pitch);
  const basePerSQ = rates.base_per_sq[pitchTier];
  if (!basePerSQ) {
    throw new Error(`No base rate for pitch tier "${pitchTier}"`);
  }

  // ── LABOR BREAKDOWN ─────────────────────────────────────────
  const labour_breakdown = [];

  labour_breakdown.push(line(
    `Base labor — ${pitchTier}/12 pitch`,
    totalSQ, 'SQ', basePerSQ, totalSQ * basePerSQ
  ));

  const extraLayers = Number(m.extraLayers) || 0;
  if (extraLayers > 0) {
    labour_breakdown.push(line(
      `Extra layer tear-off (${extraLayers} layer${extraLayers > 1 ? 's' : ''})`,
      totalSQ * extraLayers, 'SQ', rates.extra_layer_per_sq,
      totalSQ * extraLayers * rates.extra_layer_per_sq
    ));
  }

  const redeckSheets = Number(m.redeck_sheets_count) || Number(m.redeckSheets) || 0;
  if (redeckSheets > 0) {
    const deckSupply = m.deck_supply || 'pu';
    const deckRate = deckSupply === 'sub'
      ? rates.deck_sub_supplied_per_sheet
      : rates.deck_pu_supplied_per_sheet;
    labour_breakdown.push(line(
      `Re-decking — ${redeckSheets} sheets (${deckSupply === 'sub' ? 'sub-supplied' : 'PU-supplied'})`,
      redeckSheets, 'sheet', deckRate, redeckSheets * deckRate
    ));
  }

  const pipes = Number(m.pipes) || 0;
  if (pipes > 0) {
    labour_breakdown.push(line(
      `Pipe boots`,
      pipes, 'each', rates.pipe_boot_each, pipes * rates.pipe_boot_each
    ));
  }

  const vents = Number(m.vents) || 0;
  if (vents > 0) {
    labour_breakdown.push(line(
      `Vent flashing`,
      vents, 'each', rates.pipe_boot_each, vents * rates.pipe_boot_each
    ));
  }

  const chimneys = m.chimneys;
  if (chimneys) {
    if (Array.isArray(chimneys)) {
      for (const c of chimneys) {
        const ct = Number(c.count) || 0;
        const sz = String(c.size || 'small').toLowerCase();
        const r = (sz === 'large') ? rates.chimney_flash_large
                : (sz === 'steel' || sz === 'metal') ? rates.chimney_flash_steel
                : rates.chimney_flash_small_med;
        if (ct > 0) {
          labour_breakdown.push(line(
            `Chimney flashing (${sz})`,
            ct, 'each', r, ct * r
          ));
        }
      }
    } else if (typeof chimneys === 'object') {
      const ct = Number(chimneys.count) || 0;
      const sz = String(chimneys.size_each || chimneys.size || 'small').toLowerCase();
      const r = (sz === 'large') ? rates.chimney_flash_large
                : (sz === 'steel' || sz === 'metal') ? rates.chimney_flash_steel
                : rates.chimney_flash_small_med;
      if (ct > 0) {
        labour_breakdown.push(line(
          `Chimney flashing (${sz})`,
          ct, 'each', r, ct * r
        ));
      }
    } else if (typeof chimneys === 'number' && chimneys > 0) {
      const sz = String(m.chimneySize || 'small').toLowerCase();
      const r = (sz === 'large') ? rates.chimney_flash_large
                : (sz === 'steel' || sz === 'metal') ? rates.chimney_flash_steel
                : rates.chimney_flash_small_med;
      labour_breakdown.push(line(
        `Chimney flashing (${sz})`,
        chimneys, 'each', r, chimneys * r
      ));
    }
  }

  const skylightsSwap = Number(m.skylights_swap) || 0;
  if (skylightsSwap > 0) {
    labour_breakdown.push(line(
      `Skylight swap (basic)`,
      skylightsSwap, 'each', rates.skylight_swap, skylightsSwap * rates.skylight_swap
    ));
  }
  const skylightsFull = Number(m.skylights_full_replacement) || 0;
  if (skylightsFull > 0) {
    labour_breakdown.push(line(
      `Skylight full replacement (tear-out + frame + reflash)`,
      skylightsFull, 'each', rates.skylight_full_replacement,
      skylightsFull * rates.skylight_full_replacement
    ));
  }

  const ridgesLF = Number(m.ridgesLF) || 0;
  if (ridgesLF > 0) {
    labour_breakdown.push(line(
      `Ridge vent`,
      ridgesLF, 'LF', rates.ridge_vent_per_lf, ridgesLF * rates.ridge_vent_per_lf
    ));
  }

  const valleysLF = Number(m.valleysLF) || 0;
  if (valleysLF > 0) {
    labour_breakdown.push(line(
      `Valley metal`,
      valleysLF, 'LF', rates.valley_metal_per_lf, valleysLF * rates.valley_metal_per_lf
    ));
  }

  // ── ADD-ONS ─────────────────────────────────────────────────
  const add_ons = [];

  if (scope_extras.metal_bend_sub_supplied) {
    const ct = Number(scope_extras.metal_bend_sub_supplied) || 0;
    if (ct > 0) {
      add_ons.push({
        label: `Custom brake metal (sub-supplied) — ${ct} run${ct > 1 ? 's' : ''}`,
        total: round2(ct * rates.metal_bend_sub_supplied)
      });
    }
  }
  if (scope_extras.metal_bend_pu_supplied) {
    const ct = Number(scope_extras.metal_bend_pu_supplied) || 0;
    if (ct > 0) {
      add_ons.push({
        label: `Custom brake metal (PU-supplied) — ${ct} run${ct > 1 ? 's' : ''}`,
        total: round2(ct * rates.metal_bend_pu_supplied)
      });
    }
  }

  if (scope_extras.dormer_counter_flash_count) {
    const ct = Number(scope_extras.dormer_counter_flash_count) || 0;
    if (ct > 0) {
      add_ons.push({
        label: `Dormer counter flashing — ${ct} dormer${ct > 1 ? 's' : ''}`,
        total: round2(ct * rates.dormer_counter_flash)
      });
    }
  }

  if (scope_extras.pigeon_brows_single) {
    const ct = Number(scope_extras.pigeon_brows_single) || 0;
    if (ct > 0 && rates.pigeon_brow_single_story) {
      labour_breakdown.push(line(
        `Pigeon brow flashing (single-story)`,
        ct, 'each', rates.pigeon_brow_single_story, ct * rates.pigeon_brow_single_story
      ));
    }
  }
  if (scope_extras.pigeon_brows_two_story) {
    const ct = Number(scope_extras.pigeon_brows_two_story) || 0;
    if (ct > 0 && rates.pigeon_brow_two_story) {
      labour_breakdown.push(line(
        `Pigeon brow flashing (two-story)`,
        ct, 'each', rates.pigeon_brow_two_story, ct * rates.pigeon_brow_two_story
      ));
    }
  }

  if (scope_extras.bay_windows_standard) {
    const ct = Number(scope_extras.bay_windows_standard) || 0;
    if (ct > 0 && rates.bay_window_standard) {
      labour_breakdown.push(line(
        `Bay window roof (standard)`,
        ct, 'each', rates.bay_window_standard, ct * rates.bay_window_standard
      ));
    }
  }
  if (scope_extras.bay_windows_oversized) {
    const ct = Number(scope_extras.bay_windows_oversized) || 0;
    if (ct > 0 && rates.bay_window_oversized) {
      labour_breakdown.push(line(
        `Bay window roof (oversized)`,
        ct, 'each', rates.bay_window_oversized, ct * rates.bay_window_oversized
      ));
    }
  }

  if (scope_extras.mansard_sq) {
    const sq = Number(scope_extras.mansard_sq) || 0;
    if (sq > 0) {
      const mansardRate = rates.mansard_per_sq_override
        || rates.base_per_sq['10-12']
        || basePerSQ;
      labour_breakdown.push(line(
        `Mansard accent (steep tier rate)`,
        sq, 'SQ', mansardRate, sq * mansardRate
      ));
    }
  }

  if (Array.isArray(scope_extras.custom_lines)) {
    for (const cl of scope_extras.custom_lines) {
      add_ons.push({
        label: cl.label || 'Custom line',
        total: round2(cl.total || (Number(cl.qty || 0) * Number(cl.rate || 0)))
      });
    }
  }

  // ── SURCHARGES ──────────────────────────────────────────────
  const surcharges = [];
  const distanceKM = m.distanceKM;

  const travelRate = pickTravelPerSQ(rates, distanceKM);
  if (travelRate > 0) {
    surcharges.push({
      label: `Travel surcharge (${distanceKM} km) — ${travelRate}/SQ`,
      total: round2(totalSQ * travelRate)
    });
  }

  if (String(package_tier || '').toLowerCase() === 'grand_manor') {
    surcharges.push({
      label: `Grand Manor premium (+${rates.grand_manor_premium_per_sq}/SQ)`,
      total: round2(totalSQ * rates.grand_manor_premium_per_sq)
    });
  }

  const wasteRate = pickWasteRemovalRate(rates, distanceKM);
  surcharges.push({
    label: `Waste removal (${rates.contact || 'sub'}-supplied)`,
    total: round2(wasteRate)
  });

  // ── TOTALS ──────────────────────────────────────────────────
  const subtotal = round2(
    labour_breakdown.reduce((s, l) => s + (Number(l.total) || 0), 0) +
    add_ons.reduce((s, a) => s + (Number(a.total) || 0), 0) +
    surcharges.reduce((s, x) => s + (Number(x.total) || 0), 0)
  );
  const hst = round2(subtotal * 0.15);
  const total = round2(subtotal + hst);

  return {
    labour_breakdown,
    add_ons,
    surcharges,
    subtotal,
    hst,
    total,
    computed_from: {
      sub_slug,
      sub_name: rates.name,
      sub_contact: rates.contact,
      pitch_tier: pitchTier,
      package_tier: package_tier || null,
      rate_sheet_version: RATE_SHEET_VERSION
    }
  };
}
