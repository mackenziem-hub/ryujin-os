// Strip Mark Lewis #80 down to Guy PU-76's pattern:
// custom_prices = {} (no envelope, no toggles, no Frankenstein).
// Default proposal-client.html render: 3 asphalt tier cards, Platinum starred.
// Backup the envelope in case we ever want it back.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const eq=line.indexOf('='); if (eq<0||line.startsWith('#'))continue;
  let v=line.slice(eq+1); if (v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);
  if(!process.env[line.slice(0,eq).trim()])process.env[line.slice(0,eq).trim()]=v.replace(/\\n/g,'').trim();
}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
const ID='f18ba35b-5e7d-4a4b-90f1-7971e648cb94';

const {data:est}=await sb.from('estimates').select('custom_prices,calculated_packages,selected_package').eq('id',ID).single();

// Stash the full envelope for rollback
await sb.from('estimates').update({
  custom_prices: { _envelope_killed_2026_06_05_pre_guy_pattern: est.custom_prices }
}).eq('id', ID);

// Confirm
const {data:after}=await sb.from('estimates')
  .select('custom_prices, calculated_packages, selected_package').eq('id',ID).single();

console.log('✓ Envelope stripped. custom_prices keys:', Object.keys(after.custom_prices));
console.log('  selected_package:', after.selected_package);
console.log('  cp.gold:', after.calculated_packages.gold.total);
console.log('  cp.platinum:', after.calculated_packages.platinum.total);
console.log('  cp.diamond:', after.calculated_packages.diamond.total);
console.log('\nCustomer URL: https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-80');
console.log('(hard-refresh to bypass Vercel edge cache)');
