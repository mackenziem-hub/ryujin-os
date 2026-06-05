// Hard-kill the metal component for Mark Lewis #80.
// proposal-client.html:3875 ignores roof_metal.hidden when tiers.length > 0.
// Memory feedback_proposal_client_metal_default_ignores_hidden — clear tiers entirely.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const eq=line.indexOf('='); if (eq<0||line.startsWith('#'))continue;
  let v=line.slice(eq+1); if (v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);
  if(!process.env[line.slice(0,eq).trim()])process.env[line.slice(0,eq).trim()]=v.replace(/\\n/g,'').trim();
}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
const ID='f18ba35b-5e7d-4a4b-90f1-7971e648cb94';
const {data}=await sb.from('estimates').select('custom_prices').eq('id',ID).single();
const cp=JSON.parse(JSON.stringify(data.custom_prices));

// Backup metal tiers
cp._envelope._metal_tiers_killed_2026_06_05 = cp._envelope.components.roof_metal.tiers;

// Clear tiers AND hidden=true AND remove from any system-selection paths
cp._envelope.components.roof_metal.tiers = [];
cp._envelope.components.roof_metal.hidden = true;

// Also ensure show_systems and default_system are asphalt-only
cp._envelope.show_systems = ['asphalt'];
cp._envelope.default_system = 'asphalt';

const {error}=await sb.from('estimates').update({custom_prices:cp}).eq('id',ID);
if (error) throw new Error(error.message);
console.log('✓ roof_metal tiers cleared + show_systems asphalt-only');
console.log('  backup at custom_prices._envelope._metal_tiers_killed_2026_06_05');
