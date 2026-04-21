# EOS → Ryujin Port Spec

**Purpose:** Single source of truth for porting Plus Ultra Estimator OS (Replit) into Ryujin OS. No Claude session should edit `lib/quoteEngineV3.js` or `api/quote.js` without first reading these specs.

**Status:** ⚠ Port incomplete. `api/quote.js` currently imports the old `lib/quoteEngine.js` (604 lines), not `lib/quoteEngineV3.js` (1,409 lines). V3 has tenant_settings, regional pricing, and offer categories but is not wired to production.

---

## Why this folder exists

Until April 20, 2026 every Ryujin session has been reverse-engineering EOS via API probes on `estimator-os.replit.app`. That's why we keep hitting surprises (silent field drops, wrong endpoints, missing counters). These 7 docs ARE the original build spec that produced EOS on Replit — they were .docx files buried in `Plus Ultra/Documents/General/Estimator OS App/` and had never been loaded into any Ryujin context.

**Rule going forward:** Any Ryujin change that touches estimating, pricing, or proposal generation must cite the relevant port-spec doc in the PR/commit.

---

## The 7 spec docs

| File | What's in it | When to read |
|---|---|---|
| `master_prompt_for_replit__estimator_os.md` | The original Replit build prompt — UX flow, step order, operator-first positioning, visual style | Before changing UX or step order |
| `phase_2_master_prompt_for_replit.md` | Phase 2 expansions — exterior, siding, Performance Shell | Before touching exterior/shell logic |
| `phase_3_master_prompt_for_replit.md` | Phase 3 — advanced pricing, multi-tenant, offer categories | Before touching V3 engine |
| `official_pricing_logic.md` | Canonical pricing formula: Hard Cost × Multiplier, 35% operational allocation, package definitions | Every pricing change |
| `estimating__pricing_matrix.md` | Labor rates, pitch multipliers, adders, waste factors | Cross-reference with `knowledge/PRICING.md` |
| `proposal_generator_workflow.md` | How the proposal system should behave (internal report first, client proposal second) | Before touching proposal output |
| `brand_book.md` | Visual identity — logo, colors, type | UI work |

---

## Port scorecard (updated Apr 20 from static analysis + Amy #72 test)

See `PORT_GAP_REPORT.md` for detail on each gap.

| Feature | In EOS? | In Ryujin V1 | In Ryujin V3 | In Ryujin live | Matches EOS? |
|---|---|---|---|---|---|
| Hard Cost × Multiplier formula | ✅ | ✅ | ✅ | ✅ | ✅ |
| Multipliers (1.47/1.52/1.58 local) | ✅ | ✅ | ✅ | ✅ | ✅ match |
| Margin floor using true net (not gross) | ✅ | ❌ uses gross | ? | ❌ | ❌ **Gold/Plat underpriced 3-5%** |
| Gold/Platinum/Diamond residential | ✅ | ✅ | ✅ | ✅ | partial (floor bug) |
| Economy offer | ✅ | ✅ | ✅ | ✅ | ❓ |
| Commercial offers (Economy/Standard/Premium) | ? | ❌ | ✅ | ? | ❓ |
| Metal — divisor method (0.53/0.50/0.48) | ✅ | ✅ | ❌ multiplier | ? | ❌ **V3 spec violation** |
| Performance Shell / Hardie / Metal Shell | ✅ | ✅ partial | ✅ | ? | ❓ |
| Regional pricing from merchant DB | ❌ | ❌ | ✅ | ✅ | N/A |
| tenant_settings override chain | ❌ | ❌ | ✅ | ✅ | N/A |
| Guided / Advanced / Override modes | partial | ❌ | ✅ | ✅ | ❓ |
| Internal report + client proposal split | ✅ | N/A | N/A | ✅ via `api/outputs` | ❓ |
| `/api/estimates/:id/status` (PUT) | ✅ | N/A | N/A | ❌ | ❌ missing |
| Photos: multipart upload | ✅ field `photo` | N/A | N/A | ✅ field `file` | ⚠ different shape |
| Set-cover mechanism | ✅ PUT `/set-cover` | N/A | N/A | ✅ `is_cover=true` at upload | ⚠ different shape |
| Publish → shareToken event | ✅ | N/A | N/A | ⚠ token auto-set on save | ⚠ different model |
| `/api/estimates/:id/proposal` (GET JSON by id) | ✅ | N/A | N/A | ❌ only by `?share=` | ❌ missing |
| `/api/settings/team` + team profiles | ✅ | N/A | N/A | ❌ | ❌ missing |
| `/p/:token` customer proposal SPA | ✅ | N/A | N/A | ❓ | ❓ |

**Legend:** ✅ implemented correctly · ❌ missing or wrong · ⚠ present but different shape · ❓ not yet verified · N/A not applicable at that layer

---

## What's still missing — action required from Mackenzie

**EOS source code.** These 7 specs describe *intent*. The actual implementation lives only on Replit. To finish the port we need a local clone.

### How to pull it (you need to do this — I can't auth to Replit)

Option A — **Git clone** (cleanest):
1. Go to https://replit.com/@plusultraroofing/estimator-os (or wherever your Repl lives)
2. Click the three-dot menu → "Show Git Commands" or open the Git pane
3. Copy the clone command — it'll look like `git clone https://<token>@replit.com/...`
4. Clone into `Desktop/Ryujin/eos-source/` (I created nothing there yet — leave it for you)

Option B — **Zip export** (fast fallback):
1. On the Replit dashboard, open the project
2. Three-dot menu → "Download as zip"
3. Extract to `Desktop/Ryujin/eos-source/`

Once it's local, I can diff EOS's quote engine line-by-line against Ryujin V3, produce a port-gap report, and fill in the scorecard above.

---

## Recommended port sequence (do NOT rush)

1. ✅ Convert .docx specs to markdown — **done Apr 20**
2. ⬜ Pull EOS source locally (you)
3. ⬜ Fill in the port scorecard above by diffing EOS vs V3
4. ⬜ Pick 5 reference estimates (including Amy #72). Run inputs through EOS `/api/estimates/:id/proposal`, run same inputs through Ryujin V3. Diff outputs. Note every divergence.
5. ⬜ Fix V3 divergences, one at a time, citing which spec doc justifies each fix
6. ⬜ Wire `api/quote.js` to import V3. Delete old `quoteEngine.js`
7. ⬜ Smoke-test 5 reference estimates end-to-end on Ryujin
8. ⬜ Only then resume Ryujin UI work

Any shortcut across step order reintroduces the "half-ported, janky, reverse-engineering every session" problem we just diagnosed.
