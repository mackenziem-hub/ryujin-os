// Apply $1,500 specialty/Quonset complexity premium to #50 across all tiers + lock.
// Premium reasoning: curved geometry + harness all-around + 3-day reality + mod-bit
// material risk + sub-rate cushion. Pure margin add — no extra hard cost.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());
const EST_ID = 'af97b4bf-68ec-4400-a0fb-3ef9c37466c1';
const PREMIUM = 1500;

const { data: ex } = await sb.from('estimates')
  .select('id, estimate_number, calculated_packages, tags, notes')
  .eq('id', EST_ID).single();

const cp = { ...(ex.calculated_packages || {}) };
for (const slug of ['gold', 'platinum', 'diamond']) {
  if (!cp[slug]) continue;
  const oldTotal = cp[slug].total;
  const newTotal = oldTotal + PREMIUM;
  cp[slug] = {
    ...cp[slug],
    total: newTotal,
    tax: Math.round(newTotal * 0.15 * 100) / 100,
    totalWithTax: Math.round(newTotal * 1.15 * 100) / 100,
    persq: Math.round(newTotal / 19),
    customPrice: true,
    margin_includes_specialty_premium: true
  };
}

const newTags = Array.from(new Set([...(ex.tags || []), 'specialty_quonset_premium_1500']));

const newNotes = [...(ex.notes || []), {
  author: 'claude-code',
  timestamp: new Date().toISOString().slice(0, 10),
  note: `SPECIALTY/QUONSET COMPLEXITY PREMIUM APPLIED — May 8 2026

+$1,500 across all tiers as specialty/curved-geometry premium. Pure margin add (no extra hard cost). Reasoning:

1. Per-SQ pricing now in line with specialty market ($802/SQ Gold instead of $724 — comparable specialty Quonsets in NB run $900-1,200/SQ)
2. Cushions the realistic 3-day crew effort vs engine's 2-day estimate (54 km out + harness all-around + curved-radius slows install 30-50%)
3. Cushions material risk — if curved 936 sf section needs mod-bit instead of Landmark for tight-radius bending (~$1,500 added hardcost)
4. Cushions Ryan sub-rate cushion — standard mansard $200/SQ may not cover Quonset specialty work; he may want more

NEW PRICING (bumped + same hardcost = bigger gross):
- Gold:     $${cp.gold.total} pre-tax / $${cp.gold.totalWithTax} incl HST  (was $${cp.gold.total - PREMIUM})
- Platinum: $${cp.platinum.total} pre-tax / $${cp.platinum.totalWithTax} incl HST  (was $${cp.platinum.total - PREMIUM})
- Diamond:  $${cp.diamond.total} pre-tax / $${cp.diamond.totalWithTax} incl HST  (was $${cp.diamond.total - PREMIUM})

REAL CASH NET TO MAC (Darcy 15%, 3-day realistic):
- Gold:     ~$3,418  (~$1,139/day — clears $700 floor)
- Platinum: ~$4,115  (~$1,372/day)
- Diamond:  ~$5,979  (~$1,993/day)

LOCKED at premium floor. Cannot drop below this without explicit unlock from Mac.

PRE-INSTALL CHECKLIST (still open, not blockers for locking):
- [ ] Ryan pre-approval on standard mansard rate vs specialty premium for the curved 10 SQ
- [ ] Verify curve radius on inspection — Landmark vs mod-bit material decision
- [ ] Confirm existing condition — current photo shows what may be metal panels (tear-off scope)`
}];

const NOW = new Date().toISOString();
const { error: u1err } = await sb.from('estimates').update({
  calculated_packages: cp,
  tags: newTags,
  notes: newNotes
}).eq('id', EST_ID);
if (u1err) { console.error(u1err.message); process.exit(1); }

await sb.from('estimates').update({
  locked_at: NOW,
  locked_reason: `Specialty/Quonset premium ($1,500) locked May 8 2026. Final pre-tax tiers: Gold $${cp.gold.total} / Platinum $${cp.platinum.total} / Diamond $${cp.diamond.total}. No further drop without explicit unlock from Mac.`
}).eq('id', EST_ID);

console.log(`✓ #${ex.estimate_number} updated and locked at specialty premium`);
console.log(`  Gold      $${cp.gold.total} pre-tax / $${cp.gold.totalWithTax} incl HST`);
console.log(`  Platinum  $${cp.platinum.total} pre-tax / $${cp.platinum.totalWithTax} incl HST  ← recommended`);
console.log(`  Diamond   $${cp.diamond.total} pre-tax / $${cp.diamond.totalWithTax} incl HST`);
