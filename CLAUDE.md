# Ryujin OS — Claude Code Instructions

## What This Is
Ryujin OS is a white-label business operating system for contractors. Multi-tenant SaaS on Vercel + Supabase. Plus Ultra Roofing is tenant #1.

**Company:** Ryujin Technologies Inc.
**Tagline:** Smart systems designed for you, by you.
**Theme:** Dragon aesthetic, Japanese storm/ocean motif.
**Live:** ryujin-os.vercel.app

## Architecture
- **Runtime:** Vercel serverless functions (Node.js, ESM)
- **Database:** Supabase (PostgreSQL + RLS)
- **Storage:** Vercel Blob (photos, documents)
- **AI:** Claude API (per-tenant configurable persona)
- **Schema:** `schema/migrations.sql` + `migration_002` through `migration_098` (applied by hand via the Supabase Management API; see schema note below)

## Multi-Tenant
Every table has `tenant_id`. Every API route uses `requireTenant()` middleware from `lib/tenant.js`. Tenant resolved from:
1. `x-tenant-id` header (API calls)
2. `?tenant=` query param
3. Custom domain lookup

## Database Schema (migration files through 098; latest APPLIED is 095)
Migration files in `schema/` run 001 through 098. **Latest applied to prod: 095** (`migration_095_estimate_number_unique.sql`). 096-098 were staged 2026-06-09 (096 payments audit, 097 service SLA, 098 review_request_sent) and are pending hand-apply via the Management API. Migration files are documentation of what gets applied by hand; keep them idempotent (IF NOT EXISTS guards).

Early foundations (full list is the `schema/` directory):
| Migration | Contents |
|---|---|
| 001 (base) | tenants, users, customers, estimates, tickets, inspections, time_entries, files |
| 002 | Phase 2 tables (projects, invites) |
| 003 | Roles & auth |
| 004 | Merchants, products, product_categories, merchant_products, regional_pricing, price_audit |
| 005 | Offers (scope templates), quote_line_items |
| 006 | Expanded catalog: housewrap, VentiGrid, EPS, siding variants, windows, siding accessories, contractor_referrals |
| 007 | tenant_settings (configurable labor rates, tax, multipliers, margins, mobilization, branding) |
| 008 | Offer restructure: commercial, flat, metal, combined offers. offer_category + has_estimated_pricing columns |
| 063 | purchase_orders table (Inventory pillar: PO tracking, JSONB line items, draft/sent/confirmed/partial/received/cancelled lifecycle) |

## Quote Engine v3.1 (`lib/quoteEngineV3.js`)

### Pricing Method
**Unified: Materials + Labor + Multiplier** (all systems). No divisor method.

### Three Modes
1. **Guided** — 5 questions per system type → auto-fills measurements + choices
2. **Advanced** — all line items open, fill/override at will
3. **Override** — post-generation, any line item manually adjustable

### Price Resolution Chain
`override → merchant DB → regional median → fallback default`

### Offer Categories
| Category | Offers | System |
|---|---|---|
| Residential | Economy, Gold, Platinum, Diamond | asphalt |
| Commercial | Economy, Standard, Premium | asphalt |
| Flat | TPO*, EPDM*, Mod Bit* | asphalt (flat) |
| Metal | Americana Ribbed, Standing Seam* | metal |
| Custom (Shell) | Performance Shell Plus, Hardie Shell, Metal Shell | exterior |
| Combined | Gold + Shell, Platinum + Shell | combined |

\* = estimated pricing (has_estimated_pricing = true)

### Key Features
- **Tenant-configurable** — all rates, margins, multipliers from `tenant_settings`
- **Scope templates** — JSON in offers table defines which line items are included
- **Product map** — configurable siding/housewrap choices resolve to different products
- **Decision points** — inspection items gate downstream scope
- **Wall assembly** — full stack: strip → inspect → OSB → housewrap → EPS → VentiGrid → siding
- **Window replacement** — per-size sub-items (small/medium/large)
- **Mobilization discount** — tiered "while we're already here" phased upsells
- **Leaf guard** — $6/LF (configurable in tenant_settings)
- **Estimated pricing flag** — marks line items using unverified regional prices
- **Line item persistence** — saves to `quote_line_items` table
- **Material list generator** — purchase-ready list with merchant sources

### Exports
- `calculateQuoteV3()` — single offer quote
- `calculateMultiOfferQuote()` — compare all offers
- `getGuidedQuestions(system)` — returns question flow for guided mode
- `processGuidedAnswers(answers, system)` — answers → measurements + choices
- `calculateMobilizationDiscount()` — phased upsell discount calc
- `persistLineItems()` — save line items to DB
- `generateMaterialList()` — extract material purchase list
- `resolvePrice()` — merchant → regional → fallback resolver

## Output Generators (`lib/outputGenerators.js`)

### Three Outputs
1. **Proposal** — bundled retail line items (no hard cost exposed), branding, warranty, financing
2. **Contract** — scope of work, price, payment schedule, warranty, terms, signature block
3. **Sales Page Data** — structured JSON for per-client visual proposal site (hero, comparison, scope, CTA)

### Sales Framing Rules (IMPORTANT)
- Customers NEVER see: hard cost, multipliers, margins, material vs labor splits
- Line items are bundled retail (materials + labor + margin baked together)
- Remediation framed as transparency: "unused portion credited back"
- "Surface vs structural" framing for scope upgrades
- Standard 7-line breakdown: Roofing, Siding, Substrate, Soffit, Fascia, Gutters, Remediation

## API Routes

### Quote Engine
| Method | Route | Description |
|---|---|---|
| GET | `/api/quote?offers=1` | List active offers for tenant |
| GET | `/api/quote?questions=1&system=X` | Get guided mode questions |
| POST | `/api/quote` | Calculate single offer quote |
| POST | `/api/quote?mode=compare` | Compare multiple offers |
| POST | `/api/quote?mode=guided` | Guided mode: answers → quote |
| POST | `/api/quote?mode=v2` | Legacy v2 engine |
| POST | `/api/quote?save=1` | Calculate + persist line items |
| POST | `/api/quote?materials=1` | Include material list in response |
| POST | `/api/quote?mobilization=1` | Calculate mobilization discount |

### Outputs
| Method | Route | Description |
|---|---|---|
| POST | `/api/outputs?type=proposal` | Generate client-facing proposal |
| POST | `/api/outputs?type=contract` | Generate contract |
| POST | `/api/outputs?type=sales_page` | Generate sales page data |
| POST | `/api/outputs?type=all` | Generate all three outputs |

### CRUD
| Route | Description |
|---|---|
| `/api/estimates` | Estimate CRUD |
| `/api/customers` | Customer CRUD |
| `/api/projects` | Project CRUD |
| `/api/tickets` | Ticket CRUD |
| `/api/inspections` | Inspection CRUD |
| `/api/files` | File upload/download |
| `/api/time` | Time entry CRUD |
| `/api/merchants` | Merchant CRUD |
| `/api/offers` | Offer CRUD |
| `/api/roles` | Role management |
| `/api/users` | User management |
| `/api/invites` | Team invites |

### Marketing Clips (migration 010)
| Method | Route | Description |
|---|---|---|
| GET | `/api/marketing` | List clips for tenant (optional `?status=`) |
| GET | `/api/marketing?id=X` | Fetch single clip |
| POST | `/api/marketing` | Multipart upload video → creates clip, kicks render |
| PUT | `/api/marketing` | Edit metadata / reschedule / adjust emphasis |
| DELETE | `/api/marketing?id=X` | Delete clip |
| POST | `/api/marketing-render?id=X` | Internal — triggered by upload, runs pipeline |
| POST | `/api/marketing-render?next=1` | Pulls oldest queued clip for tenant (cron-safe) |

**Pipeline** (`lib/marketingRenderer.js`): Whisper transcribe → Claude Haiku emphasis flag → ASS caption gen → ffmpeg 9:16 reframe + burn Hormozi-style subs → Vercel Blob upload.

**Brand color** pulled from `tenant_settings.accent_color`. **Font**: Montserrat (drop TTF in `lib/assets/fonts/`).

**Status lifecycle**: `queued → rendering → ready → scheduled → posted` (or `failed`).

Full contract: `docs/MARKETING_CLIPS_API.md`.

## Conventions
- All prices in CAD. HST 15% (NB default, configurable per tenant).
- 1 SQ = 100 sq ft. Labor on measured SQ. Materials on SQ + waste.
- Round selling prices to nearest $25 (configurable).
- Never expose tenant data cross-tenant. RLS enforced.
- `.trim()` all env var reads (Vercel newline bug).
- Run Supabase migrations directly via CLI — don't ask user to paste SQL.
- Plus Ultra is CertainTeed certified, NOT GAF.

## PR / Deploy Checklist

**Every change to this repo follows this loop. Skipping steps has burned us — see the auto-memory entries each rule references.**

### Before pushing a branch
1. **Branch from `main`.** Never commit directly to `main`. Branch protection is enforced.
2. **`node --check` every modified API handler.** Vercel does not syntax-check serverless functions; a broken handler ships clean and crashes on first request as `FUNCTION_INVOCATION_FAILED`. *(See `feedback_node_check_api_handlers`.)*
3. **For HTML pages with inline `<script>`:** extract and `node --check` the script block before pushing. Same reasoning.
4. **For any new agent slug:** widen the `agent_runs` CHECK constraint in a migration first — missing slug = silent no-op (no rows, no errors, empty portals). *(See `feedback_agent_slug_check_constraint`.)*
5. **For any new `sections.*` key written by an agent or in `api/state`:** add it to `api/snapshot.js` preserveKeys or the hourly snapshot rebuild silently wipes it. *(See `feedback_snapshot_preservekeys`.)*

### Before requesting review on the PR
6. **`codex review --base main`** (or `--uncommitted` pre-commit, `--commit <sha>` post-commit). **Non-negotiable.** Codex catches concrete bugs in the diff that I miss — including P1s I confidently shipped (May 17 2026: JSON PUT body parser, share-token expiry, GPS cache leak, all caught in two review rounds). Fix every P1 + P2 finding before merging. P3/style is judgment-call.
7. **Open in browser locally if it's a UI change.** Test the golden path + one edge case before opening the PR. Vercel preview deploys are not a substitute for local sanity-check.

### After merge
8. **`npx vercel --prod --yes` from the repo root.** Auto-deploy is broken since ~April 18 2026 — every push to `main` needs a manual prod deploy. *(See `feedback_vercel_manual_deploy_required`.)*
9. **Curl-smoke each touched endpoint against `ryujin-os.vercel.app`** (not just `vercel ls` status). Build success ≠ runtime success. *(See `feedback_post_deploy_curl_smoke_test`.)*
10. **No em dashes anywhere** — body, subjects, chat output, internal docs, code comments. AI tell. *(See `feedback_no_em_dashes`.)*

### Files that DO NOT live in this repo
- Secrets / `.env`: pulled by Vercel from its dashboard. Never commit.
- Customer-facing copy that uses Jewels' visual rules — those pages (`proposal-client.html`, `photos-share.html`) follow cream + royal-blue branding. Internal portals (`portal-mobile.html`, `command-center.html`, `admin.html`) follow the canonical sci-fi Telltale token layer (`assets/ryujin-telltale.css`) as of 2026-06-14: Telltale replaces the prior Grok teal-mint internal standard (Mac decision; migration in progress per `_brain/hub/P6_TOKEN_MIGRATION_PATTERN_2026-06-14.md`). Mixing internal and customer-facing styles is an instant tell. *(See `feedback_jewels_visual_rules` + `feedback_grok_mockup_internal_portals`.)*
