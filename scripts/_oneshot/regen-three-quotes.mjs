// Re-quote Tobias (#26 Shanahan?), Midway (#27 Furlotte), Chartersville (#28 Leblanc-Maldonado)
// against the rebuilt engine.
//
// Mapping per task brief: plus-ultra-26 = Tobias, 27 = Midway, 28 = Chartersville.
// Verify against actual customer rows pulled by inspect-estimates.mjs.

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
const { calculateMultiOfferQuote } = await import('../../lib/quoteEngineV3.js');

const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b';

// Per CLAUDE-Md context the three estimates are:
//   plus-ultra-26 → Tobias            (sqft 1408, 4/12, 5km)
//   plus-ultra-27 → Midway/Furlotte   (sqft 1110, 4/12, 12km, MANSARD 3 SQ)
//   plus-ultra-28 → Chartersville/Leblanc-Maldonado (sqft 1680, 4/12, 10km, 1 chimney)
const targets = [
  {
    label: 'Tobias #26 (Shanahan)', share: 'plus-ultra-26', estId: '9786e976-1511-4401-b8f0-0b9dc64d8cb3',
    measurements: {
      squareFeet: 1408, pitch: '4/12', complexity: 'simple', distanceKM: 5,
      eavesLF: 116, rakesLF: 100, ridgesLF: 44, hipsLF: 0, valleysLF: 0,
      pipes: 1, vents: 0, extraLayers: 1,
      chimneys: 1, chimneySize: 'small'
    },
    scope_extras: {}
  },
  {
    label: 'Midway #27 (Furlotte)', share: 'plus-ultra-27', estId: 'db13a805-a4d2-4715-8791-a9393e1962e8',
    measurements: {
      squareFeet: 1110, pitch: '4/12', complexity: 'simple', distanceKM: 12,
      eavesLF: 145, rakesLF: 30, ridgesLF: 74, hipsLF: 0, valleysLF: 0,
      pipes: 1, vents: 2, extraLayers: 1,
      // Mansard accent — 3 SQ at steep tier rate
      scope_extras: { mansard_sq: 3 }
    },
    scope_extras: { mansard_sq: 3 }
  },
  {
    label: 'Chartersville #28 (Leblanc-Maldonado)', share: 'plus-ultra-28', estId: '1596dd8a-3eb2-468a-8d0c-51d79494c22f',
    measurements: {
      squareFeet: 1680, pitch: '4/12', complexity: 'simple', distanceKM: 10,
      eavesLF: 114, rakesLF: 60, ridgesLF: 57, hipsLF: 0, valleysLF: 0,
      pipes: 1, vents: 0, extraLayers: 1,
      chimneys: 1, chimneySize: 'small'
    },
    scope_extras: {}
  }
];

const { data: offers } = await supabase
  .from('offers').select('id, slug, system')
  .eq('tenant_id', TENANT)
  .in('slug', ['gold','platinum','diamond']);

const dryRun = process.argv.includes('--dry-run');
const persist = process.argv.includes('--persist');

const oldRows = await supabase
  .from('estimates').select('id, share_token, calculated_packages')
  .in('id', targets.map(t => t.estId));
const oldByShare = {};
for (const r of (oldRows.data || [])) oldByShare[r.share_token] = r.calculated_packages || {};

console.log('=== Comparison: OLD calculated_packages vs NEW engine ===\n');
console.log('| Address | Tier | Old Sell | New Sell | Old Hard | New Hard | SOP Profit | Real Net |');
console.log('|---|---|---|---|---|---|---|---|');

const newPackagesMap = {};

for (const t of targets) {
  // Pass scope_extras through measurements blob — engine reads measurements.scope_extras
  const m = { ...t.measurements };
  if (t.scope_extras && Object.keys(t.scope_extras).length) m.scope_extras = t.scope_extras;

  const result = await calculateMultiOfferQuote(supabase, {
    tenantId: TENANT,
    offerIds: offers.map(o => o.id),
    measurements: m,
    overrides: {},
    choices: {},
    extras: []
  });

  const newPkgs = {};
  for (const slug of ['gold','platinum','diamond']) {
    const r = result.offers[slug];
    if (!r) continue;
    const s = r.summary;
    newPkgs[slug] = {
      ...r,
      total: s.sellingPrice,
      persq: s.pricePerSQ
    };
    const old = oldByShare[t.share]?.[slug]?.summary || {};
    const oldSell = old.sellingPrice || 0;
    const oldHard = old.hardCost || 0;
    console.log(`| ${t.label.split('#')[0].trim()} | ${slug} | $${oldSell} | $${s.sellingPrice} | $${oldHard.toFixed?.(2) || oldHard} | $${s.hardCost} | $${s.sopProfit} | $${s.realCashNet} |`);
  }

  newPackagesMap[t.estId] = { ...(oldByShare[t.share] || {}), ...newPkgs };
}

if (persist && !dryRun) {
  console.log('\n=== Persisting new calculated_packages ===');
  for (const [estId, pkgs] of Object.entries(newPackagesMap)) {
    const { error } = await supabase
      .from('estimates').update({ calculated_packages: pkgs }).eq('id', estId);
    console.log(estId, error ? 'FAIL: ' + error.message : 'updated');
  }
} else {
  console.log('\n(Use --persist to write back. Currently dry-run.)');
}
