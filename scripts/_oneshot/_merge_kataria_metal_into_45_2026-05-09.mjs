// Merge Kataria metal pricing into existing asphalt estimate #45.
// Result: single estimate with both systems, system toggle activates
// automatically (api/proposal.js hasBothSystems detection at line 348).
// Then delete redundant #53 (created earlier this session as parallel
// metal-only — superseded by this merge).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

// 1. Load both estimates
const { data: e45 } = await sb.from('estimates').select('id, estimate_number, calculated_packages, notes, tags').eq('estimate_number', 45).single();
const { data: e53 } = await sb.from('estimates').select('id, estimate_number, calculated_packages').eq('estimate_number', 53).single();

if (!e45) { console.error('estimate #45 not found'); process.exit(1); }
if (!e53) { console.error('estimate #53 not found'); process.exit(1); }

// 2. Extract the 3 metal tiers from #53
const metalKeys = ['metal-americana', 'metal-standing-seam', 'metal-premium'];
const metalPackages = {};
for (const key of metalKeys) {
  if (e53.calculated_packages?.[key]) metalPackages[key] = e53.calculated_packages[key];
}
console.log('Metal tiers extracted from #53:', Object.keys(metalPackages));

// 3. Merge into #45's calculated_packages
const mergedCp = {
  ...(e45.calculated_packages || {}),
  ...metalPackages
};
console.log('\nMerged #45 calculated_packages keys:', Object.keys(mergedCp));

// 4. Append a note and tag the merge
const mergeNote = {
  author: 'claude-code',
  timestamp: new Date().toISOString().slice(0, 10),
  note: `Metal pricing added May 9 2026 at Darcy's request. Customer (Kataria) requested metal quote alongside the existing asphalt option. Single proposal link now carries both systems — system toggle at top of proposal-client.html flips between asphalt (gold/platinum/diamond) and metal (americana/standing-seam/premium) automatically. Recommended metal tier: metal-standing-seam (Enhanced) at $19,200 pre-tax. Asphalt remains gold $11,575 (selected_package=platinum). Estimate #53 (parallel metal-only) deleted as redundant.`
};

const newTags = Array.from(new Set([
  ...(e45.tags || []),
  'has_metal',
  'darcy_metal_request_2026-05-09'
]));

const { error: updateErr } = await sb.from('estimates').update({
  calculated_packages: mergedCp,
  notes: [...(e45.notes || []), mergeNote],
  tags: newTags
}).eq('id', e45.id);

if (updateErr) {
  console.error('update #45 failed:', updateErr.message);
  process.exit(1);
}
console.log('\n✓ #45 updated with merged asphalt + metal calculated_packages');

// 5. Delete #53 (and any photos / other linked rows)
//    estimate_photos has FK on estimate_id — cascade may or may not be set.
//    Defensive: delete photos first.
const { error: photoDelErr } = await sb.from('estimate_photos').delete().eq('estimate_id', e53.id);
if (photoDelErr && photoDelErr.code !== '42P01') console.warn('photo delete warning:', photoDelErr.message);

const { error: estDelErr } = await sb.from('estimates').delete().eq('id', e53.id);
if (estDelErr) {
  console.error('delete #53 failed:', estDelErr.message);
  process.exit(1);
}
console.log('✓ #53 deleted (redundant after merge)');

console.log('\n' + '='.repeat(78));
console.log('DANISH KATARIA — single proposal, dual system');
console.log(`  Customer: Danish Kataria · 147 Evergreen Drive`);
console.log(`  Single share URL (asphalt + metal toggle): https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-45`);
console.log('\nPricing summary:');
console.log('  ASPHALT:');
for (const k of ['gold','platinum','diamond']) {
  const t = mergedCp[k]; if (!t) continue;
  console.log(`    ${k.padEnd(20)} $${t.total.toLocaleString()} pre-tax  /  $${(t.totalWithTax || Math.round(t.total*1.15)).toLocaleString()} incl HST`);
}
console.log('  METAL:');
for (const k of metalKeys) {
  const t = mergedCp[k]; if (!t) continue;
  console.log(`    ${k.padEnd(20)} $${t.total.toLocaleString()} pre-tax  /  $${(t.totalWithTax || Math.round(t.total*1.15)).toLocaleString()} incl HST`);
}
console.log('\nSystem toggle activates automatically — no Darcy / customer action required.');
