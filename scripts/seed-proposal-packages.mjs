// Seed proposal_packages (migration 099) from lib/proposalPackages.js
// CANONICAL_PACKAGES, for the Plus Ultra tenant. Idempotent upsert on
// (tenant_id, system, slug). Runs via the Supabase Management API (same
// hand-apply path as the migrations), so Terminal A runs it after 099 is
// applied. Dry-run by default; pass --apply to write.
//
//   node scripts/seed-proposal-packages.mjs            # prints the SQL
//   node scripts/seed-proposal-packages.mjs --apply    # executes it
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CANONICAL_PACKAGES } from '../lib/proposalPackages.js';

// Load .env.local the same way the other seed scripts do.
try {
  const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch {}

const PAT = (process.env.SUPABASE_PAT || '').trim();
const URL_ENV = (process.env.SUPABASE_URL || '').trim();
const ref = URL_ENV.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

// Plus Ultra Roofing tenant (matches the other seed scripts).
const TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b';

const q = s => `'${String(s).replace(/'/g, "''")}'`;
const jsonb = v => `${q(JSON.stringify(v))}::jsonb`;

const values = CANONICAL_PACKAGES.map(p => `(
  ${q(TENANT_ID)}, ${q(p.system)}, ${q(p.slug)}, ${q(p.tier_tag)}, ${q(p.name)}, ${q(p.description)},
  ${q(p.shingle_product)}, ${p.warranty_years}, ${jsonb(p.perks)}, ${p.multiplier},
  ${p.is_recommended}, ${p.sort_order}, true
)`).join(',\n');

const SQL = `INSERT INTO proposal_packages
  (tenant_id, system, slug, tier_tag, name, description, shingle_product, warranty_years, perks, multiplier, is_recommended, sort_order, active)
VALUES
${values}
ON CONFLICT (tenant_id, system, slug) DO UPDATE SET
  tier_tag = EXCLUDED.tier_tag,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  shingle_product = EXCLUDED.shingle_product,
  warranty_years = EXCLUDED.warranty_years,
  perks = EXCLUDED.perks,
  multiplier = EXCLUDED.multiplier,
  is_recommended = EXCLUDED.is_recommended,
  sort_order = EXCLUDED.sort_order,
  active = true,
  updated_at = now();`;

if (process.argv[2] !== '--apply') {
  console.log('DRY RUN. SQL that WOULD be executed (pass --apply to run):\n');
  console.log(SQL);
  console.log(`\n${CANONICAL_PACKAGES.length} packages for tenant ${TENANT_ID}.`);
  process.exit(0);
}

if (!PAT || !ref) {
  console.error('Missing SUPABASE_PAT or SUPABASE_URL in env. Cannot apply.');
  process.exit(1);
}

const resp = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: SQL })
});
if (!resp.ok) {
  console.error(`Seed failed: ${resp.status} ${await resp.text()}`);
  process.exit(1);
}
console.log(`Seeded ${CANONICAL_PACKAGES.length} proposal packages for Plus Ultra.`);
