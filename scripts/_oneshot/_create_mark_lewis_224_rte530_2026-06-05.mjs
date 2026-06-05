// Mark Lewis — 224 Route 530, Grand-Digue NB. For Mac's Jun 5 4pm meeting.
// Footprint: 62x32 main + 44x40 garage + 39x19 misc = 4485 sqft. 5/12 walkable.
// Multiple hips, multiple valleys, large chimney, possible dead zone. Medium complexity per Mac.
// 30 km from Moncton. GHL contact id ciy7lDnz3E8YwBXHDpGo (Internal Pipeline, inspection booked today).
//
// Photos NOT yet attached. After Mac drops a house photo, run /api/generate-render via builder.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const eq = line.indexOf('='); if (eq < 0 || line.startsWith('#')) continue;
  const k = line.slice(0, eq).trim();
  let v = line.slice(eq + 1);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  v = v.replace(/\\n/g, '').trim();
  if (!process.env[k]) process.env[k] = v;
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const RYUJIN = 'https://ryujin-os.vercel.app';
const TENANT_SLUG = 'plus-ultra';
const TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b';
const HEADERS = { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_SLUG };

const measurements = {
  squareFeet: 4485,
  pitch: '5/12',
  complexity: 'medium',
  distanceKM: 30,
  extraLayers: 0,
  eavesLF: 250,
  rakesLF: 40,
  ridgesLF: 200,
  hipsLF: 100,
  valleysLF: 70,
  wallsLF: 30,
  pipes: 3,
  vents: 4,
  chimneys: 1,
  chimneySize: 'large',
  stories: 1,
  projectType: 'Local'
};

const customer = {
  full_name: 'Mark Lewis',
  phone: '+15068751416',
  email: 'marklew55@icloud.com',
  address: '224 Route 530',
  city: 'Grand-Digue',
  province: 'NB'
};

const GHL_CONTACT_ID = 'ciy7lDnz3E8YwBXHDpGo';
const TAGS = ['sales_owner:mackenzie', 'lead_source:ghl_inspection_booked', 'jun5_4pm_meeting'];

async function quoteCompare() {
  const r = await fetch(`${RYUJIN}/api/quote?mode=compare&tenant=${TENANT_SLUG}`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify({ measurements })
  });
  if (!r.ok) throw new Error(`quote ${r.status}: ${(await r.text()).slice(0, 500)}`);
  return r.json();
}

function shapeCalculated(compare) {
  const out = {};
  for (const slug of ['gold', 'platinum', 'diamond']) {
    const o = compare.offers?.[slug]; if (!o) continue;
    const s = o.summary;
    const total = s.sellingPrice;
    const totalWithTax = s.totalWithTax || Math.round(total * 1.15);
    out[slug] = {
      total, totalWithTax,
      tax: totalWithTax - total,
      persq: s.pricePerSQ,
      margin: s.netMargin,
      lineItems: o.lineItems,
      summary: s
    };
  }
  return out;
}

async function getOrCreateCustomer() {
  const { data: existing } = await sb
    .from('customers')
    .select('id')
    .eq('tenant_id', TENANT_ID)
    .eq('full_name', customer.full_name)
    .eq('address', customer.address)
    .maybeSingle();
  if (existing) { console.log(`  customer existed: ${existing.id}`); return existing.id; }
  const { data, error } = await sb.from('customers')
    .insert({ tenant_id: TENANT_ID, ghl_contact_id: GHL_CONTACT_ID, ...customer })
    .select('id').single();
  if (error) throw new Error(`customer insert: ${error.message}`);
  console.log(`  customer created: ${data.id}`);
  return data.id;
}

async function buildEnvelope() {
  const { data: ts } = await sb.from('tenant_settings')
    .select('envelope_catalog').eq('tenant_id', TENANT_ID).maybeSingle();
  const cat = ts?.envelope_catalog;
  if (!cat?.components) return null;
  return {
    version: cat.version || 1,
    show_systems: cat.default_show_systems || ['asphalt', 'metal'],
    default_system: cat.default_system || 'asphalt',
    components: JSON.parse(JSON.stringify(cat.components))
  };
}

async function createEstimate(calculated_packages) {
  const customerId = await getOrCreateCustomer();
  const envelope = await buildEnvelope();
  const custom_prices = envelope ? { _envelope: envelope } : {};
  const estimate = {
    tenant_id: TENANT_ID,
    customer_id: customerId,
    proposal_mode: 'Roof Only',
    pricing_model: 'Local',
    roof_area_sqft: measurements.squareFeet,
    roof_pitch: measurements.pitch,
    complexity: measurements.complexity,
    eaves_lf: measurements.eavesLF, rakes_lf: measurements.rakesLF,
    ridges_lf: measurements.ridgesLF, valleys_lf: measurements.valleysLF,
    hips_lf: measurements.hipsLF, walls_lf: measurements.wallsLF,
    pipes: measurements.pipes, vents: measurements.vents,
    chimneys: measurements.chimneys, chimney_size: measurements.chimneySize,
    chimney_cricket: false,
    stories: measurements.stories,
    extra_layers: 0, cedar_tearoff: false, redeck_sheets: 0,
    distance_km: measurements.distanceKM,
    soffit_lf: 0, fascia_lf: 0, gutter_lf: 0,
    window_count: 0, door_count: 0, siding_sqft: 0,
    calculated_packages,
    selected_package: 'platinum',
    custom_prices,
    status: 'draft',
    tags: TAGS,
    ghl_opportunity_id: GHL_CONTACT_ID,
    notes: [{
      author: 'claude-code',
      timestamp: new Date().toISOString().slice(0, 10),
      note: `Created Jun 5 2026 pre-4pm-meeting for Mac. 224 Rte 530 Grand-Digue (30km).
Footprint: 62x32 main + 44x40 garage + 39x19 misc = 4485 sqft. 5/12 pitch walkable.
Multiple hips, multiple valleys, large chimney, possible dead zone flagged by Mac.
Medium complexity per Mac. 300LF ridge+cap combined (split 200 ridge / 100 hip).
250 LF eaves / 40 LF rakes / 70 LF valleys.

PHOTOS PENDING: Mac to drop a house photo; will generate before/after via Higgsfield img2img through /api/generate-render after.`
    }]
  };
  const { data, error } = await sb.from('estimates').insert(estimate).select('*').single();
  if (error) throw new Error(`estimate insert: ${error.message}`);
  const shareToken = `${TENANT_SLUG}-${data.estimate_number || data.id.slice(0, 8)}`;
  await sb.from('estimates').update({ share_token: shareToken }).eq('id', data.id);
  data.share_token = shareToken;
  return data;
}

console.log('Measurements:');
console.log(JSON.stringify(measurements, null, 2));
console.log('\nRunning quote engine…');
const compare = await quoteCompare();
const cp = shapeCalculated(compare);

console.log('\nEngine SOP prices:');
for (const slug of ['gold','platinum','diamond']) {
  if (!cp[slug]) { console.log(`  ${slug}: SKIPPED (no offer match)`); continue; }
  console.log(`  ${slug.padEnd(10)} $${cp[slug].total.toLocaleString()} (incl HST $${cp[slug].totalWithTax.toLocaleString()})  $${cp[slug].persq}/SQ  margin ${(cp[slug].margin*100).toFixed(1)}%`);
}

console.log('\nCreating estimate…');
const est = await createEstimate(cp);
console.log(`✓ estimate #${est.estimate_number} created`);
console.log(`  id: ${est.id}`);
console.log(`  share_token: ${est.share_token}`);
console.log(`\nCustomer URL: ${RYUJIN}/proposal-client.html?share=${est.share_token}`);
console.log(`Builder URL:  ${RYUJIN}/proposal-builder.html?id=${est.id}`);
