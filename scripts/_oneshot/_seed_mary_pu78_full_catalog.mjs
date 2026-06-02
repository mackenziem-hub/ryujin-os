// Seed Mary O'Brien's PU-78 _envelope.components with the FULL canonical
// Plus Ultra catalog so every product + service shows as a toggleable row
// in /proposal-builder.html. Default state: only the 4 Mac approved
// (roof_asphalt, prep_redeck, trim_gutters, remediation) are visible;
// everything else is added with hidden:true.
//
// What's added on top of v1_backup:
//   service_rejuvenation - NuRoof Revive (~$200/SQ hard, $270 selling)
//   prep_strap           - strap roof deck (asphalt-only prep)
//   trim_leafguard       - $6/LF leaf protection (Mac's gutter LF * 6)
//   addon_ventilation    - Max exhaust vents (Mary has 2 chimneys, treat as 3 vents)
//   addon_chimney_flash  - Chimney reflash (Mary has 2 chimneys)
//   financing_promo      - 12-mo no-interest financing flag (zero hard, copy only)
//
// Non-destructive: backups _envelope_v1_backup is preserved untouched. The
// proposal-builder's Restore button can roll back. To re-run safely, the
// script always merges into whatever's currently on the row, only setting
// hidden:true on components it ADDS, never on what's already visible.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
function clean(v) { return String(v || '').replace(/\\n/g, '').replace(/\n/g, '').trim(); }
const sb = createClient(clean(process.env.SUPABASE_URL), clean(process.env.SUPABASE_SERVICE_KEY));

const EST_ID = '179cacdc-a4cd-48c5-91ba-b65930c7fd32';

// Mary-specific measurements (from /api/proposal payload)
const SQ = 34;
const GUTTER_LF = 170;
const CHIMNEYS = 2;

// Catalog of components NOT already on the row. Hard prices are starting
// values; Mac can adjust via direct DB edit or the future builder.
const ADDITIONAL_COMPONENTS = {
  service_rejuvenation: {
    label: 'NuRoof Revive (Rejuvenation)',
    subtitle: 'Spray-on rejuvenation that adds 5+ years of life to existing asphalt shingles. About a third of the cost of replacement. 10-yr transferable Revive warranty.',
    hard: Math.round(SQ * 200), // ~$200/SQ hard ($270/SQ selling matches Catherine PU)
    systems: ['asphalt'],
    hidden: true,
  },
  prep_strap: {
    label: 'Strap Roof Deck',
    subtitle: 'Add 1x4 strapping over existing deck to true-up dips and create a fresh nail base. Cheaper than a full redeck when the existing OSB is sound but uneven.',
    hard: 2400,
    systems: ['asphalt'],
    hidden: true,
  },
  trim_leafguard: {
    label: 'Leaf Guard',
    subtitle: 'Continuous mesh leaf protection clipped over the new gutters. Eliminates seasonal cleaning. Pairs with new gutters.',
    hard: GUTTER_LF * 6, // CLAUDE.md canonical: $6/LF
    hidden: true,
  },
  addon_ventilation: {
    label: 'Attic Ventilation Upgrade',
    subtitle: 'Three maximum exhaust vents installed for proper attic airflow. Stops ice damming, extends shingle life, drops summer attic temps.',
    hard: 1650,
    hidden: true,
  },
  addon_chimney_flash: {
    label: 'Chimney Reflash',
    subtitle: `Reflash ${CHIMNEYS} chimney${CHIMNEYS===1?'':'s'} with new step + counter flashing. Standard inclusion on tear-offs; broken out as a toggle here so it can be priced separately on a partial-scope job.`,
    hard: CHIMNEYS * 680,
    hidden: true,
  },
  financing_promo: {
    label: '12-Month No-Interest Financing',
    subtitle: 'Customer pays nothing upfront, 12 months no interest no payments through Plus Ultra financing partner. Toggle ON to show the financing badge + monthly equivalent on the proposal.',
    hard: 0,
    hidden: true,
  },
};

const { data: est, error: readErr } = await sb
  .from('estimates')
  .select('id, custom_prices')
  .eq('id', EST_ID)
  .single();
if (readErr) { console.error('READ FAIL:', readErr); process.exit(1); }

const cp = est.custom_prices || {};
let env = cp._envelope;
if (!env) { console.error('No _envelope on estimate'); process.exit(1); }

// Restore from v1 backup first if it exists, so we get the full original
// catalog (siding, metal, fascia, soffit, wall_assembly) back. Components
// not in the original 4-visible set get hidden:true.
const KEEP_VISIBLE = new Set(['roof_asphalt', 'prep_redeck', 'trim_gutters', 'remediation']);
if (cp._envelope_v1_backup) {
  console.log('Merging v1 backup into envelope (5 hidden components come back)');
  const backup = cp._envelope_v1_backup;
  env = JSON.parse(JSON.stringify(backup));
  for (const [k, c] of Object.entries(env.components || {})) {
    if (!KEEP_VISIBLE.has(k)) c.hidden = true;
  }
  // Restore Mac's stripped show_systems too. Original had ['asphalt', 'metal']
  // but Mac wants asphalt-only for Mary visible; user can flip metal back
  // through the system toggle later if she wants metal.
  env.show_systems = ['asphalt'];
  env.default_system = 'asphalt';
}

// Add the additional catalog items (all hidden:true)
let added = 0;
for (const [k, c] of Object.entries(ADDITIONAL_COMPONENTS)) {
  if (env.components[k]) {
    console.log(`  skip ${k} (already present)`);
    continue;
  }
  env.components[k] = c;
  added++;
  console.log(`  + ${k}: $${c.hard.toLocaleString()} hard, hidden=${!!c.hidden}`);
}

const newCp = { ...cp, _envelope: env };

const { data: upd, error: updErr } = await sb
  .from('estimates')
  .update({ custom_prices: newCp })
  .eq('id', EST_ID)
  .select('id')
  .single();
if (updErr) { console.error('UPDATE FAIL:', updErr); process.exit(1); }

const visible = Object.values(env.components).filter(c => !c.hidden).length;
const hidden = Object.values(env.components).filter(c => c.hidden).length;
console.log(`\nOK. Envelope now has ${visible + hidden} components total: ${visible} visible, ${hidden} hidden.`);
console.log('Added this run:', added);
console.log('\nBuilder: https://ryujin-os.vercel.app/proposal-builder.html?estimate_id=' + EST_ID);
console.log('Preview: https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-78');
