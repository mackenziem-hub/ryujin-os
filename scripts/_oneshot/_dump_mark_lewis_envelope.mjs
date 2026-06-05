import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const eq=line.indexOf('='); if (eq<0||line.startsWith('#'))continue;
  let v=line.slice(eq+1); if (v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);
  if(!process.env[line.slice(0,eq).trim()])process.env[line.slice(0,eq).trim()]=v.replace(/\\n/g,'').trim();
}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
const {data}=await sb.from('estimates').select('custom_prices').eq('id','f18ba35b-5e7d-4a4b-90f1-7971e648cb94').single();
const env=data.custom_prices?._envelope;
if (!env){console.log('no envelope'); process.exit(1);}
console.log('default_system:', env.default_system);
console.log('show_systems:', env.show_systems);
console.log('\nComponents:');
for (const [slug, c] of Object.entries(env.components||{})) {
  const tiers = Array.isArray(c.tiers) ? c.tiers.map(t=>`${t.slug||t.name}${t.starred?'*':''}`).join('|') : '-';
  console.log(`  ${slug.padEnd(28)} hidden=${!!c.hidden}  group=${c.group||'-'}  tiers=[${tiers}]`);
}
console.log('\nFlags on custom_prices:');
for (const [k,v] of Object.entries(data.custom_prices||{})){
  if (k==='_envelope') continue;
  console.log(`  ${k}:`, typeof v==='object'?'(object)':v);
}
