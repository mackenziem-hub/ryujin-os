// Create Luke #48 (684) + Brian #49 (686) Royal Oaks Blvd duplex estimates.
// Mirror 694/696 template — same building style, same measurements, same
// honored neighbor pricing. Lock at floor. Photos from Jobs/684 Royal Oaks/.
import { readFileSync } from 'node:fs';
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
const PHOTO_FOLDER = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/684 Royal Oaks';
const HEADERS = { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_SLUG };

const measurements = {
  squareFeet: 2709, pitch: '8/12', complexity: 'complex',
  distanceKM: 10, extraLayers: 0,
  eavesLF: 170, rakesLF: 30, ridgesLF: 42, hipsLF: 158, valleysLF: 113,
  wallsLF: 16, pipes: 2, vents: 0, stories: 1,
  waste_removal_override: 750
};

const HONORED = {
  gold:     { total: 20750, totalWithTax: 23863 },
  platinum: { total: 22500, totalWithTax: 25875 },
  diamond:  { total: 34200, totalWithTax: 39330 }
};

const sides = [
  {
    label: 'Luke',
    customer: { full_name: 'Luke', phone: '+15062952129', email: '', address: '684 Royal Oaks Boulevard', city: 'Moncton', province: 'NB' },
    ghl_contact_id: 'vpsEKYz4TXypBzkRp5hb'
  },
  {
    label: 'Brian',
    customer: { full_name: 'Brian', phone: '', email: '', address: '686 Royal Oaks Boulevard', city: 'Moncton', province: 'NB' },
    ghl_contact_id: null   // GHL record not yet created — Mac/Darcy to add later
  }
];

const TAGS = [
  'sales_owner:darcy',
  'duplex:684-686-royal-oaks',
  'eagleview:684-royal-oaks-2024-direct',
  'legacy_pricing_honored',
  'neighbor_rate_2024_hiscock_689_inflation_adjusted',
  'price_to_sell',
  'ryan_pre_approval_confirmed',
  'pricing_locked_at_floor'
];

async function quoteCompare() {
  const r = await fetch(`${RYUJIN}/api/quote?mode=compare&tenant=${TENANT_SLUG}`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify({ measurements })
  });
  if (!r.ok) throw new Error(`quote ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

function shapeWithHonored(compare) {
  const out = {};
  for (const slug of ['gold', 'platinum', 'diamond']) {
    const o = compare.offers?.[slug]; if (!o) continue;
    const s = o.summary;
    const sopTotal = s.sellingPrice;
    out[slug] = {
      total: HONORED[slug].total,
      totalWithTax: HONORED[slug].totalWithTax,
      tax: HONORED[slug].totalWithTax - HONORED[slug].total,
      persq: Math.round(HONORED[slug].total / 33),
      margin: s.netMargin,
      customPrice: true,
      promoLabel: 'NEIGHBOR HONORED RATE',
      originalTotal: sopTotal,
      lineItems: o.lineItems
    };
  }
  return out;
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

async function createEstimate(side, calculated_packages) {
  const body = {
    customer: side.customer,
    proposal_mode: 'Roof Only',
    pricing_model: 'Local',
    roof_area_sqft: measurements.squareFeet,
    roof_pitch: measurements.pitch,
    complexity: measurements.complexity,
    eaves_lf: measurements.eavesLF, rakes_lf: measurements.rakesLF,
    ridges_lf: measurements.ridgesLF, valleys_lf: measurements.valleysLF,
    hips_lf: measurements.hipsLF, walls_lf: measurements.wallsLF,
    pipes: measurements.pipes, vents: measurements.vents,
    chimneys: 0, chimney_size: 'small', chimney_cricket: false,
    stories: measurements.stories,
    extra_layers: 0,
    cedar_tearoff: false, redeck_sheets: 0,
    distance_km: measurements.distanceKM,
    soffit_lf: 0, fascia_lf: 0, gutter_lf: 0,
    window_count: 0, door_count: 0, siding_sqft: 0,
    custom_prices: { gold: HONORED.gold.total, platinum: HONORED.platinum.total, diamond: HONORED.diamond.total },
    calculated_packages,
    selected_package: 'platinum',
    status: 'draft',
    tags: TAGS,
    notes: [{
      author: 'claude-code',
      timestamp: new Date().toISOString().slice(0, 10),
      note: `Created May 8 2026. Duplex side at ${side.customer.address}. Companion estimate exists for the other half. Same building style as 694/696 Royal Oaks (jean gauvin / sharon, est #46/#47) — same measurements, same pricing structure. EagleView for THIS duplex (684 Royal Oaks Aug 2024) used directly, split 50/50 across the two civic addresses. Honored neighbor pricing per Hiscock 2024 + ~$650/side material inflation adjustment. Ryan pre-approved tightened sub margin, Darcy cleared on comp.`
    }, {
      author: 'claude-code',
      timestamp: new Date().toISOString().slice(0, 10),
      note: `PRICE SHIFT EXPLAINED — May 8 2026

Customer-facing pricing dropped from full SOP to honored neighbor rate level on this duplex.

PER-TIER DELTAS (per side):
- Gold:     $21,550 → $20,750   ($800 dropped /  $920 customer savings incl HST)
- Platinum: $25,750 → $22,500   ($3,250 dropped / $3,738 customer savings incl HST) ← recommended
- Diamond:  $37,450 → $34,200   ($3,250 dropped / $3,738 customer savings incl HST)

WHERE IT SITS vs HISCOCK 689 ROYAL OAKS (Aug 2024 quote):
Hiscock 2024 per-SQ rates × 33 SQ extrapolated to this side:
- Gold:     $20,064  → honored $20,750  =  $686 above 2024  (3.4%)
- Platinum: $21,846  → honored $22,500  =  $654 above 2024  (3.0%)
- Diamond:  $33,495  → honored $34,200  =  $705 above 2024  (2.1%)

We are approximately matching the 2024 neighbor pricing with a ~$650-700/side inflation adjustment for material cost increases since Aug 2024 (CertainTeed Landmark, Grace I&W, drip edge metal all up 8-12%).

COMBINED MAC NET ON THIS DUPLEX (BOTH SIDES SIGN):
- At honored Platinum (recommended): $4,053
- At honored Diamond (best for Mac):  $10,413
- At honored Gold:                    $5,640
- Crew effort: ~5 days for full duplex (single mob, shared materials order)

INTERNAL CONSTRAINTS:
- Ryan pre-approval CONFIRMED on tightened sub margin
- Darcy commission held at 15% (old structure — he hasn't agreed to new 12%/8% comp yet)
- Pricing LOCKED at floor — cannot drop further without explicit unlock from Mac.`
    }]
  };

  const r = await fetch(`${RYUJIN}/api/estimates?tenant=${TENANT_SLUG}`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`estimate ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

// ── RUN ───────────────────────────────────────────────────────
const compare = await quoteCompare();
const cp = shapeWithHonored(compare);

console.log('Engine SOP prices for reference:');
for (const slug of ['gold','platinum','diamond']) {
  console.log(`  ${slug.padEnd(10)} SOP $${cp[slug].originalTotal} → honored $${cp[slug].total}  (saves $${cp[slug].originalTotal - cp[slug].total}/side)`);
}

const results = [];
for (const side of sides) {
  console.log(`\n--- ${side.label} (${side.customer.address}) ---`);
  const est = await createEstimate(side, cp);
  console.log(`  ✓ estimate #${est.estimate_number} created  id=${est.id}  share=${est.share_token}`);

  // Backfill GHL contact id if available
  if (side.ghl_contact_id) {
    await sb.from('estimates').update({ ghl_opportunity_id: side.ghl_contact_id }).eq('id', est.id);
  }

  // Upload photos — Cover doubles as before per Mac's pattern (no separate before file in this folder)
  const cover = await uploadPhoto(est.id, `${PHOTO_FOLDER}/Cover photo.png`, 'cover', true);
  console.log(`  ✓ cover uploaded`);
  // Insert before row pointing at same blob (same Kataria/694 pattern)
  await sb.from('estimate_photos').insert({
    estimate_id: est.id,
    url: cover.url, filename: cover.filename, mime_type: cover.mime_type,
    is_cover: false, caption: 'before'
  });
  console.log(`  ✓ before row created (same blob as cover)`);
  await uploadPhoto(est.id, `${PHOTO_FOLDER}/after.png`, 'after', false);
  console.log(`  ✓ after uploaded`);

  // Lock immediately at honored floor
  await sb.from('estimates').update({
    locked_at: new Date().toISOString(),
    locked_reason: 'Honored neighbor pricing locked May 8 2026 — Ryan pre-approved sub margin, Darcy cleared on comp. Floor reached, cannot drop further without explicit unlock from Mac.'
  }).eq('id', est.id);
  console.log(`  ✓ locked at honored floor`);

  results.push({
    name: side.label,
    address: side.customer.address,
    estimate_number: est.estimate_number,
    share_url: `${RYUJIN}/proposal-client.html?share=${est.share_token}`
  });
}

console.log('\n' + '='.repeat(80));
console.log('DONE — both estimates created, photos uploaded, locked at honored floor');
for (const r of results) {
  console.log(`\n  ${r.name} @ ${r.address}`);
  console.log(`    Estimate #${r.estimate_number}`);
  console.log(`    Share: ${r.share_url}`);
}
console.log('\n  Recommended tier on both: Platinum ($22,500/side, $25,875 incl HST)');
console.log('  Note for Brian #686: GHL contact does not exist yet — Mac/Darcy to create + link.');
