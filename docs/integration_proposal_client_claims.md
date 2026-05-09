# Integrating proposal-client.html with the Claims Library

**Bible Priority #2 follow-through.** Once `migration_036` is applied and `_seed_claims_2026-05-09.mjs` has populated the Plus Ultra row set, the next step is making customer-facing templates render through `lib/claims.js` instead of hardcoded strings.

This doc gives clean drop-in patches for the 5 P0 hotspots in `proposal-client.html` (line numbers match the version verified May 9 2026, commit `61f9e38`).

---

## Why this exists

The lint pass (`node scripts/lint-claims.mjs`) currently flags **24 violations / 21 P0** across customer-facing files. The most damaging are on `proposal-client.html` — every proposal page rendered to a customer today claims:

- "$2M liability insurance" (cancelled Feb 21 2026)
- "WCB coverage" (not in good standing since ~Aug 2025)
- "fully insured" (unsubstantiated until GL is rebound)

The claims library replaces hardcoded copy with status-gated database lookups. When GL is rebound, you flip `gl_2m_liability` to `status='active'` once and every proposal page everywhere updates.

---

## Two integration patterns

### Pattern A — Server-side render (recommended for new templates)

In `api/proposal.js` (the API that serves proposal page data), fetch the active claims block once and inject into the template payload:

```js
import { getActiveClaims } from '../lib/claims.js';

// inside handler, after resolving tenantId from the share token:
const trustClaims = await getActiveClaims(tenantId, [
  'insurance', 'warranty', 'certification', 'workmanship', 'documentation', 'reviews', 'local'
]);

// inject into the response payload sent to the proposal-client.html template
return res.json({
  ...existingPayload,
  trustClaims  // array of {key, category, copy, proof_source}
});
```

Then the template iterates `trustClaims` instead of hardcoding rows. Soft/disabled claims are simply absent from the array — there is no client-side filtering, so leakage is impossible.

### Pattern B — Client-side fetch (works for existing template without server changes)

Add a new endpoint `/api/claims?tenant_id=X` that returns only active claims:

```js
// api/claims.js (new file, ~30 lines)
import { getActiveClaims } from '../lib/claims.js';

export default async function handler(req, res) {
  const { tenant_id, category } = req.query;
  if (!tenant_id) return res.status(400).json({ error: 'tenant_id required' });
  const claims = await getActiveClaims(tenant_id, category ? category.split(',') : null);
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.json({ claims });
}
```

Then in `proposal-client.html`:

```html
<script>
  async function renderTrustRow() {
    const r = await fetch(`/api/claims?tenant_id=${TENANT_ID}&category=insurance`);
    const { claims } = await r.json();
    const insuranceClaim = claims.find(c => c.key === 'gl_2m_liability')
                       || claims.find(c => c.key === 'licensed_and_operating_nb');
    document.getElementById('trustInsuranceCell').textContent = insuranceClaim?.copy || '';
  }
  renderTrustRow();
</script>
```

---

## The 5 specific hotspots in proposal-client.html

All line numbers verified against commit `61f9e38`.

### Hotspot 1 — line ~1076 (introBio)

**Current:**
```html
<p id="introBio">Every Plus Ultra install is handled by our own crew — fully trained, harnessed daily, and backed by $2M liability insurance. We document every job from start to finish and stand behind it with a written workmanship warranty.</p>
```

**Replace:**
```html
<p id="introBio">Every Plus Ultra install is handled by our own crew — fully trained, harnessed daily, <span data-claim="gl_2m_liability,licensed_and_operating_nb"></span>. We document every job from start to finish and stand behind it with a written workmanship warranty.</p>
```

The `data-claim` attribute lists fallback keys in priority order. JS resolves the first active claim from the list and substitutes its `copy` value. If `gl_2m_liability` is `soft`, falls through to `licensed_and_operating_nb`. If both are `soft`, the span renders empty (graceful degradation).

### Hotspot 2 — line ~1211 (vs-comparison row)

**Current:**
```html
<div class="vs-row"><div class="vs-cell label">$2M liability + WCB coverage</div>...</div>
```

**Replace with one of two options:**

**Option 2A — drop the row entirely while GL/WCB are soft:** Wrap the `<div class="vs-row">` in a JS conditional that only renders if BOTH `gl_2m_liability` AND `wcb_coverage` resolve to active. Until both are restored, this row simply isn't shown — the rest of the comparison table remains intact.

**Option 2B — substitute the interim "licensed and operating" claim:**
```html
<div class="vs-row"><div class="vs-cell label" data-claim="licensed_and_operating_nb"></div>...</div>
```

Option 2B is the safer migration path — preserves the visual structure, just downgrades the claim accuracy.

### Hotspot 3 — line ~1670 (stat carousel)

**Current:**
```js
{ stat:'$2M', label:'Liability insured + WCB covered', icon:'...' }
```

**Replace:** Either remove the entry from the carousel array entirely until GL/WCB are restored, OR replace with a different stat (e.g., warranty length, photo count from CompanyCam):

```js
{ stat:'25 yr', label:'Workmanship warranty (Diamond tier)', icon:'...' }
```

Then on restoration, you reintroduce the original `$2M` entry — or better, render it from the claims library:

```js
const stats = [
  { stat:'25 yr', label: claimCopy('workmanship_warranty_tiered'), icon:'...' },
  { stat:'100+', label: claimCopy('companycam_photo_documentation'), icon:'...' },
  // restore when GL is rebound:
  // { stat:'$2M', label: claimCopy('gl_2m_liability'), icon:'...' }
];
```

### Hotspot 4 — line ~1895 (code comment, NOT customer-visible)

**Current:**
```js
// carries the $2M-liability / harnessed-daily / full-documentation credibility
```

**Action:** Comment-only. Update the comment text but no functional change. Could become:
```js
// carries the trust claims (insurance, harnessed-daily, full-documentation) credibility
```

### Hotspot 5 — line ~2498 (intro-card on simulator/configurator path)

**Current:**
```html
<div class="intro-card"><h3>Crew-installed, fully insured</h3><p>$2M liability insurance, harnessed daily, no day-labor sub-outs. Same crew start to finish.</p></div>
```

**Replace:**
```html
<div class="intro-card"><h3>Crew-installed</h3><p data-claim="gl_2m_liability,licensed_and_operating_nb"></p></div>
```

(Drop "fully insured" from the heading until GL is rebound; drop the `$2M` substring from the body.)

---

## Recommended order

1. Apply `migration_036` + run `_seed_claims_2026-05-09.mjs`
2. Add the `/api/claims` endpoint (Pattern B is faster — no template-engine changes required)
3. Add the small `data-claim` resolver script to `proposal-client.html` (~20 lines of JS)
4. Patch the 5 hotspots in order
5. Re-run `node scripts/lint-claims.mjs` — should drop from 21 P0 → ~13 P0 (other files still need patching, but proposal-client.html is the highest-traffic surface)
6. Repeat for `proposal-715-rt-11.html`, `index.html`, `marketing-strategy.html`

## When GL is rebound

One SQL update unblocks the `$2M` claim everywhere it's referenced:

```sql
UPDATE claims
SET status = 'active',
    notes = 'Restored DD/MM/YYYY — new policy bound by Guilherme',
    last_reviewed_at = now(),
    review_due_at = (now() + interval '1 year')
WHERE tenant_id = '84c91cb9-df07-4424-8938-075e9c50cb3b'
  AND key = 'gl_2m_liability';
```

The `claims_audit` trigger logs the status change automatically. Every proposal page reflects the restored claim on next render — no template edits required.
