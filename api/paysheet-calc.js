// Ryujin OS — Pay Sheet Calculator
// POST /api/paysheet-calc
// Server-side compute of subcontractor labor breakdown + add-ons + surcharges + totals.
// Source of truth: lib/subcontractor-rates.js
//
// Designed to be called by chat tool compute_paysheet_lines BEFORE create_paysheet,
// so the brain never inserts an empty paysheet again.
import { requireTenant } from '../lib/tenant.js';
import {
  getRateSheet,
  pickPitchTier,
  pickWasteRemovalRate,
  pickTravelPerSQ,
  RATE_SHEET_VERSION
} from '../lib/subcontractor-rates.js';

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

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const {
    subcontractor_slug,
    customer_name,
    address,
    job_id,
    measurements = {},
    package_tier,
    scope_extras = {}
  } = body;

  if (!subcontractor_slug) {
    return res.status(400).json({ error: 'subcontractor_slug is required (e.g. "atlantic-roofing")' });
  }

  const m = measurements;
  const totalSQ = Number(m.totalSQ) || 0;
  if (!totalSQ || totalSQ <= 0) {
    return res.status(400).json({ error: 'measurements.totalSQ is required and must be > 0' });
  }

  let rates;
  try {
    rates = getRateSheet(subcontractor_slug);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const pitchTier = pickPitchTier(m.pitch);
  const basePerSQ = rates.base_per_sq[pitchTier];
  if (!basePerSQ) {
    return res.status(400).json({ error: `No base rate for pitch tier "${pitchTier}"` });
  }

  // ── LABOR BREAKDOWN ─────────────────────────────────────────
  const labour_breakdown = [];

  // Base labor
  labour_breakdown.push(line(
    `Base labor — ${pitchTier}/12 pitch`,
    totalSQ, 'SQ', basePerSQ, totalSQ * basePerSQ
  ));

  // Extra layer tear-off (per layer per SQ)
  const extraLayers = Number(m.extraLayers) || 0;
  if (extraLayers > 0) {
    labour_breakdown.push(line(
      `Extra layer tear-off (${extraLayers} layer${extraLayers > 1 ? 's' : ''})`,
      totalSQ * extraLayers, 'SQ', rates.extra_layer_per_sq,
      totalSQ * extraLayers * rates.extra_layer_per_sq
    ));
  }

  // Decking (re-deck sheets)
  const redeckSheets = Number(m.redeck_sheets_count) || 0;
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

  // Pipes
  const pipes = Number(m.pipes) || 0;
  if (pipes > 0) {
    labour_breakdown.push(line(
      `Pipe boots`,
      pipes, 'each', rates.pipe_boot_each, pipes * rates.pipe_boot_each
    ));
  }

  // Vents (priced as pipe boots per spec)
  const vents = Number(m.vents) || 0;
  if (vents > 0) {
    labour_breakdown.push(line(
      `Vent flashing`,
      vents, 'each', rates.pipe_boot_each, vents * rates.pipe_boot_each
    ));
  }

  // Chimneys — accept either count + size_each: 'small'|'medium'|'large'
  // OR an array of objects [{ size: 'small'|'large', count: N }] for flexibility.
  const chimneys = m.chimneys;
  let chimneyTotal = 0;
  if (chimneys) {
    if (Array.isArray(chimneys)) {
      for (const c of chimneys) {
        const ct = Number(c.count) || 0;
        const sz = String(c.size || 'small').toLowerCase();
        const r = (sz === 'large') ? rates.chimney_flash_large : rates.chimney_flash_small_med;
        if (ct > 0) {
          labour_breakdown.push(line(
            `Chimney flashing (${sz})`,
            ct, 'each', r, ct * r
          ));
          chimneyTotal += ct * r;
        }
      }
    } else if (typeof chimneys === 'object') {
      // { count, size_each }
      const ct = Number(chimneys.count) || 0;
      const sz = String(chimneys.size_each || chimneys.size || 'small').toLowerCase();
      const r = (sz === 'large') ? rates.chimney_flash_large : rates.chimney_flash_small_med;
      if (ct > 0) {
        labour_breakdown.push(line(
          `Chimney flashing (${sz})`,
          ct, 'each', r, ct * r
        ));
        chimneyTotal += ct * r;
      }
    } else if (typeof chimneys === 'number' && chimneys > 0) {
      // bare number — assume small/medium
      labour_breakdown.push(line(
        `Chimney flashing (small/medium)`,
        chimneys, 'each', rates.chimney_flash_small_med,
        chimneys * rates.chimney_flash_small_med
      ));
      chimneyTotal += chimneys * rates.chimney_flash_small_med;
    }
  }

  // Skylights
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

  // Ridge vent
  const ridgesLF = Number(m.ridgesLF) || 0;
  if (ridgesLF > 0) {
    labour_breakdown.push(line(
      `Ridge vent`,
      ridgesLF, 'LF', rates.ridge_vent_per_lf, ridgesLF * rates.ridge_vent_per_lf
    ));
  }

  // Valley metal
  const valleysLF = Number(m.valleysLF) || 0;
  if (valleysLF > 0) {
    labour_breakdown.push(line(
      `Valley metal`,
      valleysLF, 'LF', rates.valley_metal_per_lf, valleysLF * rates.valley_metal_per_lf
    ));
  }

  // ── ADD-ONS ─────────────────────────────────────────────────
  const add_ons = [];

  // Metal bending — sub-supplied vs PU-supplied (passed via scope_extras)
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

  // Dormer counter flashing (when not rolled into generalized metal)
  if (scope_extras.dormer_counter_flash_count) {
    const ct = Number(scope_extras.dormer_counter_flash_count) || 0;
    if (ct > 0) {
      add_ons.push({
        label: `Dormer counter flashing — ${ct} dormer${ct > 1 ? 's' : ''}`,
        total: round2(ct * rates.dormer_counter_flash)
      });
    }
  }

  // Custom lines passthrough — already-priced extras
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

  // Travel per-SQ
  const travelRate = pickTravelPerSQ(rates, m.distanceKM);
  if (travelRate > 0) {
    surcharges.push({
      label: `Travel surcharge (${m.distanceKM} km) — ${travelRate}/SQ`,
      total: round2(totalSQ * travelRate)
    });
  }

  // Grand Manor premium
  if (String(package_tier || '').toLowerCase() === 'grand_manor') {
    surcharges.push({
      label: `Grand Manor premium (+${rates.grand_manor_premium_per_sq}/SQ)`,
      total: round2(totalSQ * rates.grand_manor_premium_per_sq)
    });
  }

  // Waste removal — distance-tiered flat
  const wasteRate = pickWasteRemovalRate(rates, m.distanceKM);
  surcharges.push({
    label: `Waste removal (Ryan-supplied)`,
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

  return res.json({
    labour_breakdown,
    add_ons,
    surcharges,
    subtotal,
    hst,
    total,
    computed_from: {
      sub_slug: subcontractor_slug,
      sub_name: rates.name,
      sub_contact: rates.contact,
      pitch_tier: pitchTier,
      package_tier: package_tier || null,
      job_id: job_id || null,
      customer_name: customer_name || null,
      address: address || null,
      rate_sheet_version: RATE_SHEET_VERSION
    }
  });
}

export default requireTenant(handler);
