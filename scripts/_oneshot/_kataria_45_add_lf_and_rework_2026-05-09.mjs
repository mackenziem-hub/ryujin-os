// Kataria #45 — add proper LF measurements + vinyl siding rework on rake walls.
// Re-runs quote engine for all 6 tiers (asphalt + metal) with the corrected
// scope, merges into calculated_packages. Asphalt tiers re-quoted (now include
// rake trim + drip edge LF properly); metal tiers re-quoted WITH a vinyl
// siding rework extras line.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const RYUJIN = 'https://ryujin-os.vercel.app';
const TENANT_SLUG = 'plus-ultra';
const TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b';
const HEADERS = { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_SLUG };

// ─── LF measurements derived from planes + footprint estimate ─────────
// Per Mac directive: "rakes go across the side gables and across the front
// of the house" + plane geometry (Upper main 960sqft @ 5/12 + Side rakes
// 80sqft @ 12/12 + Front rake 57sqft @ 12/12) on a 1097 sqft single-story.
const measurements = {
  squareFeet: 1097,
  pitch: '5/12',
  complexity: 'medium',
  distanceKM: 0,
  extraLayers: 0,
  eavesLF: 60,         // front + back lower edges of main roof
  rakesLF: 75,         // main 5/12 gable rake edges + 12/12 return rake edges
  ridgesLF: 30,        // typical for a 30x32 single-story
  hipsLF: 0,
  valleysLF: 12,       // small valley where front rake meets main roof
  wallsLF: 50,         // rake-return-to-wall intersection (side gables + front)
  pipes: 1,
  vents: 0,
  stories: 1,
  chimneys: 0,
  chimneySize: 'small',
  // Vinyl siding rework cost is metal-only (asphalt install doesn't disturb siding)
  // ~50 LF × $20/LF (combined material + labor for remove + reinstall + replacement
  // pieces for ones that crack on removal). Medium NB rate for regular vinyl.
};

const planes = [
  { sqft: 960, label: 'Upper main', pitch: '5/12' },
  { sqft: 80, label: 'Side rakes', pitch: '12/12' },
  { sqft: 57, label: 'Front rake', pitch: '12/12' }
];

// ─── Step 1: Update estimate #45 with the LF measurements ─────────────
const { error: updateMErr } = await sb.from('estimates').update({
  eaves_lf: measurements.eavesLF,
  rakes_lf: measurements.rakesLF,
  ridges_lf: measurements.ridgesLF,
  hips_lf: measurements.hipsLF,
  valleys_lf: measurements.valleysLF,
  walls_lf: measurements.wallsLF
}).eq('estimate_number', 45);
if (updateMErr) { console.error('measurement update failed:', updateMErr.message); process.exit(1); }
console.log('✓ #45 measurements updated (eaves 60, rakes 75, ridges 30, valleys 12, walls 50)');

// ─── Step 2: Get all 6 offer IDs ──────────────────────────────────────
const { data: offers } = await sb.from('offers')
  .select('id, slug, name, offer_category')
  .eq('tenant_id', TENANT_ID)
  .in('slug', ['gold', 'platinum', 'diamond', 'metal-americana', 'metal-standing-seam', 'metal-premium']);

const asphaltOffers = offers.filter(o => ['gold','platinum','diamond'].includes(o.slug));
const metalOffers = offers.filter(o => o.slug.startsWith('metal-'));

console.log('\nAsphalt offers:', asphaltOffers.map(o => o.slug).join(', '));
console.log('Metal offers:', metalOffers.map(o => o.slug).join(', '));

// ─── Step 3: Quote asphalt tiers (no siding rework — install doesn't disturb siding) ───
async function compareQuote(offerIds, label, extras = []) {
  const r = await fetch(`${RYUJIN}/api/quote?mode=compare&tenant=${TENANT_SLUG}`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ measurements, offer_ids: offerIds, extras, planes })
  });
  if (!r.ok) {
    console.error(`${label} quote failed: ${r.status} ${(await r.text()).slice(0,400)}`);
    return null;
  }
  return r.json();
}

const asphaltCompare = await compareQuote(asphaltOffers.map(o => o.id), 'Asphalt');

// ─── Step 4: Quote metal tiers WITH vinyl siding rework extras ────────
const sidingReworkExtra = {
  label: 'Vinyl Siding Rework — Rake Walls',
  category: 'labor',
  unit: 'LF',
  quantity: 50,
  unit_cost: 20,            // $20/LF medium rate (remove + reinstall + replace cracked pieces, regular vinyl)
  notes: 'Pull, set aside, and reinstall regular vinyl siding along ~50 LF where rake-return roof planes meet the sidewalls. Includes replacement pieces for any that crack on removal. Required only on metal install — asphalt path leaves siding undisturbed.'
};

const metalCompare = await compareQuote(metalOffers.map(o => o.id), 'Metal', [sidingReworkExtra]);

// ─── Step 5: Shape the merged calculated_packages ─────────────────────
function shapeTier(o) {
  if (!o || !o.summary) return null;
  return {
    total: o.summary.sellingPrice,
    totalWithTax: o.summary.totalWithTax,
    persq: o.summary.pricePerSQ,
    tax: Math.round(o.summary.sellingPrice * 0.15),
    margin: o.summary.netMargin,
    customPrice: false,
    lineItems: o.lineItems
  };
}

const cp = {};
for (const slug of ['gold','platinum','diamond']) {
  const t = shapeTier(asphaltCompare?.offers?.[slug]);
  if (t) cp[slug] = t;
}
for (const slug of ['metal-americana','metal-standing-seam','metal-premium']) {
  const t = shapeTier(metalCompare?.offers?.[slug]);
  if (t) cp[slug] = t;
}

// ─── Step 6: Update #45 ───────────────────────────────────────────────
const { data: existing } = await sb.from('estimates').select('notes, tags').eq('estimate_number', 45).single();
const reworkNote = {
  author: 'claude-code',
  timestamp: new Date().toISOString().slice(0, 10),
  note: `LF measurements added + vinyl siding rework folded into metal tiers (May 9 2026). Per Mac: rakes wrap side gables + front; ~50 LF of regular vinyl siding rework on the rake-return-to-wall intersections. Asphalt tiers re-quoted with proper LF (rake trim + drip edge LF now correct). Metal tiers re-quoted with the same LF + a $1,000 extras line for vinyl siding rework ($20/LF × 50 LF, medium NB rate). Asphalt path unaffected by siding rework — install doesn't disturb the existing vinyl.`
};

const { error: cpErr } = await sb.from('estimates').update({
  calculated_packages: cp,
  notes: [...(existing.notes || []), reworkNote],
  tags: Array.from(new Set([...(existing.tags || []), 'siding_rework_in_metal', 'lf_corrected_2026-05-09']))
}).eq('estimate_number', 45);
if (cpErr) { console.error('cp update failed:', cpErr.message); process.exit(1); }

console.log('\n' + '='.repeat(78));
console.log('UPDATED PRICING — Kataria #45 (single proposal, dual system, siding rework folded in)');
console.log('='.repeat(78));
console.log(`\n  ASPHALT (siding undisturbed):`);
for (const k of ['gold','platinum','diamond']) {
  const t = cp[k]; if (!t) continue;
  console.log(`    ${k.padEnd(22)} $${t.total.toLocaleString().padStart(7)} pre-tax  /  $${(t.totalWithTax || 0).toLocaleString().padStart(7)} incl HST   margin ${t.margin}`);
}
console.log(`\n  METAL (includes ~50 LF vinyl siding rework on rake walls):`);
for (const k of ['metal-americana','metal-standing-seam','metal-premium']) {
  const t = cp[k]; if (!t) continue;
  const star = k === 'metal-standing-seam' ? '  ← recommended' : '';
  console.log(`    ${k.padEnd(22)} $${t.total.toLocaleString().padStart(7)} pre-tax  /  $${(t.totalWithTax || 0).toLocaleString().padStart(7)} incl HST   margin ${t.margin}${star}`);
}

console.log(`\n  Share: https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-45`);
console.log(`\n  Run scripts/_oneshot/_kataria_45_breakdown.mjs to dump line items per tier.`);
