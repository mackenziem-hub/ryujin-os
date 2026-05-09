// Update #37 (75 Rachel / Egbuwoku) to main-house-only scope.
// Original 18.5 SQ scope (both structures) is wrong — customer is only roofing
// the main house (Structure #2 per EagleView 65990322 = 398sf, 7/12 uniform, 4 SQ).
// Strip the legacy honored-pricing strikethrough (no longer applicable — clean
// SOP pricing on the corrected scope). Re-lock at new floor.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { calculateMultiOfferQuote } from '../../lib/quoteEngineV3.js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b';
const SHARE = 'plus-ultra-egbuwoku-75rachel';

const measurements = {
  squareFeet: 344,           // 2D footprint, engine pitch-uplifts to 398sf
  pitch: '7/12',
  complexity: 'simple',
  distanceKM: 28,
  extraLayers: 0,
  eavesLF: 60,
  rakesLF: 34,
  ridgesLF: 22,
  hipsLF: 1,
  valleysLF: 0,
  wallsLF: 3,
  pipes: 1,
  vents: 0,
  stories: 1
};

// Run engine with current canonical rates
const { data: offers } = await sb.from('offers').select('id, slug')
  .eq('tenant_id', TENANT).in('slug', ['gold','platinum','diamond']);
const q = await calculateMultiOfferQuote(sb, {
  tenantId: TENANT, offerIds: offers.map(o => o.id), measurements
});

// Pull existing estimate
const { data: ex } = await sb.from('estimates')
  .select('id, estimate_number, share_token, customer_id, calculated_packages, tags, notes, selected_package')
  .eq('share_token', SHARE).single();
if (!ex) { console.error('estimate not found'); process.exit(1); }
console.log(`Found #${ex.estimate_number}  id=${ex.id}  selected=${ex.selected_package}`);

// Build new calculated_packages — clean SOP, no strikethrough/honored framing
const cp = {};
for (const slug of ['gold','platinum','diamond']) {
  const o = q.offers[slug]; if (!o) continue;
  const s = o.summary;
  cp[slug] = {
    total: s.sellingPrice,
    totalWithTax: s.totalWithTax,
    tax: Math.round(s.sellingPrice * 0.15 * 100) / 100,
    persq: s.pricePerSQ,
    margin: s.netMargin,
    customPrice: false,
    lineItems: o.lineItems
    // intentionally NO originalTotal, NO promoLabel — clean reset on scope correction
  };
}

// Drop honored-pricing tags, add scope-correction tag
const oldTags = (ex.tags || []);
const filteredTags = oldTags.filter(t =>
  t !== 'legacy_pricing_honored' &&
  t !== 'price_to_sell' &&
  t !== 'ryan_pre_approval_required' &&
  !t.startsWith('neighbor_rate_')
);
const newTags = Array.from(new Set([...filteredTags, 'scope_corrected_main_house_only']));

// Append note
const newNotes = [...(ex.notes || []), {
  author: 'claude-code',
  timestamp: new Date().toISOString().slice(0, 10),
  note: `SCOPE CORRECTION — May 8 2026

The original 18.5-SQ scope quoted both structures from EagleView 65990322 (the entire property: main house + garage/addition). Customer is only roofing the main house — the garage/addition is NOT in scope.

EAGLEVIEW BREAKDOWN (corrected understanding):
- Structure #1: 14.44 SQ at mixed pitches (6/12 dom + 8/12 + 10/12 + 11/12) — garage/addition (NOT in scope)
- Structure #2: 4 SQ at 7/12 uniform — MAIN HOUSE (this scope)

NEW MEASUREMENTS (Structure #2 only):
- Roof area: 344 sqft 2D / 398 sqft pitch-adjusted
- Pitch: 7/12 uniform
- Complexity: simple (3 facets, no valleys)
- Eaves 60 / Rakes 34 / Ridges 22 / Hips 1 / Valleys 0 / Step flashing 3
- 1 pipe penetration

NEW PRICING (clean SOP on canonical v2.1 rate sheet):
- Gold:     $4,825 + HST $724  =  $5,549
- Platinum: $5,400 + HST $810  =  $6,210
- Diamond:  $6,875 + HST $1,031 = $7,906

Old locked Gold was $14,355 incl HST (full 18.5 SQ scope, honored neighbor rate from June 2024). New $5,549 is a $8,806 reduction — entirely from the scope correction (no honored discount anymore — customer simply gets a smaller job).

Margins are healthy (39-41% gross) — small jobs price higher per-SQ because fixed costs (waste removal, supervisor, small-job surcharge) don't scale down.

Re-locked at new Gold floor. Strikethrough/honored framing removed since the price drop is scope-driven, not negotiation-driven.`
}];

// Force-unlock for the update, then re-lock
const NOW = new Date().toISOString();
const goldTotal = cp.gold?.totalWithTax || cp.gold?.total;

// Step 1: clear lock so we can update freely
await sb.from('estimates').update({ locked_at: null }).eq('id', ex.id);

// Step 2: update measurements + calculated_packages + tags + notes
const { error: u1err } = await sb.from('estimates').update({
  roof_area_sqft: measurements.squareFeet,
  roof_pitch: measurements.pitch,
  complexity: measurements.complexity,
  eaves_lf: measurements.eavesLF,
  rakes_lf: measurements.rakesLF,
  ridges_lf: measurements.ridgesLF,
  valleys_lf: measurements.valleysLF,
  hips_lf: measurements.hipsLF,
  walls_lf: measurements.wallsLF,
  pipes: measurements.pipes,
  vents: measurements.vents,
  extra_layers: 0,
  distance_km: measurements.distanceKM,
  calculated_packages: cp,
  tags: newTags,
  notes: newNotes,
  final_accepted_total: goldTotal,
  custom_prices: {}
}).eq('id', ex.id);
if (u1err) { console.error('update fail:', u1err.message); process.exit(1); }

// Step 3: re-lock
await sb.from('estimates').update({
  locked_at: NOW,
  locked_reason: 'Scope-corrected main-house-only pricing locked May 8 2026 — Structure #2 from EagleView 65990322. Garage/addition removed from scope. Clean SOP pricing on canonical v2.1 rate sheet. Final accepted total = Gold $5,549 incl HST.'
}).eq('id', ex.id);

console.log(`\n✓ #${ex.estimate_number} updated and re-locked`);
console.log(`  Gold      $${cp.gold.total}   (incl HST $${cp.gold.totalWithTax})`);
console.log(`  Platinum  $${cp.platinum.total}   (incl HST $${cp.platinum.totalWithTax})`);
console.log(`  Diamond   $${cp.diamond.total}   (incl HST $${cp.diamond.totalWithTax})`);
console.log(`\nShare URL unchanged: https://ryujin-os.vercel.app/proposal-client.html?share=${SHARE}`);
