// Ryujin OS - Seed the preset proposal templates (proposal_templates) for Plus Ultra.
//
// A template is a named, ordered composition of Sections content blocks plus a
// `product_plan` that tells the renderer how to source + present pricing.
// Mac picks a template at builder time; it lays out the right blocks in the
// persuasion spine and wires the right pricing mode.
//
// Persuasion spine (canonical block order; templates omit blocks that don't apply):
//   hero → intro → inspection → scope → products → proof → reviews →
//   why_us → guarantee → comparison → accept
//
// product_plan.mode values:
//   good_better_best | configurator | gutters | repair | two_path
//
// The block_keys referenced here are seeded by scripts/seed-proposal-blocks.mjs.
//
// RUN (later, by a human - do NOT run as part of authoring):
//   node --env-file=.env.local scripts/seed-proposal-templates.mjs
// Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in the env-file.
//
// Idempotent: upserts on (tenant_id, slug), so it is safe to re-run.

import { createClient } from '@supabase/supabase-js';

// ── env (read via process.env so --env-file populates it; .trim() per the
//    Vercel trailing-newline bug) ──
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Run with --env-file=.env.local');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// Full persuasion spine, in canonical order. Each template picks an ordered
// SUBSET of these block_keys (omitting blocks that don't apply).
const SPINE = ['hero', 'intro', 'inspection', 'scope', 'products', 'proof', 'reviews', 'why_us', 'guarantee', 'comparison', 'accept'];

// Helper: keep only the requested keys, in spine order. Guards against typos so
// every emitted template stays on-spine.
function spine(keys) {
  const set = new Set(keys);
  for (const k of keys) {
    if (!SPINE.includes(k)) throw new Error(`Block "${k}" is not part of the persuasion spine`);
  }
  return SPINE.filter(k => set.has(k));
}

// ─────────────────────────────────────────────────────────────
// TEMPLATE PRESETS
// ─────────────────────────────────────────────────────────────
const TEMPLATES = [
  // 1. Asphalt good/better/best - the flagship 3-tier shingle proposal.
  {
    slug: 'asphalt-good-better-best',
    name: 'Asphalt - Good / Better / Best',
    description: 'Flagship 3-tier asphalt shingle proposal (Gold / Platinum / Diamond).',
    system: 'asphalt',
    sections: spine(['hero', 'intro', 'scope', 'products', 'proof', 'reviews', 'why_us', 'guarantee', 'comparison', 'accept']),
    product_plan: {
      mode: 'good_better_best',
      offer_slugs: ['gold', 'platinum', 'diamond'],
      recommended: 'platinum'
    }
  },

  // 2. Metal - 3-tier metal install (standard / enhanced / premium).
  {
    slug: 'metal',
    name: 'Metal Roof - Standard / Enhanced / Premium',
    description: 'Three metal install tiers: over-shingle, tear-off + underlayment, full redeck.',
    system: 'metal',
    sections: spine(['hero', 'intro', 'scope', 'products', 'proof', 'reviews', 'why_us', 'guarantee', 'accept']),
    product_plan: {
      mode: 'good_better_best',
      offer_slugs: ['metal-americana', 'metal-standing-seam', 'metal-premium'],
      recommended: 'metal-standing-seam'
    }
  },

  // 3. Configurator shell - the Performance Shell envelope configurator. Pricing
  //    is driven by the envelope config on the estimate, not flat tier cards.
  {
    slug: 'configurator-shell',
    name: 'Performance Shell - Configurator',
    description: 'Full exterior envelope configurator (roof + siding + trim). Pricing from the envelope config.',
    system: 'exterior',
    sections: spine(['hero', 'intro', 'scope', 'products', 'proof', 'reviews', 'why_us', 'guarantee', 'accept']),
    product_plan: {
      mode: 'configurator'
    }
  },

  // 4. Gutters - seamless gutter package (priced by the gutter engine).
  {
    slug: 'gutters',
    name: 'Gutters - Seamless Package',
    description: 'Seamless aluminum gutter package, priced by the gutter quote engine.',
    system: 'gutters',
    sections: spine(['hero', 'intro', 'scope', 'proof', 'reviews', 'why_us', 'accept']),
    product_plan: {
      mode: 'gutters'
    }
  },

  // 5. Repair - targeted repair scope, single price (no good/better/best).
  {
    slug: 'repair',
    name: 'Roof Repair',
    description: 'Targeted repair scope with a single price. Inspection-led, no tier ladder.',
    system: 'asphalt',
    sections: spine(['hero', 'intro', 'inspection', 'scope', 'proof', 'reviews', 'why_us', 'guarantee', 'accept']),
    product_plan: {
      mode: 'repair'
    }
  },

  // 6. Rejuvenation vs replacement - two-path proposal. Path A = NuRoof Revive
  //    rejuvenation; Path B = full replacement good/better/best.
  {
    slug: 'rejuvenation-vs-replacement',
    name: 'Rejuvenation vs Replacement',
    description: 'Two-path proposal: NuRoof Revive rejuvenation (Path A) vs full replacement tiers (Path B).',
    system: 'asphalt',
    sections: spine(['hero', 'intro', 'inspection', 'scope', 'products', 'proof', 'reviews', 'why_us', 'guarantee', 'comparison', 'accept']),
    product_plan: {
      mode: 'two_path',
      two_path: {
        pathA: { label: 'Rejuvenation', offer_slugs: ['revive'] },
        pathB: { label: 'Full Replacement', offer_slugs: ['gold', 'platinum', 'diamond'], recommended: 'platinum' }
      }
    }
  },

  // 7. Flat / commercial - good/better/best flat-roof system tiers.
  {
    slug: 'flat-commercial',
    name: 'Flat / Commercial Roof',
    description: 'Flat / commercial roof system tiers (TPO / EPDM / Mod Bit class).',
    system: 'flat',
    sections: spine(['hero', 'intro', 'inspection', 'scope', 'products', 'proof', 'reviews', 'why_us', 'guarantee', 'accept']),
    product_plan: {
      mode: 'good_better_best',
      offer_slugs: ['commercial-economy', 'commercial-standard', 'commercial-premium'],
      recommended: 'commercial-standard'
    }
  }
];

// ─────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────
async function main() {
  // Resolve the Plus Ultra tenant_id by slug - never hardcode a uuid.
  const { data: tenant, error: tErr } = await sb
    .from('tenants')
    .select('id')
    .eq('slug', 'plus-ultra')
    .single();
  if (tErr || !tenant) {
    console.error('Could not resolve tenant slug "plus-ultra":', tErr?.message || 'not found');
    process.exit(1);
  }
  const tenantId = tenant.id;
  console.log(`Plus Ultra tenant_id = ${tenantId}`);

  const rows = TEMPLATES.map(t => ({
    tenant_id: tenantId,
    slug: t.slug,
    name: t.name,
    description: t.description,
    sections: t.sections,
    product_plan: t.product_plan
  }));

  const { data, error } = await sb
    .from('proposal_templates')
    .upsert(rows, { onConflict: 'tenant_id,slug' })
    .select('slug, product_plan');
  if (error) {
    console.error('Upsert failed:', error.message);
    process.exit(1);
  }

  console.log(`Seeded ${data.length} proposal_templates:`);
  for (const r of data) console.log(`  ✓ ${r.slug} (${r.product_plan?.mode})`);
}

main().catch(e => { console.error(e); process.exit(1); });
