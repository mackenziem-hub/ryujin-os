# Pricing Formula v2 — Plus Ultra SOP

**Status:** Active SOP. Source of truth for residential asphalt pricing.
**Last benchmarked:** 2026-04-24 against Cornhill (accepted) + Patricia (regenerated).
**Referenced from:** `lib/quoteEngineV3.js:1288`

---

## 1. The formula

```
hardCost     = materials(on totalSQ_with_waste)
             + labor(on measuredSQ, no waste)
             + adders (distance, warranty, overhead-if-opted-in, remediation)

sellingPrice = round( hardCost × packageMultiplier , $25 )

if marginPct(sellingPrice) < marginFloor:
    sellingPrice = round( hardCost / (1 − marginFloor) , $25 )
```

`packageMultiplier` is **fixed per offer**, NOT computed from a "target margin." That is deliberate (see §4).

---

## 2. Plus Ultra residential multipliers (v1 SOP)

| Tier      | Slug       | Multiplier | Approx gross margin |
|-----------|------------|-----------:|--------------------:|
| Gold      | `gold`     |   **1.47** |               ~32%  |
| Platinum  | `platinum` |   **1.52** |               ~34%  |
| Diamond   | `diamond`  |   **1.58** |               ~37%  |

Stored in `offers.multipliers.local` (jsonb) per tenant. Plus Ultra tenant UUID: `84c91cb9-df07-4424-8938-075e9c50cb3b`.

**Economy** is deactivated for Plus Ultra — Plus Ultra is CertainTeed ShingleMaster, Gold/Landmark is the in-brand entry tier.

---

## 3. What's already inside the multiplier (do not add separately)

The 1.47/1.52/1.58 numbers are NOT raw cost-plus markup. They embed:

- 20% company overhead (rent, insurance, vehicles, admin)
- 10% sales load
- 5% marketing load
- Crew profit margin

That's why the engine **does not** apply daily project-overhead for residential local jobs (see `lib/quoteEngineV3.js:1248-1262` — `use_daily_overhead` defaults false; only metal extended-stay opts in).

If you ever feel the urge to "fix" margins by raising the multiplier *and* adding overhead lines, you are double-counting. Don't.

---

## 4. Why the multipliers are these specific numbers

They are **market-anchored**, not theory-derived. The numbers were set against accepted-quote benchmarks in the Moncton/Riverview NB market, where Plus Ultra competes against ~6 known roofers. They represent the highest price the market accepts for each tier without losing the deal to a comparable competitor.

**Benchmarks that anchor v1 (as of 2026-04-24):**

| Job        | SQ    | Tier      | Outcome   | Calc'd via 1.47/1.52/1.58 |
|------------|-------|-----------|-----------|---------------------------|
| Cornhill   | ~34   | Gold      | Accepted  | $19,336                   |
| Patricia   | 34.54 | Gold      | Sent      | $23,150                   |
| Patricia   | 34.54 | Platinum  | Sent      | $27,750                   |
| Patricia   | 34.54 | Diamond   | Sent      | $42,950                   |

Cornhill's accepted price is the load-bearing number. Any change that pushes a comparable Gold above ~$22-24K for a 34 SQ medium-complexity roof is overshooting the market.

---

## 5. The "do not change without two benchmarks" rule

Before changing any multiplier:

1. **Pull at least 2 recently-accepted quotes** of comparable SQ + complexity.
2. **Run the proposed multiplier** against those quotes' hard costs.
3. **Confirm the new selling price stays within ±10% of what was accepted.**
4. **Document the rationale + benchmarks in this file** before the DB change ships.

This rule exists because of 2026-04-24: a session reasoned from first principles (target net margin → required gross multiplier), pushed Gold/Plat/Diamond to 1.89/2.08/2.38, and quoted Patricia Gold at $33,100 — $13,764 above the comparable accepted Cornhill price. Caught and reverted same day. See `schema/migration_016_REJECTED_overshot_market.sql` + `migration_017_revert_multipliers.sql`.

---

## 6. Where prices come from in the engine

| Component | Source | File:line |
|-----------|--------|-----------|
| Pitch multiplier | hardcoded `PITCH_MULTIPLIERS` (geometry, never tenant-configurable) | `quoteEngineV3.js:18-23` |
| Waste factors | hardcoded `WASTE_FACTORS` (10/15/20% by complexity) | `quoteEngineV3.js:25` |
| Labor rates | `tenant_settings.labor_roofing` (fallback to `DEFAULTS.laborRoofing`) | `quoteEngineV3.js:34-48, 111+` |
| Material unit cost | `override → merchants → regional_pricing → product default` | `quoteEngineV3.js` resolvePrice |
| Package multiplier | `offers.multipliers.local` (jsonb per offer) | `quoteEngineV3.js:1292-1294` |
| Margin floor | `offers.margin_floor` (percent, default 10) | `quoteEngineV3.js:1298` |
| Distance adder | `tenant_settings.distance_tiers.adders` (per-SQ labor add) | `quoteEngineV3.js:1237` |
| Tax | `tenant_settings.tax_rate` (NB default 15%) | `quoteEngineV3.js:1306` |

---

## 7. Known issues across the quote → crew material pipeline

### 7a. Crew/engine waste mismatch (FIXED in code 2026-04-24 evening; durable migration pending)

**Was:** `public/production-materials.html` hardcoded `const WASTE = 0.10`, while the engine uses 10/15/20% by complexity. Effect: crew under-ordered shingles ~5-9% on medium/complex jobs.

**Tonight's code fix (shipped, uncommitted):** `bundlesForShingles()` now reads waste via `resolveWaste(wo)` which prioritizes:
1. `wo.waste_pct` (when stamped on the WO directly — see migration 018)
2. `wo.complexity` (column doesn't exist yet but if added, takes precedence over estimate)
3. `wo.estimate.complexity` (joined from estimates table — works today for any WO with linked estimate)
4. Default 0.15 (medium) for orphan WOs

Also fixed: `bundlesForShingles()` order-of-ops now `Math.ceil(sq × (1+waste)) × rate` instead of `Math.ceil(sq × rate × (1+waste))` — matches engine exactly. Old order produced 1-bundle shortages on jobs where the inner math landed just above integer.

**Pending migrations** (see schema/migration_018_workorder_waste_pct.sql) — adds `waste_pct numeric(4,3)` column. Apply after DATABASE_URL is set in `.env.local` (or paste into Supabase SQL editor). Idempotent.

### 7b. Patricia "153 bundle bug" — RESOLVED, was a phantom

Investigated 2026-04-24 evening. Pulled Patricia (estimate #25) from DB:
- `roof_area_sqft = 3454`, `pitch = 8/12`, `complexity = complex`
- Engine path: 3454 × 1.202 (8/12 pitch mult) = 4151.7 → ceil/100 = **42 measuredSQ**
- 20% waste → ceil(42 × 1.20) = **51 totalSQ**
- × 3 bps = **153 bundles** ✅ exactly what the engine produced

Commit `e069272`'s "expected 125" used `34.54 = roof_area_sqft / 100`, which is the un-pitched 2D area / 100 — NOT the labor or material basis. The engine pitch-adjusts first. No bug. Patricia's Gold quote at $23,150 is correct per v1 SOP.

### 7c. Engine labor basis — CHECKED, correct

`quoteEngineV3.js:694-701`: tearoff/install/extra_layer/cedar_tearoff_labor all use `measuredSQ`. Commit message claim crossed off.

---

## 8. Sanity-check benchmarks for new quotes

Eyeball any new engine quote against `$/measuredSQ` (price ÷ pitch-adjusted-SQ ÷ 100, NOT raw sqft / 100):

| Tier      | Approx $/measuredSQ | Source               |
|-----------|---------------------|----------------------|
| Gold      | ~$565               | Cornhill (medium)    |
| Gold      | ~$670               | Patricia 8/12 complex |
| Platinum  | ~$680               | Patricia (medium baseline) |
| Diamond   | ~$1,200             | Patricia regen       |

Higher pitch + higher complexity push $/SQ up legitimately. Quotes outside ±15% of a comparable job (matched on pitch + complexity) suggest something's off — pull the line items to find which.
