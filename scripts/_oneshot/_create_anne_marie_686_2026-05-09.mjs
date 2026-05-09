// Create Anne Marie 686 Royal Oaks estimate. Mirrors Luc/Brian #48 (684) duplex
// neighbor exactly — same building, same measurements, same honored floor.
// Mac presented to Anne Marie + husband in person on 2026-05-09.
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

const customer = {
  full_name: 'Anne Marie',
  phone: '',
  email: '',
  address: '686 Royal Oaks Boulevard',
  city: 'Moncton',
  province: 'NB'
};

const TAGS = [
  'sales_owner:darcy',
  'duplex:684-686-royal-oaks',
  'eagleview:684-royal-oaks-2024-direct',
  'legacy_pricing_honored',
  'neighbor_rate_2024_hiscock_689_inflation_adjusted',
  'price_to_sell',
  'ryan_pre_approval_confirmed',
  'pricing_locked_at_floor',
  'presented_in_person'
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

async function createEstimate(calculated_packages) {
  const body = {
    customer,
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
      note: `Created May 9 2026. 686 Royal Oaks (other half of Luc/Brian 684 duplex, est #48). Mac caught Anne Marie + her husband at the door and presented in person. Same building style as 694/696 (Jean #46 / Sharon #47) and 684 (Luc/Brian #48). EagleView 684 Royal Oaks Aug 2024 used directly, split 50/50 across the duplex. Honored neighbor pricing per Hiscock 2024 + ~$650/side material inflation adjustment. Ryan pre-approval already confirmed on this duplex (#48); same sub margin applies.`
    }, {
      author: 'claude-code',
      timestamp: new Date().toISOString().slice(0, 10),
      note: `PRICE SHIFT EXPLAINED — May 9 2026

Customer-facing pricing dropped from full SOP to honored neighbor rate level on this duplex.

PER-TIER DELTAS:
- Gold:     $21,550 → $20,750   ($800 dropped /  $920 customer savings incl HST)
- Platinum: $25,750 → $22,500   ($3,250 dropped / $3,738 customer savings incl HST) ← recommended
- Diamond:  $37,450 → $34,200   ($3,250 dropped / $3,738 customer savings incl HST)

WHERE IT SITS vs HISCOCK 689 ROYAL OAKS (Aug 2024 quote):
Hiscock 2024 per-SQ rates × 33 SQ extrapolated:
- Gold:     $20,064  → honored $20,750  =  $686 above 2024  (3.4%)
- Platinum: $21,846  → honored $22,500  =  $654 above 2024  (3.0%)
- Diamond:  $33,495  → honored $34,200  =  $705 above 2024  (2.1%)

Approximately matching 2024 neighbor pricing + ~$650/side inflation adjustment for material cost increases since Aug 2024.

INTERNAL CONSTRAINTS:
- Ryan pre-approval CONFIRMED on tightened sub margin (carries from #48)
- Darcy commission at 15% (old structure)
- Pricing LOCKED at floor — cannot drop further without explicit unlock from Mac.
- GHL contact does not yet exist — Mac/Darcy to create + link ghl_opportunity_id later.`
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
  console.log(`  ${slug.padEnd(10)} SOP $${cp[slug].originalTotal} → honored $${cp[slug].total}  (saves $${cp[slug].originalTotal - cp[slug].total})`);
}

console.log(`\n--- Anne Marie (686 Royal Oaks Boulevard) ---`);
const est = await createEstimate(cp);
console.log(`  ✓ estimate #${est.estimate_number} created  id=${est.id}  share=${est.share_token}`);

// Photos — same folder as Luc/Brian #48 (duplex is same building)
const cover = await uploadPhoto(est.id, `${PHOTO_FOLDER}/Cover photo.png`, 'cover', true);
console.log(`  ✓ cover uploaded`);
await sb.from('estimate_photos').insert({
  estimate_id: est.id,
  url: cover.url, filename: cover.filename, mime_type: cover.mime_type,
  is_cover: false, caption: 'before'
});
console.log(`  ✓ before row created (same blob as cover)`);
await uploadPhoto(est.id, `${PHOTO_FOLDER}/after.png`, 'after', false);
console.log(`  ✓ after uploaded`);

// Lock at honored floor
await sb.from('estimates').update({
  locked_at: new Date().toISOString(),
  locked_reason: 'Honored neighbor pricing locked May 9 2026 — same Ryan pre-approved sub margin as #48. Floor reached, cannot drop further without explicit unlock from Mac.'
}).eq('id', est.id);
console.log(`  ✓ locked at honored floor`);

console.log('\n' + '='.repeat(80));
console.log(`DONE — Anne Marie #${est.estimate_number} created, locked, photos uploaded`);
console.log(`  Share: ${RYUJIN}/proposal-client.html?share=${est.share_token}`);
console.log(`  Recommended tier: Platinum ($22,500, $25,875 incl HST)`);
console.log(`  Note: GHL contact does not exist yet — Mac/Darcy to create + link.`);
