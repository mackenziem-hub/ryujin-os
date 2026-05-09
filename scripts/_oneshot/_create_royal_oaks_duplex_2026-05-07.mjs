// Create Jean Gauvin (694) + Sharon (696) Royal Oaks Blvd duplex estimates.
// Uses 684 Royal Oaks EagleView split 50/50. Single 8/12 pitch (uniform per
// EagleView pitch diagram), so no planes input needed.
//
// Output: 2 draft estimates + 3 photos each (cover/before/after) from Jobs/694 Royal Oaks/.
// Ownership: darcy. Status: draft. No customer comms.

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
const TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b';
const PHOTO_FOLDER = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/694 Royal Oaks';
const HEADERS = { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_SLUG };

// Per-side EagleView measurements (50/50 split of 684 Royal Oaks roof — 5,418 sqft total).
// Pipes=2, vents=0 per Mac (penetrations are pipe flashings only on this build).
const measurements = {
  squareFeet: 2709,
  pitch: '8/12',
  complexity: 'complex',
  distanceKM: 10,
  extraLayers: 1,
  eavesLF: 170,
  rakesLF: 30,
  ridgesLF: 42,
  hipsLF: 158,
  valleysLF: 113,
  wallsLF: 16,
  pipes: 2,
  vents: 0,
  stories: 1
};

const sides = [
  {
    label: 'Jean Gauvin',
    customer: {
      full_name: 'Jean Gauvin',
      phone: '+15063813433',
      email: 'nycolo@nbnet.nb.ca',
      address: '694 Royal Oaks Boulevard',
      city: 'Moncton',
      province: 'NB'
    },
    ghl_contact_id: 'fWWaWeVQofQWbgmxQQ8V'
  },
  {
    label: 'Sharon',
    customer: {
      full_name: 'Sharon',
      phone: '+15196887688',
      email: 'seva1948@gmail.com',
      address: '696 Royal Oaks Boulevard',
      city: 'Moncton',
      province: 'NB'
    },
    ghl_contact_id: 'AaDJV36uLqsuAQjNVL2U'
  }
];

async function quoteCompare() {
  const r = await fetch(`${RYUJIN}/api/quote?mode=compare&tenant=${TENANT_SLUG}`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify({ measurements })
  });
  if (!r.ok) throw new Error(`quote ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

function shape(compare) {
  const out = {};
  for (const slug of ['gold', 'platinum', 'diamond']) {
    const o = compare.offers?.[slug]; if (!o) continue;
    const s = o.summary;
    out[slug] = {
      total: s.sellingPrice,
      totalWithTax: s.totalWithTax,
      persq: s.pricePerSQ,
      tax: Math.round(s.sellingPrice * 0.15),
      margin: s.netMargin,
      customPrice: false,
      lineItems: o.lineItems
    };
  }
  return out;
}

async function createEstimate(side, calculated_packages) {
  const body = {
    customer: side.customer,
    proposal_mode: 'Roof Only',
    pricing_model: 'Local',
    // sales_owner column is a uuid (links to users); we tag instead so the
    // proposal page rep card resolves via the `sales_owner:darcy` tag pattern.
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
    chimneys: 0,
    chimney_size: 'small',
    chimney_cricket: false,
    stories: measurements.stories,
    extra_layers: measurements.extraLayers,
    cedar_tearoff: false,
    redeck_sheets: 0,
    distance_km: measurements.distanceKM,
    soffit_lf: 0,
    fascia_lf: 0,
    gutter_lf: 0,
    window_count: 0,
    door_count: 0,
    siding_sqft: 0,
    custom_prices: {},
    calculated_packages,
    selected_package: 'platinum',
    status: 'draft',
    tags: ['sales_owner:darcy', 'duplex:694-696-royal-oaks', 'eagleview:684-royal-oaks-2024-split-50-50'],
    notes: [{
      author: 'claude-code',
      timestamp: new Date().toISOString().slice(0, 10),
      note: `Created May 7 2026. Duplex side at ${side.customer.address} — half of 5,418 sqft duplex roof. Measurements derived from 684 Royal Oaks EagleView (Aug 2024, same builder model) split 50/50. Penetrations: 2 pipe flashings, 0 vents. Predominant 8/12 uniform pitch per EagleView pitch diagram. Companion estimate exists for the other half of the duplex. Recommended Platinum.`
    }]
  };

  const r = await fetch(`${RYUJIN}/api/estimates?tenant=${TENANT_SLUG}`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`estimate ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const est = await r.json();

  // Backfill ghl_opportunity_id (not on POST shape; use direct DB)
  if (side.ghl_contact_id) {
    await sb.from('estimates').update({ ghl_opportunity_id: side.ghl_contact_id }).eq('id', est.id);
  }
  return est;
}

async function uploadPhoto(estimateId, filePath, caption, isCover) {
  const buf = readFileSync(filePath);
  const fname = basename(filePath);
  const fd = new FormData();
  fd.append('estimate_id', estimateId);
  fd.append('caption', caption);
  fd.append('is_cover', isCover ? 'true' : 'false');
  fd.append('file', new Blob([buf], { type: 'image/png' }), fname);
  const r = await fetch(`${RYUJIN}/api/estimate-photos`, {
    method: 'POST', headers: { 'x-tenant-id': TENANT_SLUG }, body: fd
  });
  if (!r.ok) throw new Error(`photo ${caption}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).photos?.[0];
}

// ── Run ───────────────────────────────────────────────────────
const compare = await quoteCompare();
const cp = shape(compare);
console.log('Engine compare done. Per-side prices:');
for (const k of ['gold','platinum','diamond']) console.log(`  ${k.padEnd(10)} sell=$${cp[k].total}  twt=$${cp[k].totalWithTax}`);

const results = [];
for (const side of sides) {
  console.log(`\n--- ${side.label} (${side.customer.address}) ---`);
  const est = await createEstimate(side, cp);
  console.log(`  ✓ estimate #${est.estimate_number} created  id=${est.id}  share=${est.share_token}`);

  // Upload photos
  const cover = await uploadPhoto(est.id, `${PHOTO_FOLDER}/cover photo.png`, 'cover', true);
  console.log(`  ✓ cover uploaded (${cover.id})`);
  const before = await uploadPhoto(est.id, `${PHOTO_FOLDER}/before photo.png`, 'before', false);
  console.log(`  ✓ before uploaded (${before.id})`);
  const after = await uploadPhoto(est.id, `${PHOTO_FOLDER}/after photo.png`, 'after', false);
  console.log(`  ✓ after uploaded (${after.id})`);

  results.push({
    name: side.label,
    address: side.customer.address,
    estimate_number: est.estimate_number,
    estimate_id: est.id,
    share_token: est.share_token,
    share_url: `${RYUJIN}/proposal-client.html?share=${est.share_token}`,
    admin_url: `${RYUJIN}/sales-proposal.html?id=${est.id}`
  });
}

console.log('\n' + '='.repeat(80));
console.log('DONE — both estimates created (draft, not presented):');
for (const r of results) {
  console.log(`\n  ${r.name} @ ${r.address}`);
  console.log(`    Estimate #${r.estimate_number}`);
  console.log(`    Share:  ${r.share_url}`);
  console.log(`    Admin:  ${r.admin_url}`);
}
console.log('\nRecommended tier on both: Platinum');
console.log('Sales owner: Darcy');
