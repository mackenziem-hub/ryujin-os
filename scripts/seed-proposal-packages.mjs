// Ryujin OS - Seed the proposal tier packages (proposal_packages) for Plus Ultra.
//
// Loads the canonical catalog from lib/proposalPackagesData.js (the same source
// lib/proposalPackages.js falls back to) and upserts one row per tier into the
// proposal_packages table (migration 099). After this runs, GET /api/proposal-packages
// reads from the table (source: 'db') instead of the in-code fallback; the data is
// identical either way, so sent proposals render byte-identical.
//
// RUN (later, by a human - do NOT run as part of authoring; build stops at PR open):
//   node --env-file=.env.local scripts/seed-proposal-packages.mjs
//   node --env-file=.env.local scripts/seed-proposal-packages.mjs --dry-run
// Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in the env-file. Idempotent
// (upserts on tenant_id,system,slug). Plus Ultra tenant resolved by slug, never hardcoded.
//
// No em dashes.

import { createClient } from '@supabase/supabase-js';
import { FALLBACK_PACKAGES } from '../lib/proposalPackagesData.js';

const DRY = process.argv.includes('--dry-run');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Run with --env-file=.env.local');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  // Resolve the Plus Ultra tenant_id by slug - never hardcode a uuid.
  const { data: tenant, error: tErr } = await sb
    .from('tenants').select('id').eq('slug', 'plus-ultra').maybeSingle();
  if (tErr || !tenant) {
    console.error('Could not resolve tenant slug "plus-ultra":', tErr?.message || 'not found');
    process.exit(1);
  }
  const tenantId = tenant.id;
  console.log(`Plus Ultra tenant_id = ${tenantId}`);

  const rows = FALLBACK_PACKAGES.map(p => ({
    tenant_id: tenantId,
    system: p.system,
    slug: p.slug,
    tier_tag: p.tier_tag,
    name: p.name,
    shingle_product: p.shingle_product,
    warranty_years: p.warranty_years,
    perks: p.perks,
    multiplier: p.multiplier,
    is_recommended: p.is_recommended,
    active: p.active !== false,
    sort_order: p.sort_order,
    updated_at: new Date().toISOString()
  }));

  if (DRY) {
    console.log(`[dry-run] would upsert ${rows.length} proposal_packages:`);
    for (const r of rows) console.log(`  ${r.system}/${r.slug} - ${r.name} (x${r.multiplier}, ${r.warranty_years}yr${r.is_recommended ? ', recommended' : ''})`);
    return;
  }

  const { data, error } = await sb
    .from('proposal_packages')
    .upsert(rows, { onConflict: 'tenant_id,system,slug' })
    .select('system, slug, name');
  if (error) {
    console.error('Upsert failed:', error.message);
    process.exit(1);
  }
  console.log(`Seeded ${data.length} proposal_packages:`);
  for (const r of data) console.log(`  ${r.system}/${r.slug} - ${r.name}`);
}

main().catch(e => { console.error(e); process.exit(1); });
