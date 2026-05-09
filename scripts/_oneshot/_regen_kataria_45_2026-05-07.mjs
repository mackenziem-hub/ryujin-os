// Regenerate Kataria #45 with multi-pitch geometry + new engine.
// Estimate is in draft, not locked, not yet presented — safe per no-backfill rule.
// Updates calculated_packages + planes + roof_area_sqft on the same row (no new estimate).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { calculateMultiOfferQuote } from '../../lib/quoteEngineV3.js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());
const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b';
const ESTIMATE_ID = 'f2b65c43-37c5-4ebd-adda-e56cbb988cd9';

// Pre-flight: confirm estimate is still safe to regen.
const { data: pre } = await sb.from('estimates').select('id, estimate_number, status, locked_at, proposal_status, share_token').eq('id', ESTIMATE_ID).single();
if (!pre) { console.error('estimate not found'); process.exit(1); }
console.log(`pre-state: #${pre.estimate_number} status=${pre.status} locked=${!!pre.locked_at} proposal_status=${pre.proposal_status||'—'} share=${pre.share_token}`);
if (pre.locked_at || pre.status === 'proposal_sent' || pre.proposal_status === 'Published') {
  console.error('SAFETY ABORT: estimate is locked or presented. Refusing to regenerate.');
  process.exit(1);
}

const planes = [
  { sqft: 960, pitch: '5/12',  label: 'Upper main' },
  { sqft: 80,  pitch: '12/12', label: 'Side rakes' },
  { sqft: 57,  pitch: '12/12', label: 'Front rake' }
];
const measurements = {
  planes,
  complexity: 'medium', distanceKM: 5, extraLayers: 1, pipes: 1,
  eavesLF: 80, rakesLF: 80, ridgesLF: 30
};

// Pull active gold/plat/diamond offer ids
const { data: offers } = await sb.from('offers').select('id, slug').eq('tenant_id', TENANT).in('slug', ['gold','platinum','diamond']);
const offerIds = offers.map(o => o.id);

const quote = await calculateMultiOfferQuote(sb, { tenantId: TENANT, offerIds, measurements });

const shaped = {};
for (const slug of ['gold','platinum','diamond']) {
  const o = quote.offers?.[slug]; if (!o) continue;
  const s = o.summary;
  shaped[slug] = {
    total: s.sellingPrice,
    totalWithTax: s.totalWithTax,
    persq: s.pricePerSQ,
    tax: Math.round(s.sellingPrice * 0.15),
    margin: s.netMargin,
    customPrice: false,
    lineItems: o.lineItems
  };
}

console.log('\nNew calculated_packages:');
for (const k of ['gold','platinum','diamond']) {
  console.log(`  ${k.padEnd(10)} sell=$${shaped[k].total}  tax=$${shaped[k].tax}  twt=$${shaped[k].totalWithTax}  margin=${shaped[k].margin}`);
}

const totalRaw = planes.reduce((s,p) => s + p.sqft, 0);

const { error: uerr } = await sb.from('estimates').update({
  calculated_packages: shaped,
  planes,
  roof_area_sqft: totalRaw,
  // notes append for audit trail
  notes: [
    { author: 'claude-code', timestamp: new Date().toISOString().slice(0,10), note: 'Regenerated May 7 2026 with multi-plane engine + remediation patch. Old: Gold $8,400 / Plat $9,800 / Dmd $14,700. Single-pitch 1,210 sqft was treating post-pitch area as 2D and missing remediation + steep-rake band.' }
  ]
}).eq('id', ESTIMATE_ID);

if (uerr) { console.error('update failed:', uerr.message); process.exit(1); }
console.log(`\n✓ #${pre.estimate_number} updated. Share URL unchanged: https://ryujin-os.vercel.app/proposal-client.html?share=${pre.share_token}`);
