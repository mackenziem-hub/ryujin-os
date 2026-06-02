// Seed Plus Ultra's tenant_settings.envelope_catalog with the canonical
// catalog of every product + service the proposal builder can present.
//
// Pricing source: Mary's PU-78 envelope (which mirrors the Plus Ultra
// proposal SOP), plus the additional components Mac approved this session
// (rejuvenation, leafguard, ventilation, chimney_flash, financing).
//
// Re-running is safe: this REPLACES the catalog (idempotent write).
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

const TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b'; // Plus Ultra

const catalog = {
  version: 1,
  default_show_systems: ['asphalt', 'metal'],
  default_system: 'asphalt',
  // Base catalog. New estimates can inherit this verbatim (everything visible)
  // and Mac toggles things off per-customer in the proposal builder.
  components: {
    roof_asphalt: {
      label: 'Asphalt Shingle System',
      tiers: [
        { hard: 16892, slug: 'gold', tier: 1, label: 'Gold Package',
          subtitle: 'CertainTeed Landmark architectural shingles, full tear-off, synthetic underlayment, ice and water, steep-slope install',
          warranty_label: '15-yr workmanship + Lifetime mfr' },
        { hard: 18793, slug: 'platinum', tier: 2, label: 'Platinum Package', popular: true,
          subtitle: 'CertainTeed Landmark Pro Max Def + Grace ice and water + Roof Runner upgrade',
          warranty_label: '20-yr workmanship + Lifetime mfr' },
        { hard: 29118, slug: 'diamond', tier: 3, label: 'Diamond Package',
          subtitle: 'CertainTeed Grand Manor designer, Super Shangle 5-layer slate profile',
          warranty_label: '25-yr workmanship + Lifetime mfr' }
      ]
    },
    roof_metal: {
      label: 'European Clay Imitation Metal System',
      tiers: [
        { hard: 34864, slug: 'euro-clay', tier: 2, label: 'European Clay Imitation Metal',
          price: 65800, popular: true,
          subtitle: 'Designer metal that reads like a European clay-tile roof, installed straight over your existing roof on a strapped batten system. No tear-off, no redeck.',
          warranty_label: 'Lifetime panel, 15-yr workmanship, 50+ yr service life' }
      ]
    },
    service_rejuvenation: {
      label: 'NuRoof Revive (Rejuvenation)',
      subtitle: 'Spray-on rejuvenation that extends existing asphalt shingles by 5+ years. About a third the cost of replacement. 10-yr transferable Revive warranty.',
      hard: 6800,
      systems: ['asphalt']
    },
    prep_redeck: {
      hard: 5500,
      label: 'Full Redeck',
      systems: ['asphalt'],
      subtitle: 'New 7/16" OSB sheathing across the whole roof (~110 sheets). Gives a solid, sound deck under the new shingles.'
    },
    prep_strap: {
      hard: 2400,
      label: 'Strap Roof Deck',
      systems: ['asphalt'],
      subtitle: '1x4 strapping over existing deck to true-up dips and create a fresh nail base. Cheaper than full redeck when existing OSB is sound but uneven.'
    },
    remediation: {
      hard: 2500,
      label: 'Remediation Allowance',
      systems: ['asphalt'],
      subtitle: 'Set-aside for hidden rot, water damage, or chimney/structural surprises uncovered at tear-off. Any unused portion is credited back at close.'
    },
    trim_gutters: {
      hard: 2720,
      label: 'Gutters',
      subtitle: '5" continuous aluminum gutters + downspouts, color-matched. Sized to property.'
    },
    trim_soffit: {
      hard: 5100,
      label: 'Soffit',
      subtitle: 'Vented aluminum soffit, ties ventilation into the new roof.'
    },
    trim_fascia: {
      hard: 4420,
      label: 'Fascia',
      subtitle: 'Capped aluminum fascia, color-matched. Maintenance-free and seals the wood edge for good.'
    },
    trim_leafguard: {
      hard: 1020,
      label: 'Leaf Guard',
      subtitle: 'Continuous mesh leaf protection clipped over the new gutters. Eliminates seasonal cleaning. Pairs with new gutters.'
    },
    addon_ventilation: {
      hard: 1650,
      label: 'Attic Ventilation Upgrade',
      subtitle: 'Three maximum exhaust vents installed for proper attic airflow. Stops ice damming, extends shingle life, drops summer attic temps.'
    },
    addon_chimney_flash: {
      hard: 680,
      label: 'Chimney Reflash (per chimney)',
      subtitle: 'New step + counter flashing. Standard inclusion on tear-offs, broken out here so it can be priced separately on a partial-scope job.'
    },
    siding: {
      label: 'Siding & Cladding',
      tiers: [
        { hard: 0, slug: 'none', tier: 0, label: 'Roof-Only Project',
          subtitle: 'Best if siding is staying as-is and the priority is protecting from the top down.' },
        { hard: 10000, slug: 'vinyl-standard', tier: 1, label: 'Standard Vinyl',
          subtitle: 'Gentek Sovereign Select lap siding, low maintenance, clean modern profile.' },
        { hard: 14000, slug: 'vinyl-sequoia', tier: 2, label: 'Sequoia Premium', popular: true,
          subtitle: 'Gentek Sequoia 4-inch Premium Select lap, upgraded color depth and extended warranty.' },
        { hard: 17000, slug: 'cedar-shake', tier: 3, label: 'Cedar Shake (Designer)',
          subtitle: 'CertainTeed WoodShade vinyl shake, cedar profile, 50-yr fade warranty.' }
      ]
    },
    wall_assembly: {
      hard: 8500,
      label: 'Wall Assembly',
      subtitle: '7/16" OSB substrate + Tyvek house wrap + 1/2" EPS foam + VentiGrid rainscreen + strapping. The Performance Shell core, included with any siding.'
    },
    financing_promo: {
      label: '12-Month No-Interest Financing',
      subtitle: 'Customer pays nothing upfront, 12 months no interest no payments through Plus Ultra financing partner. Toggle ON to show the financing badge + monthly equivalent.',
      hard: 0
    },
    inspection_photos: {
      label: 'Inspection Photo Gallery',
      subtitle: 'Embeds the project photo gallery on the customer-facing proposal. Photos pulled from the linked project folder, marked-up versions (from the annotator) display when available.',
      hard: 0
    }
  }
};

console.log('Writing catalog with', Object.keys(catalog.components).length, 'components for tenant', TENANT_ID);

const { data, error } = await sb
  .from('tenant_settings')
  .update({ envelope_catalog: catalog })
  .eq('tenant_id', TENANT_ID)
  .select('tenant_id')
  .single();

if (error) {
  // tenant_settings row might not exist yet, try insert
  console.log('Update missed, trying insert:', error.message);
  const { error: insErr } = await sb
    .from('tenant_settings')
    .insert({ tenant_id: TENANT_ID, envelope_catalog: catalog });
  if (insErr) { console.error('Insert also failed:', insErr); process.exit(1); }
  console.log('Inserted new tenant_settings row.');
} else {
  console.log('OK, updated existing tenant_settings row.');
}

console.log('\nVerify: curl -s "https://ryujin-os.vercel.app/api/envelope-catalog" -H "x-tenant-id: plus-ultra" | head -c 500');
