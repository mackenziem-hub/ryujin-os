// Create Troy Blakney's Quonset garage proposal at 2152 NB-885.
// Multi-plane: walkable peak (4/12) + curved dome + mansard outside + mansard rake.
// 54 km out (day-trip + travel surcharge band 40-60km).
//
// Engine input convention is 2D footprint × pitch multiplier = surface area.
// Mac gave SURFACE measurements, so back out pitch multipliers to feed planes.
import { readFileSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
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
const PHOTO_FOLDER = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/2152 NB-885';

// Pitch multipliers (must match engine)
const PM = { '4/12': 1.054, '13/12': 1.474 };

// Planes — back out pitch multipliers from surface areas Mac provided
const planes = [
  { sqft: Math.round(420 / PM['4/12']),  pitch: '4/12',  label: 'Walkable peak (top of arch)' },          // 399
  { sqft: Math.round(936 / PM['13/12']), pitch: '13/12', label: 'Curved dome — Quonset arch sides' },     // 635
  { sqft: Math.round(384 / PM['13/12']), pitch: '13/12', label: 'Mansard outside section' },              // 261
  { sqft: Math.round(78  / PM['13/12']), pitch: '13/12', label: 'Mansard rake outside' }                  //  53
];

// Linear measurements estimated from Quonset geometry (36 long × 26 arc width)
const measurements = {
  planes,
  squareFeet: 0,
  pitch: '13/12',          // dominant for material rates (mansard tier dominates)
  complexity: 'complex',   // curved geometry, harness work, multi-pitch
  distanceKM: 54,
  extraLayers: 0,
  eavesLF: 72,             // both long sides at grade
  rakesLF: 52,             // gable ends ×2
  ridgesLF: 36,            // peak running building length
  hipsLF: 0,
  valleysLF: 0,
  wallsLF: 0,
  pipes: 0,                // garage, no penetrations
  vents: 0,
  stories: 1
};

// Quote
const qResp = await fetch(`${RYUJIN}/api/quote?mode=compare&tenant=${TENANT_SLUG}`, {
  method: 'POST', headers: HEADERS, body: JSON.stringify({ measurements })
});
if (!qResp.ok) throw new Error(`quote ${qResp.status}: ${await qResp.text()}`);
const compare = await qResp.json();

console.log('=== SOP PRICING — Quonset garage 2152 NB-885 ===');
const cp = {};
for (const slug of ['gold','platinum','diamond']) {
  const o = compare.offers?.[slug]; if (!o) continue;
  const s = o.summary;
  cp[slug] = {
    total: s.sellingPrice,
    totalWithTax: s.totalWithTax,
    tax: Math.round(s.sellingPrice * 0.15 * 100) / 100,
    persq: s.pricePerSQ,
    margin: s.netMargin,
    customPrice: false,
    lineItems: o.lineItems
  };
  console.log(`  ${slug.padEnd(10)} measuredSQ=${o.measurements.measuredSQ}  hardCost=$${s.hardCost.toFixed(0).padStart(7)}  ×${s.multiplier}  → sell $${String(s.sellingPrice).padStart(7)}  + HST $${s.tax.toFixed(0).padStart(5)}  =  $${s.totalWithTax.toFixed(0).padStart(7)}`);
}

console.log('\nPer-plane base labor lines (Gold):');
const subLabor = (compare.offers.gold.lineItems || []).filter(li => li.included && /Base labor/.test(li.label || ''));
for (const li of subLabor) {
  console.log(`  ${(li.label||'').slice(0,60).padEnd(60)}  qty=${li.quantity}  rate=$${li.unit_cost}  total=$${li.total_cost}`);
}

console.log('\nTravel + waste lines (Gold):');
const surcharges = (compare.offers.gold.lineItems || []).filter(li => li.included && /travel|waste|supervisor/i.test(li.label || ''));
for (const li of surcharges) {
  console.log(`  ${(li.label||'').slice(0,60).padEnd(60)}  total=$${li.total_cost}`);
}

// Create estimate
const createBody = {
  customer: {
    full_name: 'Troy Blakney',
    phone: '+15068750182',
    email: 'troy.blakney@mari-tech.ca',
    address: '2152 NB-885',
    city: '',
    province: 'NB'
  },
  proposal_mode: 'Roof Only',
  pricing_model: 'Day Trip',
  roof_area_sqft: planes.reduce((a,b) => a + b.sqft, 0),
  roof_pitch: '13/12',
  planes,
  complexity: 'complex',
  eaves_lf: 72, rakes_lf: 52, ridges_lf: 36, valleys_lf: 0, hips_lf: 0, walls_lf: 0,
  pipes: 0, vents: 0, chimneys: 0, chimney_size: 'small', chimney_cricket: false,
  stories: 1, extra_layers: 0, cedar_tearoff: false, redeck_sheets: 0,
  distance_km: 54,
  soffit_lf: 0, fascia_lf: 0, gutter_lf: 0, window_count: 0, door_count: 0, siding_sqft: 0,
  custom_prices: {},
  calculated_packages: cp,
  selected_package: 'platinum',
  status: 'draft',
  ghl_opportunity_id: '0JsLH6GDa2itjV2NgLHB',
  tags: [
    'sales_owner:darcy',
    'specialty:quonset',
    'multi_pitch:planes_input',
    'travel_zone:40-60km',
    'standalone:garage'
  ],
  notes: [{
    author: 'claude-code',
    timestamp: new Date().toISOString().slice(0, 10),
    note: `Created May 8 2026. Quonset / barrel-vault garage at 2152 NB-885 (54 km from Riverview, day-trip + 40-60km travel surcharge band).

GEOMETRY (per Mac's field measurements):
- Walkable peak (top of arch): 30×14 = 420 sf at ~4/12
- Curved dome sides: 36×26 = 936 sf — passed at 13/12 to land in mansard tier ($200/SQ sub labor)
- Mansard outside: 32×12 = 384 sf at 13/12
- Mansard rake outside: 6×13 = 78 sf at 13/12
- Total surface area: 1,818 sf (~18 SQ)

PRICING APPROACH:
- Multi-plane input — each section gets correct labor band
- Mansard rate $200/SQ on 13+/12 portions
- Walkable rate $130/SQ on the flat peak
- Materials priced as standard Landmark — verify before install whether curved sections need mod-bit ($275/SQ sub) instead of asphalt for tight-radius bending. If mod-bit needed, hard cost goes up materially.

OPEN ITEMS:
- Material spec on curved 936 sf — Landmark vs mod-bit (Mac to confirm based on actual radius)
- Existing condition / current roof material (side view photo shows what looks like metal — verify before tear-off)
- No complexity premium added beyond mansard tier — Quonset curved geometry may warrant +$25-50/SQ extra (defer until Mac decides)`
  }]
};

const cResp = await fetch(`${RYUJIN}/api/estimates?tenant=${TENANT_SLUG}`, {
  method: 'POST', headers: HEADERS, body: JSON.stringify(createBody)
});
if (!cResp.ok) throw new Error(`estimate ${cResp.status}: ${await cResp.text()}`);
const est = await cResp.json();
console.log(`\n✓ Estimate #${est.estimate_number} created  id=${est.id}  share=${est.share_token}`);

// Upload photos
async function uploadPhoto(filePath, caption, isCover) {
  const buf = readFileSync(filePath);
  const fname = basename(filePath);
  const fd = new FormData();
  fd.append('estimate_id', est.id);
  fd.append('caption', caption);
  fd.append('is_cover', isCover ? 'true' : 'false');
  fd.append('file', new Blob([buf], { type: 'image/png' }), fname);
  const r = await fetch(`${RYUJIN}/api/estimate-photos`, {
    method: 'POST', headers: { 'x-tenant-id': TENANT_SLUG }, body: fd
  });
  if (!r.ok) throw new Error(`photo ${caption}: ${r.status} ${await r.text()}`);
  return (await r.json()).photos?.[0];
}

const cover = await uploadPhoto(`${PHOTO_FOLDER}/cover photo.png`, 'cover', true);
console.log(`  ✓ cover uploaded`);
// Cover doubles as before (Mac's pattern)
await sb.from('estimate_photos').insert({
  estimate_id: est.id, url: cover.url, filename: cover.filename, mime_type: cover.mime_type,
  is_cover: false, caption: 'before'
});
console.log(`  ✓ before row created (same blob as cover)`);

// Side view as gallery photo for additional reference
await uploadPhoto(`${PHOTO_FOLDER}/side view.png`, 'gallery', false);
console.log(`  ✓ side view uploaded as gallery`);

console.log('\n' + '='.repeat(70));
console.log(`Troy Blakney @ 2152 NB-885`);
console.log(`  Estimate #${est.estimate_number}`);
console.log(`  Share: ${RYUJIN}/proposal-client.html?share=${est.share_token}`);
console.log(`  Admin: ${RYUJIN}/sales-proposal.html?id=${est.id}`);
console.log(`  Status: draft (not locked — review pricing before locking)`);
console.log(`  Recommended: Platinum`);
