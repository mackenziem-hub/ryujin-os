// All-in-one: revert remediation auto-apply on the 12 offers I patched May 7,
// then regenerate Royal Oaks #46 + #47 at v2.1 canonical rates.
//
// Spec per Mac May 8:
//   - SOP multipliers (1.47 / 1.52 / 1.58 — hit the floor margins, no honored discount)
//   - 8/12 pitch (uniform per EagleView pitch diagram)
//   - extraLayers: 0 (1 layer existing is included in base — no extra needed)
//   - No remediation (newer building, no rot expected — disclaim if needed)
//   - Waste removal override: $750 per side ($1,500 full duplex / 2 sides)
//   - Pipes: 2 each side (penetrations only — no vent flashings)
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
const APPLY = process.argv.includes('--apply');

// ── PHASE 1: Remove remediation row from the 12 offers patched May 7 ─────
console.log('PHASE 1: Removing remediation row from offer scope_templates (revert May 7 patch)\n');

const SLUGS_TO_DEPATCH = [
  'gold','platinum','diamond',
  'commercial-economy','commercial-standard','commercial-premium',
  'commercial-flat-tpo','commercial-flat-epdm','commercial-flat-modbit',
  'metal-americana','metal-standing-seam','metal-premium'
];

const { data: offers } = await sb.from('offers')
  .select('id, slug, scope_template')
  .eq('tenant_id', TENANT)
  .in('slug', SLUGS_TO_DEPATCH);

const depatches = [];
for (const o of offers) {
  const tpl = Array.isArray(o.scope_template) ? o.scope_template : [];
  const filtered = tpl.filter(t => t && t.key !== 'remediation');
  if (filtered.length < tpl.length) {
    depatches.push({ id: o.id, slug: o.slug, before: tpl.length, after: filtered.length, newTemplate: filtered });
  }
}

console.log(`  ${depatches.length} offers had remediation → will remove (opt-in only going forward)`);
for (const d of depatches) console.log(`    ${d.slug}: ${d.before} → ${d.after} items`);

if (APPLY && depatches.length > 0) {
  for (const d of depatches) {
    const { error } = await sb.from('offers').update({ scope_template: d.newTemplate }).eq('id', d.id);
    if (error) { console.error(`  ✗ ${d.slug}: ${error.message}`); continue; }
    console.log(`  ✓ ${d.slug}`);
  }
}

// ── PHASE 2: Regenerate Royal Oaks #46 + #47 ───────────────────────────────
console.log('\n\nPHASE 2: Regenerating Royal Oaks #46 + #47 at v2.1 canonical rates\n');

const measurements = {
  squareFeet: 2709, pitch: '8/12', complexity: 'complex',
  distanceKM: 10,
  extraLayers: 0,                  // ← 1 layer included in base, no extra
  eavesLF: 170, rakesLF: 30, ridgesLF: 42, hipsLF: 158, valleysLF: 113,
  wallsLF: 16,
  pipes: 2, vents: 0, stories: 1,
  waste_removal_override: 750      // ← per-side share of $1,500 duplex waste cost
};

const { data: roofOffers } = await sb.from('offers')
  .select('id, slug').eq('tenant_id', TENANT)
  .in('slug', ['gold','platinum','diamond']);

const q = await calculateMultiOfferQuote(sb, {
  tenantId: TENANT, offerIds: roofOffers.map(o => o.id), measurements
});

const $ = n => '$' + Math.round(n).toLocaleString();
const cp = {};
console.log('  Per-side at v2.1 canonical rates (8/12, 33 SQ, no remediation, no extra layers):');
console.log('  ' + '─'.repeat(95));
for (const slug of ['gold','platinum','diamond']) {
  const o = q.offers[slug];
  const s = o.summary;
  cp[slug] = {
    total: s.sellingPrice,
    totalWithTax: s.totalWithTax,
    persq: s.pricePerSQ,
    tax: Math.round(s.sellingPrice * 0.15),
    margin: s.netMargin,
    customPrice: false,
    lineItems: o.lineItems
  };
  console.log(`    ${slug.padEnd(10)} hardCost ${$(s.hardCost).padStart(8)}  ×${s.multiplier}  → sell ${$(s.sellingPrice).padStart(8)}  + HST ${$(cp[slug].tax).padStart(6)}  =  ${$(s.totalWithTax).padStart(8)}  /  ${s.pricePerSQ}/SQ  /  ${s.netMargin} gross`);
}

console.log('\n  Combined (both sides):');
const totalRev = cp.platinum.total * 2;
const totalCust = cp.platinum.totalWithTax * 2;
console.log(`    Platinum × 2 sides: revenue ${$(totalRev)} pre-tax · customer pays total ${$(totalCust)}`);

// ── PHASE 3: Update both estimates with new calculated_packages ────────────
const ESTS = [
  { id: '1a368c06-76ec-4962-99a2-fb9001fb7ee9', label: 'Jean Gauvin #46' },
  { id: '4ac7f40e-d85d-4cba-9abc-e5d4c5e0fefb', label: 'Sharon #47' }
];

console.log('\n\nPHASE 3: Updating estimates with corrected calculated_packages\n');
if (APPLY) {
  for (const e of ESTS) {
    const { error } = await sb.from('estimates').update({
      calculated_packages: cp,
      extra_layers: 0,
      notes: [
        { author: 'claude-code', timestamp: new Date().toISOString().slice(0,10),
          note: `Regenerated May 8 2026 with v2.1 CANONICAL rate sheet (was drifted to lower Apr 28 actualized rates). Pitch 8/12. extraLayers=0 (1 layer included in base). NO remediation (newer building, no rot expected — disclaim if discovered on inspection). Waste removal overridden to $750/side (multi-load duplex). SOP multipliers — hit the floor at 12% Gold / 17% Platinum / 23% Diamond.` }
      ]
    }).eq('id', e.id);
    if (error) { console.error(`  ✗ ${e.label}: ${error.message}`); continue; }
    console.log(`  ✓ ${e.label} updated`);
  }
} else {
  console.log('  (DRY-RUN — pass --apply to mutate)');
}

if (!APPLY) {
  console.log('\n──────────────────────────────────────────────────────────────────────');
  console.log('Dry-run only. Re-run with --apply to commit Phase 1 + Phase 3.');
  console.log('──────────────────────────────────────────────────────────────────────');
}
