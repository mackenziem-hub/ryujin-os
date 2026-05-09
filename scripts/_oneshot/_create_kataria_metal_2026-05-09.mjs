// Create Danish Kataria METAL proposal (parallel to existing asphalt #45).
// Same customer, same address (147 Evergreen Drive), same measurements;
// pricing computed against metal-americana / metal-standing-seam / metal-premium.
// Customer (id bd965311-e1b2-4d57-8bac-16de922ad3dc) and asphalt estimate #45
// stay untouched — Darcy gets both share links so Kataria can compare.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const RYUJIN = 'https://ryujin-os.vercel.app';
const TENANT_SLUG = 'plus-ultra';
const HEADERS = { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_SLUG };
const KATARIA_CUSTOMER_ID = 'bd965311-e1b2-4d57-8bac-16de922ad3dc';

// Pull measurements directly from estimate #45 so the metal proposal mirrors
// the asphalt one exactly. If the asphalt estimate is later edited, regenerate.
const { data: source } = await sb.from('estimates')
  .select('roof_area_sqft, roof_pitch, complexity, eaves_lf, rakes_lf, ridges_lf, valleys_lf, hips_lf, walls_lf, pipes, vents, chimneys, chimney_size, stories, extra_layers, distance_km, soffit_lf, fascia_lf, gutter_lf, ghl_opportunity_id, customer_id, planes')
  .eq('estimate_number', 45).single();
if (!source) { console.error('estimate #45 not found'); process.exit(1); }

const measurements = {
  squareFeet: source.roof_area_sqft,
  pitch: source.roof_pitch,
  complexity: source.complexity,
  distanceKM: source.distance_km || 0,
  extraLayers: source.extra_layers || 0,
  eavesLF: source.eaves_lf || 0,
  rakesLF: source.rakes_lf || 0,
  ridgesLF: source.ridges_lf || 0,
  hipsLF: source.hips_lf || 0,
  valleysLF: source.valleys_lf || 0,
  wallsLF: source.walls_lf || 0,
  pipes: source.pipes || 0,
  vents: source.vents || 0,
  stories: source.stories || 1,
  chimneys: source.chimneys || 0,
  chimneySize: source.chimney_size || 'small'
};
console.log('Source measurements:', JSON.stringify(measurements));

// Get metal offer IDs
const { data: metalOffers } = await sb.from('offers')
  .select('id, slug, name')
  .eq('tenant_id', '84c91cb9-df07-4424-8938-075e9c50cb3b')
  .like('slug', 'metal-%')
  .neq('slug', 'metal-shell')   // exterior shell, not roof tier
  .order('slug');
console.log('\nMetal offers:');
for (const o of metalOffers) console.log(`  ${o.slug} → ${o.name}`);

const offerIds = metalOffers.map(o => o.id);

// Compare-mode quote against metal offers only
const r = await fetch(`${RYUJIN}/api/quote?mode=compare&tenant=${TENANT_SLUG}`, {
  method: 'POST', headers: HEADERS,
  body: JSON.stringify({ measurements, offer_ids: offerIds })
});
if (!r.ok) {
  console.error(`quote failed: ${r.status} ${await r.text()}`);
  process.exit(1);
}
const compare = await r.json();
console.log('\nMetal pricing computed:');

// Shape calculated_packages keyed by metal slug (proposal-client.html metal
// branch uses these exact slugs via lib/metalProposalCopy.js)
const cp = {};
for (const offer of metalOffers) {
  const o = compare.offers?.[offer.slug];
  if (!o || !o.summary) {
    console.warn(`  ! ${offer.slug} not returned by engine — skipping`);
    continue;
  }
  const s = o.summary;
  cp[offer.slug] = {
    total: s.sellingPrice,
    totalWithTax: s.totalWithTax,
    persq: s.pricePerSQ,
    tax: Math.round(s.sellingPrice * 0.15),
    margin: s.netMargin,
    customPrice: false,
    lineItems: o.lineItems
  };
  console.log(`  ${offer.slug.padEnd(22)} sell=$${s.sellingPrice.toLocaleString()}  twt=$${s.totalWithTax.toLocaleString()}`);
}

// Pick recommended tier — middle (metal-standing-seam = Enhanced) is the
// market default for Atlantic NB residential metal jobs
const RECOMMENDED = 'metal-standing-seam';

// Create the new estimate
const body = {
  customer_id: KATARIA_CUSTOMER_ID,
  proposal_mode: 'Roof Only',
  pricing_model: 'Local',
  roof_area_sqft: measurements.squareFeet,
  roof_pitch: measurements.pitch,
  complexity: measurements.complexity,
  eaves_lf: measurements.eavesLF, rakes_lf: measurements.rakesLF,
  ridges_lf: measurements.ridgesLF, valleys_lf: measurements.valleysLF,
  hips_lf: measurements.hipsLF, walls_lf: measurements.wallsLF,
  pipes: measurements.pipes, vents: measurements.vents,
  chimneys: measurements.chimneys, chimney_size: measurements.chimneySize, chimney_cricket: false,
  stories: measurements.stories,
  extra_layers: measurements.extraLayers,
  cedar_tearoff: false, redeck_sheets: 0,
  distance_km: measurements.distanceKM,
  soffit_lf: source.soffit_lf || 0, fascia_lf: source.fascia_lf || 0, gutter_lf: source.gutter_lf || 0,
  window_count: 0, door_count: 0, siding_sqft: 0,
  custom_prices: {},
  calculated_packages: cp,
  selected_package: RECOMMENDED,
  status: 'draft',
  tags: ['sales_owner:darcy', 'metal_only', 'parallel_to:plus-ultra-45', 'darcy_request_2026-05-09'],
  notes: [{
    author: 'claude-code',
    timestamp: new Date().toISOString().slice(0, 10),
    note: `Created May 9 2026 at Darcy's request. Metal version of asphalt estimate #45 (147 Evergreen Drive). Same customer (Danish Kataria), same measurements, same address — pricing computed against metal-americana / metal-standing-seam / metal-premium. Asphalt #45 remains in pipeline; Darcy may present both for compare. Recommended tier: Enhanced (metal-standing-seam) — Atlantic NB market default for residential metal. Customer requested metal pricing.`
  }]
};

// Set GHL opp link if present on source estimate
const r2 = await fetch(`${RYUJIN}/api/estimates?tenant=${TENANT_SLUG}`, {
  method: 'POST', headers: HEADERS, body: JSON.stringify(body)
});
if (!r2.ok) {
  console.error(`estimate create failed: ${r2.status} ${await r2.text()}`);
  process.exit(1);
}
const est = await r2.json();
console.log(`\n✓ Metal estimate #${est.estimate_number} created`);
console.log(`  id:    ${est.id}`);
console.log(`  share: ${est.share_token}`);

// Backfill ghl_opportunity_id from source estimate if available
if (source.ghl_opportunity_id) {
  await sb.from('estimates').update({ ghl_opportunity_id: source.ghl_opportunity_id }).eq('id', est.id);
  console.log(`  ✓ ghl_opportunity_id backfilled (${source.ghl_opportunity_id})`);
}

console.log('\n' + '='.repeat(78));
console.log('METAL PROPOSAL FOR DANISH KATARIA — created in draft, NOT YET PRESENTED');
console.log(`  Customer: Danish Kataria · 147 Evergreen Drive`);
console.log(`  Recommended: ${metalOffers.find(o => o.slug === RECOMMENDED)?.name}`);
console.log(`\nPricing summary:`);
for (const slug of Object.keys(cp)) {
  console.log(`  ${slug.padEnd(22)} $${cp[slug].total.toLocaleString()} pre-tax  /  $${cp[slug].totalWithTax.toLocaleString()} incl HST${slug === RECOMMENDED ? '  ← recommended' : ''}`);
}
console.log(`\nShare URLs:`);
console.log(`  Asphalt (existing #45): https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-45`);
console.log(`  Metal   (new    #${est.estimate_number}): https://ryujin-os.vercel.app/proposal-client.html?share=${est.share_token}`);
console.log(`\nDarcy can present both for side-by-side compare. Mac sign-off before send.`);
