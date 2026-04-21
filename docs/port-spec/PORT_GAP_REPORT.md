# EOS → Ryujin Port Gap Report

**Generated:** 2026-04-20
**Method:** Static analysis of Ryujin source vs EOS API behavior (observed today) + comparison to spec docs.
**Limitation:** Without EOS source, deeper bugs may exist. This is only what surface-level probing reveals.

---

## Executive Summary

- **V1 (`quoteEngine.js`) is close to spec-compliant for asphalt** but has a systematic margin-floor bug that underprices Gold and Platinum by 3-5%.
- **V3 (`quoteEngineV3.js`) has an architectural divergence from the pricing SOP**: it uses the multiplier method for metal roofing, where the SOP mandates the divisor method. Confirmed via CLAUDE.md line: "Unified: Materials + Labor + Multiplier (all systems). No divisor method."
- **Ryujin is missing 4 EOS endpoints** the Shenron Proposal Generator Workflow depends on.
- **V1 and V3 are not duplicates** — V1 is a pure math function (spec-equivalent). V3 is a DB-backed platform with guided UX and tenant pricing. Both probably need to exist; the question is how they compose.

---

## Finding #1 — V1 Margin Floor Bug (Gold/Platinum underpriced)

**Ran Amy's real estimate (#72) through `calculateAsphaltQuote`** with identical inputs (2,140 sf top-down, 5/12, simple, 125/110/65 LF). Compared output to EOS's actual response.

| Package | V1 sell | EOS sell | Delta | Root cause |
|---|---|---|---|---|
| Gold | $13,725 | $14,280 | **−$555 (−3.9%)** | V1 margin floor check uses gross margin. EOS uses *true net* (after sales/marketing/overhead allocations). V1 under-triggers floor protection. |
| Platinum | $16,325 | $16,682 | −$357 (−2.1%) | Same root cause |
| Diamond | $26,225 | $26,219 | +$6 | Match (margin is high enough that floor doesn't trigger either way) |

**EOS Gold response confirmed floor is applied:**
```
"grossMargin": 0.3334,
"trueNetMargin": 0.1001,
"floorApplied": true
```

**Fix location:** `lib/quoteEngine.js:386-391`. The floor check computes `actualMargin = (sellingPrice - hardCost) / sellingPrice` but should be:
```
trueNet = (sellingPrice - hardCost - overheadAlloc - marketingAlloc - salesAlloc) / sellingPrice
```
Allocations from spec: overhead 20%, marketing 5%, sales 10% of sell price.

**Blast radius:** Every Gold and Platinum quote since Ryujin went live has been ~3-5% underpriced. Diamond is safe.

---

## Finding #2 — V3 Metal Uses Multipliers (Spec Violation)

Per `official_pricing_logic.md` and `project_pricing_v2_corrections.md` memory:

> Metal roofing must NEVER use the asphalt multipliers. Per Metal_Roofing_Pricing_Logic_SOP.pdf, metal jobs use the Additive Cost Stack method with divisors: Standard 0.53, Enhanced 0.50, Premium 0.48. Sell Price = Direct Cost ÷ Divisor. Applying asphalt multipliers to a metal job under-quotes Standard by ~$10K, Enhanced by ~$22K, Premium by ~$43K. **Catastrophic margin loss.**

Ryujin CLAUDE.md explicitly states V3 "unified" its approach:
> **Pricing Method: Unified: Materials + Labor + Multiplier (all systems). No divisor method.**

V1 correctly uses `METAL_DIVISORS = { standard: 0.53, enhanced: 0.50, premium: 0.48 }` in `calculateMetalQuote()`. V3 does not.

**Status:** Not yet measured (no metal estimates in Ryujin V3 live data). But the architecture is wrong per spec. Needs to be corrected before V3 goes to production on any metal job.

**Decision needed:** Either (a) revert V3's metal to divisor method, or (b) get written spec change from Mackenzie accepting multiplier method for metal + document the margin impact.

---

## Finding #3 — Missing EOS Endpoints in Ryujin

The Shenron Proposal Generator Workflow (SOP in SALES.md) depends on these EOS endpoints. Ryujin analogs:

| EOS endpoint | Purpose | Ryujin equivalent | Status |
|---|---|---|---|
| `POST /api/estimates/{id}/publish` | Sets publishedAt, returns shareToken | `api/estimates.js:132` generates share_token on save | ⚠ Different shape. No publish "event" — always available. |
| `POST /api/estimates/{id}/photos` (multipart, field `photo`) | Upload estimate photo | `POST /api/estimate-photos` (multipart, field `file`, pass `estimate_id` in form) | ⚠ Different route + field name |
| `PUT /api/estimates/{id}/photos/{pid}/set-cover` | Mark photo as cover | `POST /api/estimate-photos` with `is_cover=true` at upload time | ⚠ Ryujin handles at upload, no separate toggle endpoint |
| `PUT /api/estimates/{id}/status` `{jobStatus}` | Update jobStatus | Missing — `api/estimates.js` PUT doesn't have a `/status` sub-route | ❌ Missing |
| `GET /api/estimates/{id}/proposal` | Return proposal JSON for rendering | Missing — `api/proposal.js` only accepts `?share=<token>` | ❌ Missing (id-based lookup) |
| `GET /api/settings/team` | List team members | Missing | ❌ Missing |
| `PUT /api/settings/team/{id}` | Update team profile (name, phone, bio, photo) | Missing | ❌ Missing |
| `GET /p/:token` | Customer-facing SPA proposal route | Unknown — need to check Ryujin `public/` + client SPA routing | ❓ |

**Priority to add for parity:**
1. `GET /api/estimates/{id}/proposal` — Shenron's sales page CTA needs an id-based proposal URL to link to.
2. `GET /api/settings/team` + `PUT /api/settings/team/{id}` — drives the estimator profile on customer-facing proposals.
3. `PUT /api/estimates/{id}/status` — keeps `proposalsSent` counter (and pipeline) accurate.

---

## Finding #4 — V1 vs V3 Coexistence (not a bug, but unclear)

`api/quote.js` uses BOTH engines depending on query string:
- `POST /api/quote` with a spec → V1's `calculateAsphaltQuote` / `calculateMetalQuote` / `calculateExteriorQuote`
- `POST /api/quote?mode=compare` or `?mode=guided` → V3's `calculateMultiOfferQuote`
- `POST /api/quote?mode=v2` → explicit V1

So V3 is NOT dead code — it powers `compare` and `guided` modes. The mental model "swap V1 for V3" was wrong. The correct model: V1 = stateless math, V3 = DB-backed platform. They do different things.

**Question to resolve:** Should V1's math be canonical and V3 reuse it, or should V3 be the source of truth and V1 deprecated? Right now they're two independent implementations that will drift over time.

**Recommendation:** Extract pure math into a shared `lib/pricingFormula.js` used by both engines. V3 keeps its DB/guided/tenant wrapper, V1 keeps its CRUD wrapper, both call the same core.

---

## Finding #5 — Output Side Looks Fine

Ryujin has `api/outputs.js` with proposal / contract / sales_page generators — matches EOS's split between operator-facing and client-facing outputs. `lib/outputGenerators.js` enforces sales framing rules (no hard cost exposed, bundled retail, remediation transparency). No divergence from spec detected. Deserves a real spot-check though.

---

## What to do next (proposed order)

1. **Get EOS source locally** (pending from Mackenzie — see README.md "How to pull it")
2. **Fix V1 margin floor logic** (30 min, measurable impact — every Gold/Platinum goes up 3-5%)
3. **Decide on V3 metal method** (divisor vs multiplier) and implement the decision
4. **Add missing EOS endpoints** (publish-by-event, /status, /proposal by id, settings/team) — port-parity for Shenron workflow
5. **Extract shared pricing formula module** so V1 and V3 can't drift
6. **Run the remaining 4 reference estimates** through both engines, diff outputs

All 6 should happen BEFORE more Ryujin UI work. The UI is rendering from a pricing brain that underprices Gold/Platinum by 3-5% — prettier UI over wrong numbers doesn't help.
