// Create 46 Lefurgey Ave (Sackville) gutter-only estimate for Udochukwu Erondu.
// Quick custom quote — no roof engine, hand-built tier.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}

const RYUJIN = 'https://ryujin-os.vercel.app';
const TENANT_SLUG = 'plus-ultra';
const HEADERS = { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_SLUG };

const customer = {
  full_name: 'Udochukwu Erondu',
  phone: '+15068896815',
  email: 'benerondu@yahoo.com',
  address: '46 Lefurgey Avenue',
  city: 'Sackville',
  province: 'NB'
};

// Line items
const MATERIALS = 1200;
const LABOR_LOWER = 35 * 8;   // 280
const LABOR_UPPER = 75 * 12;  // 900
const CORNERS = 2 * 25;       // 50
const SUBTOTAL = MATERIALS + LABOR_LOWER + LABOR_UPPER + CORNERS; // 2430
const HST = Math.round(SUBTOTAL * 0.15 * 100) / 100;
const TOTAL = SUBTOTAL + HST;

const calculated_packages = {
  gutters: {
    total: SUBTOTAL,
    totalWithTax: TOTAL,
    tax: HST,
    persq: 0,
    customPrice: true,
    label: 'Gutter Package',
    lineItems: [
      { label: 'Materials (seamless gutter, downpipes, hardware)', cost: MATERIALS },
      { label: 'Labor — lower (35 LF @ $8/LF)', cost: LABOR_LOWER },
      { label: 'Labor — upper 2-story (75 LF @ $12/LF)', cost: LABOR_UPPER },
      { label: 'Corners / transitions (2 @ $25)', cost: CORNERS }
    ]
  }
};

const body = {
  customer,
  proposal_mode: 'Roof Only',
  pricing_model: 'Local',
  roof_area_sqft: 0,
  roof_pitch: '',
  complexity: 'simple',
  eaves_lf: 0, rakes_lf: 0, ridges_lf: 0, valleys_lf: 0, hips_lf: 0, walls_lf: 0,
  pipes: 0, vents: 0, chimneys: 0, chimney_size: 'small', chimney_cricket: false,
  stories: 2, extra_layers: 0, cedar_tearoff: false, redeck_sheets: 0,
  distance_km: 50,
  soffit_lf: 0, fascia_lf: 0, gutter_lf: 110,
  window_count: 0, door_count: 0, siding_sqft: 0,
  custom_prices: { gutters: SUBTOTAL },
  calculated_packages,
  selected_package: 'gutters',
  status: 'draft',
  tags: ['sales_owner:mackenzie', 'gutters_only', 'no_deposit'],
  notes: [{
    author: 'claude-code',
    timestamp: new Date().toISOString().slice(0, 10),
    note: `Gutter-only quote for 46 Lefurgey Ave, Sackville (Udochukwu Erondu).
Scope: 110 LF white seamless (75 LF upper two-story · 35 LF lower porch), 2 outside corner transitions, ~4 drops.
Pricing: Materials ${MATERIALS} + Labor lower 35×$8=${LABOR_LOWER} + Labor upper 75×$12=${LABOR_UPPER} + Corners 2×$25=${CORNERS} = $${SUBTOTAL} pre-HST / $${TOTAL} incl HST.
No deposit required (Mac directive — gutters paid on completion).
GHL contact id: aYflCBo3ccJUNq9k4KE4 (currently filed at 41 Fernwood Ave Moncton — gutter job address is 46 Lefurgey Ave Sackville).`
  }]
};

const r = await fetch(`${RYUJIN}/api/estimates?tenant=${TENANT_SLUG}`, {
  method: 'POST', headers: HEADERS, body: JSON.stringify(body)
});
if (!r.ok) {
  console.error(`estimate POST ${r.status}: ${(await r.text()).slice(0, 600)}`);
  process.exit(1);
}
const est = await r.json();
console.log(`✓ estimate #${est.estimate_number} created  id=${est.id}`);
console.log(`  Share: ${RYUJIN}/proposal-client.html?share=${est.share_token}`);
console.log(`  Total: $${SUBTOTAL} pre-HST / $${TOTAL} incl HST · No deposit`);
