// Verify: synthetic asphalt + metal quotes after the offer remediation patch.
// Confirms remediation line item appears with the SOP-band allowance and
// that hardCost increased accordingly.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { calculateQuoteV3 } from '../../lib/quoteEngineV3.js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());
const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b';

// Kataria-shaped: 1210 sqft, 5/12, 1 pipe, local. Should hit the <$20K band → $1,500.
const kataria = {
  squareFeet: 1210, pitch: '5/12', complexity: 'medium',
  distanceKM: 5, extraLayers: 1, pipes: 1, eavesLF: 80, rakesLF: 80, ridgesLF: 30
};

// Bigger asphalt: 30 SQ at 6/12 → ~$25-30K hardcost band → $2,000.
const big = {
  squareFeet: 3000, pitch: '6/12', complexity: 'medium',
  distanceKM: 5, extraLayers: 1, pipes: 2, eavesLF: 200, rakesLF: 150, ridgesLF: 80, valleysLF: 40
};

async function quote(slug, m) {
  const { data: offer } = await sb.from('offers').select('id, slug, scope_template').eq('tenant_id', TENANT).eq('slug', slug).single();
  const r = await calculateQuoteV3(sb, { tenantId: TENANT, offerId: offer.id, measurements: m, mode: 'advanced' });
  if (r.error) { console.log(`  [${slug}] ERROR: ${r.error}`); return; }
  const rem = r.lineItems.find(li => li.item_key === 'remediation' && li.included);
  console.log(`  ${slug.padEnd(20)}  hardCost $${r.summary.hardCost.toFixed(0).padStart(7)}  sell $${String(r.summary.sellingPrice).padStart(7)}  remediation=${rem ? '$'+rem.total_cost : '— MISSING'}`);
}

console.log('\n--- Kataria-shaped (1210 sqft, 5/12, 13 SQ-ish, expect $1,500 band) ---');
for (const s of ['gold','platinum','diamond']) await quote(s, kataria);

console.log('\n--- Bigger asphalt (3000 sqft, 6/12, 30 SQ, expect $2,000 band) ---');
for (const s of ['gold','platinum','diamond']) await quote(s, big);

console.log('\n--- Metal (Kataria-shaped) ---');
for (const s of ['metal-americana','metal-standing-seam']) await quote(s, kataria);

console.log('\nDone.');
