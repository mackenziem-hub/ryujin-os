// One-shot: ensure every active Plus Ultra offer's scope_template includes a
// `remediation` line item so the engine auto-applies the SOP-Section-13 allowance.
//
// Per project_offer_remediation_template_gap.md (May 7 2026): engine code at
// lib/quoteEngineV3.js:1486-1494 only fires the remediation block when a line
// item with item_key='remediation' AND included:true exists in scope_template.
// If the template is missing that row, every quote silently drops $1,500-$5,000.
//
// Usage:
//   node scripts/_oneshot/_patch_offer_remediation_2026-05-07.mjs           # dry-run
//   node scripts/_oneshot/_patch_offer_remediation_2026-05-07.mjs --apply   # mutate
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}

const APPLY = process.argv.includes('--apply');
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());
const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b'; // Plus Ultra Roofing

// Canonical remediation row shape. Engine resolver returns qty=1, unit='allowance',
// then the post-loop block (quoteEngineV3.js:1486-1494) overrides total_cost with
// getRemediationAllowance(hardCost, settings). category='remediation' keeps it
// off the materials/labor totals on the line-item table while still bumping hardCost.
const REMEDIATION_ROW = {
  key: 'remediation',
  category: 'remediation',
  label: 'Remediation Allowance',
  config: {},
  required: false,
  sort_order: 950
};

const { data: offers, error } = await sb
  .from('offers')
  .select('id, slug, name, active, system, scope_template')
  .eq('tenant_id', TENANT)
  .order('sort_order');
if (error) { console.error('fetch err', error); process.exit(1); }

console.log(`Found ${offers.length} offers for tenant ${TENANT}\n`);

const patches = [];
for (const o of offers) {
  const tpl = Array.isArray(o.scope_template) ? o.scope_template : null;
  const tplLen = tpl ? tpl.length : (tpl === null ? 'NULL' : 'not-array');
  const hasRem = tpl ? tpl.some(t => t && t.key === 'remediation') : false;

  const status = !tpl
    ? '🔴 EMPTY TEMPLATE'
    : hasRem
      ? '✅ has remediation'
      : '🟡 missing remediation';

  console.log(`  ${o.slug.padEnd(28)} active=${String(o.active).padEnd(5)} sys=${(o.system||'?').padEnd(10)} items=${String(tplLen).padEnd(6)} ${status}`);

  if (!o.active) continue;        // skip deactivated
  if (!tpl) {
    console.log(`     ↳ SKIP: scope_template is null/invalid — needs full template seed, not just remediation patch`);
    continue;
  }
  if (hasRem) continue;            // already good

  const newTemplate = [...tpl, { ...REMEDIATION_ROW }];
  patches.push({ id: o.id, slug: o.slug, newTemplate });
}

if (patches.length === 0) {
  console.log('\nNo patches needed. All active offers either already have remediation or have null templates.');
  process.exit(0);
}

console.log(`\n${APPLY ? 'APPLYING' : 'WOULD APPLY'} ${patches.length} patch${patches.length===1?'':'es'}:`);
for (const p of patches) console.log(`  → append remediation to "${p.slug}" (now ${p.newTemplate.length} items)`);

if (!APPLY) {
  console.log('\nDry-run only. Re-run with --apply to mutate.');
  process.exit(0);
}

let okCount = 0;
for (const p of patches) {
  const { error: uerr } = await sb
    .from('offers')
    .update({ scope_template: p.newTemplate })
    .eq('id', p.id);
  if (uerr) {
    console.error(`  FAIL ${p.slug}: ${uerr.message}`);
    continue;
  }
  okCount++;
  console.log(`  ✓ ${p.slug}`);
}

console.log(`\nDone. ${okCount}/${patches.length} offers patched.`);
