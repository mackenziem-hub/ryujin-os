// Seed Plus Ultra tenant 0 trust-claims library per ARCHETYPES bundle May 9.
// Run AFTER migration_036 is applied. Idempotent — uses upsert on (tenant_id, key).
// Status 'active' = safe to render. Status 'soft' = do not surface (compliance gap).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b'; // plus-ultra

const claims = [
  // CERTIFICATION — locked, true today
  {
    key: 'certainteed_select_shinglemaster',
    category: 'certification',
    status: 'active',
    copy: 'CertainTeed Select ShingleMaster™ — Lifetime Limited Warranty + 10-Year SureStart™',
    proof_source: 'CertainTeed contractor portal, contractor ID on file',
    notes: 'NEVER substitute GAF — Plus Ultra is CertainTeed-only.'
  },

  // WARRANTY — tier-specific, locked
  {
    key: 'workmanship_warranty_tiered',
    category: 'warranty',
    status: 'active',
    copy: 'Written workmanship warranty: 15 years on Gold, 20 years on Platinum, 25 years on Diamond',
    proof_source: 'PRICING.md tier definitions; contract template clause'
  },
  {
    key: 'leak_free_year_one',
    category: 'warranty',
    status: 'active',
    copy: 'Written leak-free year-one guarantee — if it leaks in year one due to our workmanship, we fix it free',
    proof_source: 'Contract template clause'
  },

  // DOCUMENTATION
  {
    key: 'companycam_photo_documentation',
    category: 'documentation',
    status: 'active',
    copy: '50-100+ photos every stage via CompanyCam — homeowner gets the album',
    proof_source: 'CompanyCam account, every job has photo set'
  },

  // REVIEWS
  {
    key: 'verified_google_reviews',
    category: 'reviews',
    status: 'active',
    copy: 'Verified Google reviews — see g.page/plusultra',
    proof_source: 'Google Business Profile',
    notes: 'g.page shortlink currently rate-limiting (429) per Manus audit P2 — fix queued'
  },

  // LOCAL
  {
    key: 'locally_owned',
    category: 'local',
    status: 'active',
    copy: 'Locally owned, Riverview-based, family-run',
    proof_source: 'NB business registration'
  },

  // INSURANCE — SOFT until rebound. THIS IS THE LIVE BLEED MANUS FLAGGED.
  {
    key: 'gl_2m_liability',
    category: 'insurance',
    status: 'soft',
    copy: '$2M General Liability insurance',
    proof_source: 'Pending — Guilherme rewriting policy after Feb 21 cancellation',
    notes: 'CANCELLED Feb 21 2026. DO NOT SURFACE until new policy is bound. See memory project_compliance_state_may5.md.',
    retracted_reason: 'GL policy cancelled Feb 21 2026, rewrite in progress'
  },
  {
    key: 'wcb_coverage',
    category: 'insurance',
    status: 'soft',
    copy: 'WCB-covered',
    proof_source: 'Pending — Sébastien rebuilding standing',
    notes: 'NOT in good standing since ~Aug 2025. Form 100 unfiled, Dec 31 injury claim open. DO NOT SURFACE until restored.',
    retracted_reason: 'WCB standing lapsed; clearance letter unavailable'
  },

  // INSURANCE — interim substitute usable while GL/WCB are soft
  {
    key: 'licensed_and_operating_nb',
    category: 'insurance',
    status: 'active',
    copy: 'Licensed and operating in New Brunswick',
    proof_source: 'NB business registration',
    notes: 'Interim substitute for GL/WCB row on proposal page until those are restored.'
  }
];

let upserted = 0, skipped = 0;
for (const c of claims) {
  const { error } = await sb.from('claims').upsert(
    { tenant_id: TENANT_ID, ...c },
    { onConflict: 'tenant_id,key' }
  );
  if (error) {
    console.error(`✗ ${c.key}: ${error.message}`);
    skipped++;
  } else {
    console.log(`✓ ${c.key} (${c.status})`);
    upserted++;
  }
}

console.log(`\nDone. ${upserted} upserted, ${skipped} skipped.`);
console.log('\nNext: integrate lib/claims.js into proposal-client.html template + contract-pdf.js + metalProposalCopy.js to render only active claims.');
