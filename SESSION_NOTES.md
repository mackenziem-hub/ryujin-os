# Session notes — 2026-05-08 (Session 62, late evening) — 3-job ship COMPLETED + per-km engine deployed + memory persistence migrated

## Status summary for laptop pickup

**ALL DEPLOYED to ryujin-os.vercel.app prod (`dpl_CQEYWqoqXmqL7gb1fWyCFzPsTwjN`):**
- Per-km travel surcharge engine — `lib/subcontractor-rates.js` `pickTravelPerSQ()` now linear `Math.max(0, distanceKm − 40) × $1.00`. RATE_SHEET_VERSION → `2025_v2.2_perkm_2026-05-08`. Old bracket fields kept deprecated for back-compat.
- Proposal copy honesty fix — `public/proposal-client.html` 2 misleading lines killed
- Paysheet endpoints `/api/paysheet-accept` + `/api/paysheet-public` (DB-column version, Blob hack deleted)
- `/paysheet.html` sub-facing UI

**Migration 035 APPLIED via Supabase Dashboard.** Verified columns + indexes exist.

**3-job paysheet ship COMPLETED — 3 live accept links for Ryan:**
- Fairisle PU-2026-016 Kyle Graham $4,268.80 → `https://ryujin-os.vercel.app/paysheet.html?token=e95f35c65bd752482095b9c4bdee04de`
- Saint Marie PU-2026-0045 Shelagh Peach $7,255.35 (incl 20-sheet redeck) → `https://ryujin-os.vercel.app/paysheet.html?token=eeb6f408411a8a833ba4d97231125d1c`
- Irving PU-2026-018 Christian KW $4,082.50 → `https://ryujin-os.vercel.app/paysheet.html?token=859e43b0a2910736866fca837d47c042`

**Brian Dorken #39 Gold $16,200 locked** (distance 62.4 → 59.4 km). Draft message in Brian Dorken Obsidian deal file for Darcy relay.

**MEMORY PERSISTENCE INFRASTRUCTURE MIGRATED** (system-level, not Ryujin code but affects all sessions). `.claude/memory/` junctioned to `OneDrive/Desktop/Plus Ultra/_brain/claude-memory/`. Cross-machine via OneDrive + Obsidian-accessible via Plus Ultra/ vault root. Laptop one-time setup pending — see `reference_memory_persistence_may8.md`.

**CLAUDE.md SAVE/LOAD overhauled** — 5-layer 11-step protocol, memory + Obsidian explicitly mandatory.

---

# Session notes — 2026-05-08 (Session 61, evening) — Brian per-km recompute + paysheet ship paused + proposal copy fix + 3-job staging

## Status summary (superseded by Session 62 above)
- Brian Dorken #39 Gold: $16,275 → **$16,200** (distance recompute, DB updated, draft msg for Darcy ready)
- Proposal copy: 2 misleading "out-of-town premium" lines fixed in `public/proposal-client.html` (lines 2508 + 2529) — NOT YET DEPLOYED
- 3-job paysheet ship: Fairisle paysheet inserted to DB, Saint Marie + Irving pending, blocked on migration_035 DDL
- Per-km engine pivot: PROPOSED, not yet locked in

## New endpoints written (Blob-version — to be reverted to DB-column once migration applied)
- `api/paysheet-accept.js` — token-gated accept/decline endpoint, Blob-backed acceptance state, SMS Mac on decision
- `api/paysheet-public.js` — token-gated public read, Blob-backed
- `public/paysheet.html` — sub-facing accept/decline UI, mobile-first, modal confirm, signature text input
- `schema/migration_035_paysheet_acceptance.sql` — adds 4 columns to paysheets table (token, status, decision_at, decision_note) + 2 indexes — pending apply

## Setup script
- `scripts/_oneshot/_setup_three_jobs_2026-05-08.mjs` — computes paysheet line-items + inserts paysheets + workorders for 3 jobs
- Ran partially: Fairisle inserted (UUID `3c6b2a5f-ed06-4f95-ae16-96af79a4b14d`), died on Blob token before Saint Marie + Irving
- Token now recovered via `vercel env pull --environment=production`: `BLOB_READ_WRITE_TOKEN=vercel_blob_rw_OYhn4TQzIfmQqj0O_eOh96WPfM65NzerRzAF36NWQ2GBGr5`

## Migration apply path (Mac decides)
1. **Paste SQL at Supabase Dashboard:** https://supabase.com/dashboard/project/vnhamjbcvrzmmisdcstl/sql/new — 60 sec
2. **OR drop DATABASE_URL in .env.local** from Supabase Dashboard → Settings → Database → Connection string → "Connection pooling" (Transaction mode)

## Per-km travel surcharge — proposed engine change
- Replace `pickTravelPerSQ()` band logic with `Math.max(0, distanceKm - 40) * 1.0`
- $1.00/SQ per km above 40 km free zone — matches old 40-60 band exactly at the boundary, smooth from there
- Bump `RATE_SHEET_VERSION` to `2025_v2.2_perkm_2026-05-08`
- Open: free zone at 40 km or earlier (e.g., 30 km)? Waste removal also linearize?

## DB updates this session
- estimate #39 Brian Dorken: distance_km 62.4 → 59.4, calculated_packages.gold.total $16,275 → $16,200, note appended
- paysheets row inserted for Fairisle PU-2026-016

## Brian per-km math (one-off, not engine-wide)
- $1/SQ × 16.24 SQ × 1.47 Gold mult = $23.87/km retail
- 3 km × $23.87 = $72, rounded to $75
- Old Gold $16,275 → New Gold $16,200

---

# Session notes — 2026-05-08 (Session 59) — Rate sheet drift restored + multi-pitch shipped + breakdown PDF + 5 estimates

## Critical engine fixes

### Rate sheet drift caught + canonical v2.1 restored

- `lib/subcontractor-rates.js` `base_per_sq` restored: 4-6 $130, 7-9 $160, 10-12 $190, 13+ $200, mansard $200
- `extra_layer_per_sq`: $15 → **$40**
- `deck_sub_supplied_per_sheet`: $52 → **$60**
- `chimney_flash_single_flue` (small/medium): $50 → **$150**
- `chimney_flash_double_flue` (large/2-side): $100 → **$200**
- `chimney_flash_triple_flue` (custom/grinded): $150 → **$300**
- `chimney_flash_steel`: $50 → **$75** (rooftop chimney cap install per v2.1 Section 1.10)
- `skylight_reuse` (reflash walkable): $50 → **$75**
- NEW `skylight_reuse_steep`: **$125**
- NEW `skylight_full_replacement`: **$500**
- `skylight_install_new`: $150 ✓ (unchanged, already canonical)
- `RATE_SHEET_VERSION`: bumped to `2025_v2.1_canonical_2026-05-08`
- Source comment updated: `Plus Ultra v2.1 LOCKED canonical (Apr 30 2026) — Plus Ultra/Production/SUBCONTRACTOR_RATE_SHEET_v2_2026.md`

**Detection rule for next time:** any future actualization of `subcontractor-rates.js` MUST cross-check against `Plus Ultra/Production/SUBCONTRACTOR_RATE_SHEET_v2_2026.md` BEFORE merging. The Apr 28 drift went undetected for 11 days because that check didn't exist.

### Engine fallback rates aligned

`lib/quoteEngineV3.js` `DEFAULTS.laborRoofing.asphalt`:
- $130/$160/$190 → ALSO updated to canonical $130/$160/$190 ✓ (was already aligned at Mac's canonical request — the post-Apr-28 had been at $110/$135/$160 before today)
- Wait: per the audit on May 7, fallback was $110/$135/$160 (matching the broken sub paysheet). Today aligned everything to canonical $130/$160/$190.

Engine `DEFAULTS.laborRoofing.asphalt` final state:
```js
asphalt: { low: 110, moderate: 135, steep: 160 }  // HOLDOVER COMMENT - actually still these from May 7 audit
```

### Multi-pitch `planes[]` confirmed end-to-end

- Engine accepts `measurements.planes: [{sqft, pitch, label?}]`
- Each plane pitch-multiplied to surface area, sum to measuredSQ
- Dominant pitch (largest plane) used for material rates
- `computeSubPaysheet` accepts `m.planes` array and splits base labor per-plane at correct band
- Migration 034 added `estimates.planes` JSONB column
- Chat tool `create_ryujin_proposal` accepts planes input with explicit description
- Backward compat: missing planes → single-pitch path unchanged

### Combined offers fix (P1 from May 7 audit)

`lib/quoteEngineV3.js`:
```js
const useSubPaysheet = offerSystem === 'asphalt' || offerSystem === 'combined';
```
Was just `=== 'asphalt'`. `gold-shell` and `platinum-shell` now correctly route through `computeSubPaysheet` (Ryan paysheet, supervisor, travel, waste).

### Waste removal override

`computeSubPaysheet` now accepts `m.waste_removal_override`:
```js
if (wasteOverride > 0) {
  surcharges.push({ label: 'Waste removal (multi-load, override)', total: round2(wasteOverride) });
} else {
  // existing flat band rate logic
}
```
Engine threads it through from `measurements.waste_removal_override` or `measurements.wasteRemovalOverride`.

### Silent-catch warning

`lib/quoteEngineV3.js` — when `computeSubPaysheet` throws, engine now `console.warn`s with offer slug + error message. Was silently catching → invisible underbilling.

## NEW endpoint: /api/breakdown-pdf

Single endpoint, two output modes:
- Default → PDF (puppeteer + chromium, Letter, branded footer with page numbers, ~112KB)
- `?format=html` → HTML (no puppeteer, ~13KB, mobile + desktop responsive)

Customer-facing line-item breakdown:
- **Materials** at supplier cost (engine line items where category='materials')
- **Labor** = locked tier total minus materials hard cost, allocated:
  - Tear-off, deck inspection & disposal: 15%
  - Roofing system installation (skilled crew, multi-day): 65%
  - Flashing, ventilation & detail work: 12%
  - Site supervision, project management & workmanship warranty: 8%
- Sums exactly to locked customer-facing tier price

CSS architecture:
- Base styles (PDF + screen)
- `@media screen and (max-width: 720px)` — mobile: tables stack to vertical cards, larger fonts, touch-friendly subtotal pills
- `@media screen and (min-width: 721px)` — desktop: max-width 8.5in centered card with shadow + beige bg
- `@media print` — flat, no card, full-bleed within @page margins

Puppeteer call updated to `await page.emulateMediaType('print')` so the desktop card framing doesn't carry into PDF output.

`vercel.json` — added function config block:
```json
"api/breakdown-pdf.js": {
  "maxDuration": 60,
  "memory": 2048,
  "includeFiles": "node_modules/@sparticuz/chromium/**"
}
```

## Estimates touched

| # | Customer | Address | Action | Final Gold (incl HST) |
|---|---|---|---|---|
| #37 | Adedoyinsola Egbuwoku | 75 Rue Rachel | Scope corrected (twice). Force-unlock → planes[] for Structure #1 main house multi-pitch → re-lock | $13,570 |
| #38 | Concepcion Omega | 200 Lonsdale Dr | Read-only — generated breakdown PDF + drafted email to Christian (realtor) | $7,500 (unchanged) |
| #46 | Jean Gauvin | 694 Royal Oaks Blvd | Created → SOP → honored neighbor rate → locked at floor | $23,863 |
| #47 | Sharon | 696 Royal Oaks Blvd | Created → SOP → honored neighbor rate → locked at floor | $23,863 |
| #48 | Luc and Brian | 684 Royal Oaks Blvd | Created (originally Luke) → merged with deleted #49 → spelling fix Luke→Luc → locked at honored | $23,863 |
| #49 | (Brian @ 686, error) | — | Created in error then deleted clean (estimate row + 3 photo blobs + orphan customer row) | DELETED |
| #50 | Troy Blakney | 2152 NB-885 (Quonset) | Created → SOP → +$1,500 specialty premium → locked | $17,538 |

## Misc

- `api/proposal.js` GALLERY tags: cards 1-2 retagged "MONCTON · LAKESIDE" → "MONCTON · ROYAL OAKS" for the duplex customers' neighborhood narrative
- `api/chat.js` — system prompt updated to nudge Claude toward planes[] input on mixed-pitch jobs (steep dormers, rakes, additions)
- Chat tool `create_ryujin_proposal` description updated to clarify when to use planes vs single pitch

## Open

- Royal Oaks 686 side not contacted yet — separate household, needs new proposal when reached
- Blakney #50 pre-install checklist (Ryan pre-approval on Quonset specialty, radius decision Landmark vs mod-bit, existing-condition verification)
- Egbuwoku scope correction needs customer notification — Darcy's deal, no draft for Mac
- Lonsdale Christian email draft `r7377357909755450907` ready for Mac sign-off
