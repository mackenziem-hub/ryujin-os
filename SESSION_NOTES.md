# Session notes — 2026-04-27 evening (SOP REALIGNMENT — strip double-counting loading layer)

The Apr 27 morning session bolted on a "floor enforcement" loading layer that
was double-counting the 35% S+M+O already embedded in the multiplier. This
session removed it and rebuilt the engine to match `pricing_formula_v2.md`
exactly. Six commits, one migration.

## What changed

**Engine (`lib/quoteEngineV3.js`)**
- Stripped the 30% loading subtraction from the floor calc. The multiplier
  formula `1 + 0.10 + 0.05 + 0.20 + target_profit` already includes the 35%
  loaded layer per SOP Section 3 — subtracting it again was a known bug.
- Added `sopProfit` (hardCost x 12/17/23%) and `sopNet` (= sopProfit) so the
  engine reports SOP-canonical numbers directly.
- Added `realCashNet` (sell − hardCost − sell × real_loading_pct) for "am I
  making money" reporting using lean overhead (Plus Ultra default 12%).
- Added `belowBreakeven` flag. Multipliers below 1.35 (= breakeven on 35%
  loading) are flagged with `breakevenWarning` text. Flag-only, no auto-bump.
- Added `apply_waste_to_bundles` toggle. False for Plus Ultra (Mac orders
  bundles flat at 3/SQ no waste). Labor still uses measuredSQ pre-waste per
  SOP Section 5.

**Proposal API (`api/proposal.js`)**
- Removed auto-bump of below-floor tiers. Per SOP, multiplier IS the price.
- Removed below-floor tier filtering. Public + internal both show all tiers
  exactly as `calculated_packages.summary.sellingPrice`.
- Replaced `floorAudit` with `sopAudit` (SOP profit + real cash net per tier).

**Migration 024**
- Tenant settings: added `min_custom_multiplier` (default 1.35),
  `real_loading_pct` (default 0.12), `apply_waste_to_bundles` (default false).
- Merchant prices: Starter Strip $52→$72, Hip & Ridge $55→$67 (matches
  internal sheet exactly).
- Coastal Drywall Supplies merchant added. Bundle products (Landmark, Pro,
  Presidential, Starter, Ridge cap) remapped from Kent → Coastal.

## Validation

- **Mountain Rd Section 16**: SOP says hardCost $39,175 × 1.52 = $59,546.
  Engine produces $59,550 (within $25 rounding). SOP profit 17% × $39,175 =
  $6,659.75. Engine produces $6,659.75. Match.
- **Sheila #71 (EOS)**: hardCost $14,434 × 1.52 = $21,939.68 → rounded $21,950.
  Engine matches. SOP profit 17% × $14,434 = $2,453.78. Engine matches.
- **Breakeven guard**: multipliers 1.30, 1.34 trigger `belowBreakeven=true`;
  1.35, 1.47, 1.52 do not. Verified.

## 3 IE quotes regenerated (--persist)

| Address | Tier | Old Sell | New Sell | Hard Cost | SOP Profit | Real Cash Net |
|---|---|---|---|---|---|---|
| Tobias #26 | gold | $11,750 | $11,425 | $7,424.78 | $891 | $2,629 |
| Tobias #26 | platinum | $13,475 | $13,075 | $8,277.78 | $1,407 | $3,228 |
| Tobias #26 | diamond | $19,200 | $18,425 | $11,352.78 | $2,611 | $4,861 |
| Midway #27 | gold | $10,825 | $10,500 | $6,797.82 | $816 | $2,442 |
| Midway #27 | platinum | $12,425 | $12,025 | $7,583.82 | $1,289 | $2,998 |
| Midway #27 | diamond | $17,100 | $16,375 | $10,043.82 | $2,310 | $4,366 |
| Chartersville #28 | gold | $12,575 | $12,225 | $8,323.32 | $999 | $2,435 |
| Chartersville #28 | platinum | $14,550 | $14,150 | $9,305.32 | $1,582 | $3,147 |
| Chartersville #28 | diamond | $21,275 | $20,525 | $12,995.32 | $2,989 | $5,067 |

All three dropped 2-3.5% — expected delta from removing waste-padded bundle
counts and applying corrected starter/ridge cap prices.

## Tech debt remaining

- `loading_pct` and `min_net_per_workday` columns from migration 022 are no
  longer read by the engine. Left in place rather than dropped — column drops
  are riskier than column ignores.
- Coastal Drywall remap covers bundles only. Other materials (underlayment,
  IWS, drip edge, valley, vents, flashings, nails, caulking, OSB) still at
  Kent. Need Mac to confirm vendor of record per category.
- 42 Patricia (#25), Kevin March (#21), Stephanie McCardle (#22) NOT regenned
  per the no-backfill rule on Published proposals. They'll keep their old
  `calculated_packages` until Mac decides to resend.
- Mountain Rd worked-example validation was at the multiplier × hardCost
  level only. A full end-to-end test (running a Performance Shell config
  through `calculateQuoteV3` and matching all 7 SOP line items) wasn't done.
  Worth a dedicated test if any drift surfaces.

---

# Session notes — 2026-04-27 (PRICING ENGINE PARITY + UPGRADES UI)

Three-part audit on the Ryujin pricing engine after multiplier revert. Engine
itself is at parity with v1 SOP; the gap was in the chat-tool field plumbing
and a missing UI affordance for "while we're already here" upsells.

## Part 1 — Engine accuracy spot-check

**42 Patricia (#25, Godbout)** — inputs from estimate row 523d150e:
3454 sqft / 8/12 / complex / eaves 200 / rakes 150 / ridges 130 / hips 10 /
valleys 110 / pipes 3 / vents 2 / distance 0. Live engine returns
**Platinum $31,100** (mult 1.52, hardCost $20,454.65, 34.2% gross). The
$42,550 figure cited in Apr 24 evening notes was at the temporarily-bumped
2.08 multiplier — that revert (commit prior to this session) put us back
at $31,100. Persisted `calculated_packages` in the proposal still shows the
older $27,750 (different scope_template at the time it was saved). Engine
math is internally consistent. **PASS.**

**95 Cornhill (#24, Boosamra)** — inputs from estimate row 6339794a:
3400 sqft / 7/12-9/12 / simple / eaves 220 / rakes 140 / ridges 50 /
hips 80 / valleys 35 / pipes 1 / vents 4 / distance 0. Engine Gold
$23,200 (mult 1.47, hardCost $15,786.64). Estimator OS comparator returned
Gold $19,336 (hardCost $12,890.11). Delta $3,864 retail. Root cause:
**Ryujin v3 applies the waste factor to material counts** — 132 shingle
bundles vs EOS 102 (34 SQ × 3 baseline). v3 also has higher material unit
costs after merchant DB lookup ($49 shingle vs older flat). This is a
deliberate design choice in v3 (more conservative material take), not a
bug. Cornhill paysheet $6,543.50 (Ryan's labor) doesn't pin retail price
— Mackenzie's actual sold-at price isn't in Ryujin (estimate has empty
calculated_packages). **PASS with note** that v3 is intentionally heavier
on materials than EOS.

## Part 2 — Field parity audit

Estimator OS schema reference: `~/.claude/projects/.../reference_estimator_os_schema.md`.
Engine itself supports almost all EOS fields. The gap was in how
`create_ryujin_proposal` (chat tool) passed inputs through. Closed in
commit 8435e6c.

**Now wired through `create_ryujin_proposal`:**
- chimney_size, chimney_cricket → engine.measurements.chimneySize/cricket
- cedar_tearoff (boolean) → engine.measurements.cedarTearoff
- redeck_sheets → engine.measurements.redeckSheets
- soffit_lf, fascia_lf, gutter_lf, leaf_guard
- wall_sqft, siding_choice → engine.choices.siding
- window_count, door_count
- custom_prices override (per-tier)
- pricing_model now derived from distance_km (was hard-coded 'Local')

**Still genuinely missing from engine (P0/P1):**

| Field | Status | Notes |
|---|---|---|
| Mixed-pitch parsing (e.g. "10-12/12" or sections array) | P1 | Engine takes single pitch only. 42 Patricia 8/12 main + 5/12 porches gets one rate applied globally (~2% overcount). |
| Sections array `[{sqft, pitch}]` | P1 | Same root cause as above. Real fix. |
| Performance Shell substrate auto-add | RESOLVED | offer `performance-shell-plus` exists with full wall stack scope. Engine respects scope_template. |
| Custom_prices override path | RESOLVED Apr 27 | Now passes through chat tool to estimate row + applied to shaped tier output. |
| Chimney cricket flag | RESOLVED Apr 27 | Was in engine; now passed through chat tool. |
| Cedar tearoff flag | RESOLVED Apr 27 | Same. |
| Mobilization "while we're here" tier | P1 | API supports POST ?mobilization=1 calc; not yet wired into the create-proposal flow. Manual call only. |
| Distance pricing model (Local / Day Trip / Extended) | RESOLVED Apr 27 | Derived from distance_km in chat tool. Engine already had distanceTiers. |
| Downspouts | RESOLVED Apr 27 | Added to engine — `downspoutCount` measurement, $75 each default, configurable in tenant_settings.labor_rates_exterior.downspout_each. |

## Part 3 — Upgrades section in Quote Builder UI

Shipped commit 63a4ce6. Visible in `/admin.html` → Quote Builder when
system is residential / metal / flat (and Exterior Scope isn't already
forced open). Six toggles:

- **Gutters — 5" Aluminum** (~$22/LF) — quality:'low' in tenant_settings
- **Gutters — 6" Oversized** (~$30/LF) — quality:'high'
- **Leaf Guard** ($6/LF, auto-pairs with gutter scope)
- **Downspouts** (~$75 each)
- **Soffit Replacement** (~$35/LF)
- **Fascia Replacement** (~$25/LF)

Each toggle injects an `extras` entry into the quote payload. Engine v3
now accepts `extras: [{key, label, category, config}]` which gets merged
into the offer's scope_template at runtime — de-duplicated against
existing keys, so we never double-count if the offer already includes
gutters. Same package multiplier applies, so Gold → Platinum → Diamond
stay consistent on the upsold scope.

5K and 6K gutters are mutually exclusive. Leaf guard auto-disables when
both gutter toggles are off. Mobile-friendly stacked layout. No DB
migration — purely runtime state.

Live URL: https://ryujin-os.vercel.app/admin.html (navigate to Quote
Builder → toggle a roofing system → scroll to "Upgrades & Add-Ons").

## Tech debt log (spotted, not touched)

- `proposals.calculated_packages` for #25 still shows pre-revert
  pricing (gold $23,150 / plat $27,750 / diamond $42,950). If
  Mackenzie wants the live share URL to reflect current SOP, regen
  via `scripts/regen-42-patricia.py` or a fresh /api/quote save.
- `step_flashing` line item shows in scope but skipped when wallsLF=0.
  Not a bug, but worth flagging in the UI since users wonder why it's
  not in the cost breakdown.
- "Tear-Off Labor" line shows $0 universally because tearoff is baked
  into base_labor's $130/$160/$190 rate. Phantom display row. Could
  be removed from scope_template or relabeled "(included in install
  labor)".
- `calculateMobilizationDiscount()` exists but no UI surface for it
  yet. Worth a tab next to Upgrades for phased upsell pricing.
- workorders table has `total_sq` but no `total_price` — production
  jobs don't carry retail. Fine for the production view but means
  Cornhill-style "what did we sell this for" auditing has to go
  through `estimates.calculated_packages`.

---

# Session notes — 2026-04-24 evening (PROPOSAL PIPELINE + MULTIPLIER CORRECTION)

Built the end-to-end "folder-to-proposal" workflow for Plus Ultra on Ryujin. Shipped Jonathan Godbout / 42 Patricia (#25). Fixed a systemic pricing problem: multipliers were under-set for post-loaded-cost net targets.

## What went live (chronological)

1. **42 Patricia proposal #25** — estimate `523d150e-6176-4725-91fa-d87b2df5a004`, share token `plus-ultra-25`. Platinum recommended at $42,550 (corrected). Darcy as rep.
2. **Gallery dedupe** in `api/proposal.js` — dropped `04-job-complete.jpg`, relabeled `02-topdown-architectural.jpg` → MONCTON · LAKESIDE to match the hero shot.
3. **Multiplier correction** via `scripts/apply-multiplier-fix.mjs`:
   - gold 1.47→1.89 (targets 12% net after 35% S+M+O)
   - platinum 1.52→2.08 (17% net)
   - diamond 1.58→2.38 (23% net)
   - economy deactivated (`active = false`)
4. **HST display** in `public/proposal-client.html` — removed hard-coded × 1.15. Tier cards now `$42,550 + HST`, accept section `$42,550` clean subtotal. Acceptance payload still records total-with-tax for internal contract value.
5. **New chat.js tool** `create_ryujin_proposal` — native Ryujin proposal generator with customer + measurements input, returns share URL. Executes immediately. Documented in BASE_PROMPT.
6. **Rode-along WIP deploy**: Mackenzie intro video wired, per-system video routing, ported Shenron chat.js brain, misc UI polish.

## The pricing discovery (important context)

Ryujin's quote engine V3 uses field name `netMargin` — but it's actually **gross margin**. It computes `(selling – hardCost) / selling`. No accounting for sales commission, marketing, or overhead.

Plus Ultra charges industry-standard 10% sales + 5% marketing + 20% overhead as a loaded cost layer (taught at Roofing Business School, charged regardless of actual spend to maintain pricing discipline).

Old multipliers (1.40 / 1.47 / 1.52 / 1.58) produced gross margins of 28-37%. Subtracting 35% loaded costs leaves –3% to +1.7% **real net**. Jonathan's Platinum at old $31,100 was –0.8% = $240 loss.

**Multiplier formula:** `m = 1 / (1 – (target_net + total_loaded_pct))`

For Mackenzie:
- target_net = {12%, 17%, 23%} for {Gold, Platinum, Diamond}
- total_loaded_pct = 35%
- → multipliers = {1.89, 2.08, 2.38}

All three tiers now land exactly on their target nets when compared against `(selling × (1 – grossMargin)) – loaded_costs`.

## Files changed this session

### Committed? No — all uncommitted at EOD on `main`.

- `api/chat.js` — added `create_ryujin_proposal` tool definition + executeTool handler + BASE_PROMPT line
- `api/proposal.js` — GALLERY array: dropped 04, relabeled 02 (this edit sits alongside the earlier intro-video WIP)
- `public/proposal-client.html` — removed `* 1.15` at lines 1358, 1420; changed `<small>incl. HST</small>` → `<small>+ HST</small>`; kept `* 1.15` at line 1523 (acceptance payload)
- `schema/migration_016_plus_ultra_multipliers.sql` — audit trail for the multiplier change (not run via migration script — applied directly via Supabase REST in `scripts/apply-multiplier-fix.mjs`)
- `scripts/ship-42-patricia.py` — end-to-end script: compare → estimate → photo uploads
- `scripts/fix-42-patricia-packages.py` — one-shot to reshape calculated_packages after post-create discovery of the `pkg.total` proposal.js expectation
- `scripts/regen-42-patricia.py` — recompute #25 pricing after multiplier correction
- `scripts/apply-multiplier-fix.mjs` — Supabase REST update for offers.multipliers + economy.active
- `package-lock.json` — `pg` added as dependency (run-migration.mjs needed it, eventually we used Supabase REST instead, but pg is installed)

## Reference IDs / URLs

- Plus Ultra tenant UUID: `84c91cb9-df07-4424-8938-075e9c50cb3b`
- Jonathan Godbout estimate: `523d150e-6176-4725-91fa-d87b2df5a004`
- Jonathan Godbout GHL contactId: `7k4msVngVyeUUIUbWa5r`
- Client share URL: https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-25
- Admin URL: https://ryujin-os.vercel.app/sales-proposal.html?id=523d150e-6176-4725-91fa-d87b2df5a004

## Known issues surfaced but not fixed

1. **"netMargin" field name is misleading** — it's gross, not net. Would be clearer if renamed `grossMargin` in the engine output. Breaking change for anything that reads it though. Defer.
2. **Single pitch input** for mixed-pitch roofs — 42 Patricia had 8/12 main + 5/12 porches. Engine applied 8/12 globally, over-counted porches by ~2%. Needs `sections: [{sqft, pitch}]` input shape eventually.
3. **Tear-off labor line shows $0** on all residential tiers — it's actually baked into Install Labor's $160/SQ pitched rate. Phantom display line. Could be removed from scope template or renamed.
4. **`sales_owner` DB column is UUID** — can't accept string name. Until a Darcy user row exists, attribution lives in `tags: ['sales_owner:darcy']`. Works but dual-source.
5. **`status: "sent"` fails** `estimates_status_check` constraint — valid values appear to be `draft | accepted | cancelled`. Need to figure out the "quote sent" state or add one.
6. **`offers.multipliers.dayTrip` and `.extendedStay`** still at old values (1.55-1.74 / 1.18-1.33). Only `local` was updated. Plus Ultra rarely does remote jobs, low priority.
7. **Economy's hard cost** was higher than Gold's in the compare output ($17,594 vs $17,511) — suggests its scope template has inefficient labor math. Irrelevant now that it's deactivated but worth noting if we ever reactivate it.

## Next session, if touching this area

- Commit + clean up uncommitted WIP (lot of it on `main`: api/chat.js, api/proposal.js, api/proposal-accept.js, api/estimate-photos.js, public/proposal-client.html, public/marketing-creatives.html, public/proposal-history.html, public/sales-client.html, public/assets/ryujin-chat.js, vercel.json, new api/chat.js/proposal-pdf.js/proposal-timeline.js, new lib/google.js, new public/content/)
- Reprice Kevin March (#21) + Stephanie McCardle (#22) against the new multipliers. They're still under-priced. Decision: leave-as-sent or resend? Mackenzie's call.
- Generalize `scripts/ship-42-patricia.py` into `scripts/ship-proposal.py "[folder-name]"` — takes any Jobs folder, parses the measurement docx with regex, cross-refs GHL by address, ships the proposal. Would close the loop for Claude Code sessions.
- Fix the `api/ghl.js:249` create-opportunity bug (`enrichOpportunity(data?.opportunity || data)`) so future proposals auto-land in Mack's Pipeline.
- Consider rename `netMargin` → `grossMargin` in engine output for clarity.

---

# Session notes — 2026-04-24 (morning/desktop — 95 Cornhill + crew materials)

(Full earlier block retained — see git history or prior version. Summary: crew-side materials engine hardening for Cornhill EagleView error, migration 015 for WO-level edge storage, paysheet rebuilt $3,481 → $6,658.50 when actual SQ confirmed at 34.)

---

# Session notes — 2026-04-20 (second pass + perf)

(Earlier block retained.)

---

# Session notes — 2026-04-19 (initial production system)

(Earlier block retained.)
