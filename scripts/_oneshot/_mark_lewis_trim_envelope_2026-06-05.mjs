// Trim Mark Lewis (#80) envelope to a straightforward shingle proposal per Mac Jun 5:
//   • metal removed entirely (asphalt only)
//   • tier order reversed Diamond → Platinum → Gold; Platinum stays recommended
//   • visible: roof_asphalt, prep_redeck, trim_gutters, financing_promo
//   • hidden: roof_metal, siding, prep_strap, wall_assembly, remediation,
//             trim_fascia, trim_soffit, trim_leafguard, addon_ventilation,
//             addon_chimney_flash, inspection_photos, service_rejuvenation
//   • _inspection_section_visible explicitly false
//   • _envelope_pre_jun5_trim_backup saved
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const eq=line.indexOf('='); if (eq<0||line.startsWith('#'))continue;
  let v=line.slice(eq+1); if (v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);
  if(!process.env[line.slice(0,eq).trim()])process.env[line.slice(0,eq).trim()]=v.replace(/\\n/g,'').trim();
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ID = 'f18ba35b-5e7d-4a4b-90f1-7971e648cb94';

const HIDE = new Set([
  'roof_metal', 'siding', 'prep_strap', 'wall_assembly', 'remediation',
  'trim_fascia', 'trim_soffit', 'trim_leafguard', 'addon_ventilation',
  'addon_chimney_flash', 'inspection_photos', 'service_rejuvenation'
]);

const { data: est } = await sb.from('estimates')
  .select('custom_prices').eq('id', ID).single();

const cp = JSON.parse(JSON.stringify(est.custom_prices || {}));
if (!cp._envelope) throw new Error('no envelope on estimate');

// Backup for safety
cp._envelope_pre_jun5_trim_backup = JSON.parse(JSON.stringify(cp._envelope));

// 1. Force asphalt-only system display
cp._envelope.show_systems = ['asphalt'];
cp._envelope.default_system = 'asphalt';

// 2. Hide components
for (const slug of Object.keys(cp._envelope.components)) {
  if (HIDE.has(slug)) {
    cp._envelope.components[slug].hidden = true;
  } else {
    cp._envelope.components[slug].hidden = false;
  }
}

// 3. Reverse asphalt tiers to Diamond → Platinum → Gold (Platinum stays popular/recommended)
const asphalt = cp._envelope.components.roof_asphalt;
if (Array.isArray(asphalt?.tiers)) {
  const order = ['diamond', 'platinum', 'gold'];
  asphalt.tiers.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
  // Make sure ONLY platinum has popular flag
  for (const t of asphalt.tiers) t.popular = (t.slug === 'platinum');
}

// 4. Explicitly hide inspection section + remove any rejuv-section sidecar
cp._inspection_section_visible = false;
delete cp._rejuv_section;

// 5. Write back
const { error } = await sb.from('estimates')
  .update({ custom_prices: cp, selected_package: 'platinum' })
  .eq('id', ID);
if (error) throw new Error(error.message);

// Verify
const { data: after } = await sb.from('estimates')
  .select('custom_prices, selected_package').eq('id', ID).single();
const env = after.custom_prices._envelope;
console.log('\n✓ Envelope trimmed.\n');
console.log('show_systems:', env.show_systems);
console.log('default_system:', env.default_system);
console.log('selected_package:', after.selected_package);
console.log('\nVisible components (hidden=false):');
for (const [slug, c] of Object.entries(env.components)) {
  if (!c.hidden) console.log(`  ✓ ${slug}`);
}
console.log('\nHidden components (hidden=true):');
for (const [slug, c] of Object.entries(env.components)) {
  if (c.hidden) console.log(`  ✗ ${slug}`);
}
console.log('\nAsphalt tier order:');
for (const t of env.components.roof_asphalt.tiers) {
  console.log(`  ${t.tier}. ${t.label}${t.popular ? '  ⭐ RECOMMENDED' : ''}`);
}
console.log('\n_inspection_section_visible:', after.custom_prices._inspection_section_visible);
console.log('\nCustomer URL: https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-80');
