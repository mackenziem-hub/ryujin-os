// Drill into Midway labor breakdown to verify mansard is captured.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch {}

const { createClient } = await import('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());
const { calculateQuoteV3 } = await import('../../lib/quoteEngineV3.js');

const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b';

const { data: offer } = await supabase
  .from('offers').select('id').eq('tenant_id', TENANT).eq('slug', 'gold').single();

const result = await calculateQuoteV3(supabase, {
  tenantId: TENANT, offerId: offer.id,
  measurements: {
    squareFeet: 1110, pitch: '4/12', complexity: 'simple', distanceKM: 12,
    eavesLF: 145, rakesLF: 30, ridgesLF: 74, hipsLF: 0, valleysLF: 0,
    pipes: 1, vents: 2, extraLayers: 1,
    scope_extras: { mansard_sq: 3 }
  }
});

console.log('=== Midway Gold tier — Labor lines ===');
for (const li of result.lineItems) {
  if (li.category !== 'labor') continue;
  console.log(`  [${li.item_key}] "${li.label}" qty=${li.quantity} ${li.unit} @ $${li.unit_cost} = $${li.total_cost}${li.included ? '' : ' (excluded)'}`);
}
console.log('\nSummary:');
console.log(JSON.stringify(result.summary, null, 2));
