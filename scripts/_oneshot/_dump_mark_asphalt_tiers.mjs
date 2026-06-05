import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const eq=line.indexOf('='); if (eq<0||line.startsWith('#'))continue;
  let v=line.slice(eq+1); if (v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);
  if(!process.env[line.slice(0,eq).trim()])process.env[line.slice(0,eq).trim()]=v.replace(/\\n/g,'').trim();
}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
const {data}=await sb.from('estimates').select('custom_prices,selected_package').eq('id','f18ba35b-5e7d-4a4b-90f1-7971e648cb94').single();
console.log('selected_package:', data.selected_package);
console.log('\n=== roof_asphalt ===');
console.log(JSON.stringify(data.custom_prices._envelope.components.roof_asphalt,null,2));
console.log('\n=== financing_promo ===');
console.log(JSON.stringify(data.custom_prices._envelope.components.financing_promo,null,2));
console.log('\n=== service_rejuvenation ===');
console.log(JSON.stringify(data.custom_prices._envelope.components.service_rejuvenation,null,2));
console.log('\n=== addon_chimney_flash ===');
console.log(JSON.stringify(data.custom_prices._envelope.components.addon_chimney_flash,null,2));
console.log('\n=== remediation ===');
console.log(JSON.stringify(data.custom_prices._envelope.components.remediation,null,2));
console.log('\n=== wall_assembly ===');
console.log(JSON.stringify(data.custom_prices._envelope.components.wall_assembly,null,2));
