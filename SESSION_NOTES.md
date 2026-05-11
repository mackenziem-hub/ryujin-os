# Session notes — 2026-05-11 (evening, Session 67) — pillar restore + messaging overhaul + Action Board → native migration + Option B sub-crew + six-pillar planning + Administration redesign

**19 commits between mid-afternoon and ~10 PM AT.** Major surfaces: Ryujin's pillar nav, the entire Messages stack, the Administration page, sub-portal crew sub-tokens, chat-driven task creation, Crew Ops kanban (now backed by migrated tickets instead of an external Replit app).

## Commits

1. `2f809ea` — restore rich Sales/Marketing/Production pillar pages from git; park flat-template versions; remove mobile UA gate
2. `6bd3aec` — cutscene click-to-skip v1 (onclick on cutscene div)
3. `0669694` — Messages icon in admin.html sidebar
4. `8b94ed1` — cutscene pointer-events:none on videos + Messages in bottom bar + sidebar nav scroll
5. `9f62022` — admin-overview Messages icon + quick-access cards row
6. `f79b032` — admin.html Settings page renamed Administration + Messages/Portals/Dispatch cards at top
7. `ab0316e` — administration.html (SubHub panels page) — MESSAGES + TEAM PORTALS panels + chat brain choices
8. `de2c972` — cutscene bulletproof (document-level capture-phase click/touchend/keydown)
9. (DB patch) orphan "Scaffolding" message claimed back to Mac → AJ
10. `1ec0994` — messages auth gate on POST + visible session banner + handleAuthResponse helper
11. `e015f9b` — login.html ?next= fix + back button + account dropdown on messages.html + Reset session
12. `381272c` — login.html ?force=1 escape hatch (clears stale auth + skips auto-redirect)
13. `cdcf913` — thread chronological order fix (defensive client sort + per-branch API order calls)
14. `5365d70` — /api/messages ?box=all + "All" tab + assets/messages-badge.js poller + Mac SMS via GHL
15. `85f5cab` — unified Twilio direct SMS for all users with ryujin_phone_number (lib/sms.js + helper)
16. `58706bf` — admin-activity.html + api/activity.js (filterable audit log, CSV export, pagination)
17. `7ed75e3` — sub-portal crew sub-tokens (Option B): migration 058, dual-token verify, crew CRUD, audit fields, My Crew UI
18. `df19c69` — task audit quick wins: assignee dropdown, dead ternary removed, no-token copy
19. `3f6eb3f` — Action Board → Ryujin native migration: 33 tickets imported (idempotent), snapshot.js reads native, create_ticket direct-inserts

## New files
- `public/admin-activity.html`
- `public/sales-panel.html` `public/marketing-panel.html` `public/production-panel.html` (parked)
- `public/assets/messages-badge.js`
- `api/activity.js`
- `lib/sms.js`
- `schema/migration_058_sub_crew_members.sql` (applied)

## Restored from git
- `public/sales.html` ← 6abb280  ·  `public/marketing.html` ← 82d0729  ·  `public/production.html` ← 6abb280

## Migration applied
- **058** sub_crew_members + job_log_entries audit cols

## Production data writes
- DB patch: messages row `e016ce45...` ("Scaffolding") — from_user_id null → Mac
- 33 Action Board tickets imported into tickets table (each tagged `ab:<id>`)

## Open carry-forward

- Mac to authorize "send it" on the Ryan My Crew announce reply (`scripts/_oneshot/_reply_ryan_crew_announce_2026-05-11.mjs`)
- Surface native ticket overdues in morning briefing (`api/agents/briefing.js` is GHL-only)
- Ryan's ryujin_phone_number not assigned → no SMS notifications yet
- service_tickets table consolidation — fold into `tickets` with `type=repair` or wire to AJ portal section
- Action Board (Replit) banner/redirect to /admin.html#crew

## Marker
SESSION_CONTEXT.md at `OneDrive/Desktop/Plus Ultra/_brain/SESSION_CONTEXT.md`. Six-pillar plan at `~/.claude/plans/all-right-well-i-fluttering-parrot.md` (Session 1 LOCKED).

---

# Session notes — 2026-05-11 (mid-morning → midday) — 3 live customer wires + sub-portal photo bug fixed + Diamond bundle count fixed + Portal Inspector + proposal-page additions (breakdown + color chart)

## What changed this session

### Code (Ryujin)
- **NEW `/api/proposal.js` rep resolver hardened** — accepts mac/mack/mackenzie/mazerolle aliases (was only matching `mack` substring, so 3-letter `mac` slug fell through to Darcy default — Bissett #54 was rendering Darcy in customer-facing proposal despite DB column + GHL being Mac).
- **NEW `public/admin-portals.html`** — Portal Inspector admin page. Tabs across 15 portal surfaces (sub portal, paysheet, customer proposal, breakdown PDF, AJ/Mac/Darcy/Catherine/Diego/Pavanjot/Melodie/Ryan portals, mobile, approvals, routes). Auto-populates token pickers from `subcontractors.portal_token` / `estimates.share_token` / `paysheets.acceptance_token`. Width buttons (375/430/768/1200/full). Iframe with reload + open-in-new-tab. Sidebar entry added on admin-overview between Cron Health and System Config.
- **`public/proposal-client.html` — Detailed Breakdown dropdown** — collapsible card below scope list. Lazy-loads `/api/breakdown-pdf?format=html` inline via iframe on first open. Action links: open-in-new-tab + download PDF. Telemetry `breakdown_opened`. Renders on every proposal automatically.
- **`public/proposal-client.html` — Color Chart dropdown** — single chart image (Mac's `Color Chart.jpg`, Landmark Pro Max Def 14 colors). Capped at native 618px to prevent upscaling blur. Click image to open full-size in new tab.
- **`public/brand/plus-ultra/colors/color-chart.jpg`** — Mac's chosen color chart asset.

### DB / Schema fixes
- **`job_log_entries.entry_type` CHECK constraint** — added `'photo'` to allowed list (was missing). Ryan's rapid-camera upload flow on WO#15 was failing silently with cryptic "string did not match the expected pattern" message. Fixed via Supabase Management API. Memory `project_subportal_photo_constraint_fix_may11.md` written.
- **Diamond offer `scope_template.shingles.config`** — added `bundles_per_sq: 4, tier: 'grand_manor'`. Engine was defaulting to 3 bundles/SQ for all tiers — Grand Manor needs 4/SQ due to 5-layer Super Shangle construction. All future Diamond quotes bundle correctly. Locked Diamond quotes (Royal Oaks #46-48,#51) untouched per no-backfill rule. Memory `project_diamond_bundle_count_fix_may11.md` written.

### Customer wires (3 deals)
- **plus-ultra-54 Bissett (Racho)** — full lifecycle: estimate creation, 4 pricing iterations (engine → Echo $8,500 match → standard ladder → -15% strategic-partner strip), photos attached, Mac sales_owner, GHL Internal pipeline opp `OFPyhvnfuShPDLNtpJhh` at $11,155 Platinum, customer V2cfn6FfVOxJuRn9vKJr
- **plus-ultra-52 El Rody (Raghda Elleithy)** — cover + after photos attached, Mac sales_owner, GHL opp `Z96Qm71RpORdRav7Zluy` reassigned, email sent
- **plus-ultra-58 Irving (Jonald Magarin)** — back-filled from paysheet PU-2026-018 (was mis-linked to Lee Baxter #41). $14,286 Gold/Platinum-spec free upgrade. GHL Internal → Closed `O8XwKoJMKDIuvNjav2s2`. Customer corrected mid-flow Christian → Jonald. Color chart email sent. Christian remains as `referral:christian-kw` tag.

### Commits pushed
9+ commits on origin/main today including:
- Portal Inspector + sidebar nav
- Detailed Breakdown dropdown
- Color Chart dropdown (initial swatch version + 2 iterations + final single-chart simplification)
- Color chart upscaling blur fix (max-width:618px native cap)
- Proposal rep resolver mac-alias fix

### Open / pending
- 🟡 Bissett proposal forward to Christian/Racho (Mac's call when ready)
- 🟡 Jonald color pick → then materials order
- 🟡 El Rody customer response
- 🟡 Stale Gmail draft `r-5190770291926967459` (addressed to Christian about Jonald's job before customer correction) — Mac to delete manually
- 🟡 Simple-mode proposal toggle queued at `_brain/queued-actions/2026-05-12-am-fire-bissett-quote.md` (parts obsolete since inline dropdowns satisfy most of the use case)
- 🟡 Commercial flat roof triage — workflow sketched; awaiting Mac's per-roof rundown
- 🟡 W-style valley pricing — discussed; not productized as SKU; ~$55/piece market estimate for future addition
- 🟢 Sub-portal rapid camera LIVE
- 🟢 Diamond bundle count fix LIVE
- 🟢 Portal Inspector LIVE at /admin-portals.html
- 🟢 Proposal page breakdown + color dropdowns LIVE
- 🟢 Bissett/El Rody/Irving wired with Mac as rep, photos attached

---

# Session notes — 2026-05-09 (Session 66, late evening) — Sub Portal v2 lockdown + 3-job dispatch (Fairisle, Irving, Saint Marie)

## What changed this session

### Code (Ryujin)
- `api/sub-portal.js` — `maskCustomer()` helper (composite-name handling), URL whitelist on documents (Vercel Blob + Ryujin only), supplier routing rules (Coastal default · QXO for SBS+skylights · Home Depot for OSB · Kent never displayed), full COGS strip from materials API (no `total_estimated`/`supplier_summary`/`unit_cost`/`total_cost`), `package_tier` removed from all responses, `customer_name` masked, `customer_phone` removed entirely, new `approve_wo` POST endpoint with token+ownership+status guards + audit log + SMS to Mac via Automator.
- `api/sub-auth.js` — curated SELECT columns on `?action=jobs` (was `SELECT *`), masking applied to customer_name on jobs list.
- `public/sub-portal.html` — deliverables refactored 8 items → 4 (collapsible default-closed), pay section all-lines (was hardcoded `.slice(0,4)` truncate), Pending Approval amber-banner section + green Approve & Schedule button + Text Mac SMS fallback, Documents section with EagleView attachment cards, Special Notes render as clean bullets via `renderSpecialNotes()`, "Your pay $X" label on job cards, favicon linked to `/assets/branding/orb.jpg`, status pill labels humanized (`draft` → "Pending Approval", `issued` → "Active").

### DB (Supabase via service-role)
- WO #11 (95 Cornhill) — status `issued` → `complete`
- WO #15 (Saint Marie) — special_notes tightened to 5 bullets, paysheet labour_breakdown +travel-fix line ($244.62 per-km v2.2)
- WO #16 (67 Fairisle) — sub_id assigned to Ryan, customer_name="Kyle Graham", scope_items populated, special_notes 5 bullets, color="Resawn Shake", layers_to_remove=1, total_sq=20.22, paysheet labour_breakdown corrected (24.2→19.08 SQ, valley 14→53 LF, +mod-bit line)
- WO #17 (265 Boul Irving) — sub_id assigned to Ryan, customer_name="Christian" (scrubbed parenthetical), scope_items populated, special_notes 4 bullets, total_sq=26.5, layers_to_remove=1
- estimates Fairisle calculated_packages — bundle counts 78→63 across all tiers + mod-bit material lines added (Sopralene 180 base, Soprastick HD cap, Primer, Termination bar)
- estimates Irving calculated_packages — bundle counts 90→82 across all tiers
- estimates {Fairisle, Irving, Saint Marie} — commission tags added (`sales_owner:* + commission_rate:* + commission_reason:*`)

### Vercel Blob
- `eagleview/wo-16-67-fairisle.pdf` (823 KB)
- `eagleview/wo-16-67-fairisle.json` (12 KB)
- `eagleview/wo-17-265-irving.json` (12 KB)
- Tagged in workorders.additional_scope as `DOCUMENTS_JSON: [...]` text-shim (no schema change)

### GHL
- Note `oyQskB8oiFhbo3T4eR19` posted on contact `JZPkWIEYZVjolTOrwG0H` (Shelagh Peach) documenting +$1,600 HST-incl redeck CO

## Money bugs caught + fixed

1. **Saint Marie travel surcharge** — stepped $20/SQ ($604) → per-km v2.2 ($244.62). Saved $359 + HST.
2. **Fairisle base labour** — pre-EV stale 24.2 SQ → EV-true 19.08 SQ. Saved $665 vs over-pay.
3. **Fairisle valley** — stale 14 LF → EV-true 53 LF (+$39 to Ryan).
4. **Bundle counts** — Fairisle 78→63, Irving 90→82 across all tiers (engine waste defaults too aggressive for simple-facet roofs).
5. **Fairisle low-slope strip** — 113 sqft @ 1/12 not in original quote. Added 2-ply Soprema SBS scope (mat $506 + labour $313.50). Mac absorbing.

## Audits

| Audit | Cost | Verdict | Real findings |
|---|---|---|---|
| Claude pricing-lens peer review | $0.02 | needs_changes → resolved | Saint Marie travel + Fairisle 24.2 SQ + commission tags |
| Manus product audit Round 1 | ~$1 | minor-polish | "Your pay" label + favicon |
| Manus product audit Round 2 | ~$1 | NO BLOCKERS | none |

Manus URLs: R1 https://manus.im/app/ZfFDfjYDqbpvh3LCnxUeuY · R2 https://manus.im/app/Ug3KNXVYpEsqX2EkZqfRUU

## Three jobs ready for Ryan dispatch

| WO | Customer (masked) | Status | Paysheet | Mac pocket |
|---|---|---|---|---|
| #16 — 67 Fairisle | Kyle G. | Pending Approval | $3,506.23 | $2,630 |
| #17 — 265 Boul Irving | Christian | Pending Approval | $4,943.85 | $4,182 |
| #15 — 5360 NB-495 | Shelagh P. | Active (chimney Mon) | $6,842.06 | $2,411 |

Combined Mac pocket: **$9,223** (rev − materials − Ryan paysheet − sales commission). All clear $700/day floor.

## Ryan's portal

`https://ryujin-os.vercel.app/sub-portal.html?token=fA305quBxYxWhYoOo-2h0J47e3cigGMO` (180-day token, expires Nov 5 2026, sub `7a03d15e-5d3b-4b6b-876b-59e1ba2c0a86`)

## Open items

- 🟢 Ryan to review + approve Fairisle + Irving via portal
- 🟢 Saint Marie chimney finish Mon May 11
- 🟡 EagleView JSON viewer polish (currently raw JSON in new tab)
- 🟡 Mobile sticky footer can obscure bottom content on long pages
- 🟡 Engine bundle-count drift — calculated_packages waste defaults too aggressive
- 🟡 Cowork session generating Grok assets per region (Mac monitoring remotely)

---

# Session notes — 2026-05-09 (Session 65, evening) — Bible v0.1+v0.2 implementation + state machines + claims + agent-briefing + finance-verify + Stripe scaffold + asset handoff + Kataria metal merge

## Commits pushed this session (in order)

1. `7dced6f` ship: cumulative Apr 28 → May 9 sessions (244 files of work that had been deployed via vercel CLI but never reached git)
2. `61f9e38` Bible v0.1 + claims library scaffold
3. `03a1d6a` state machines + claim guard + endpoint hardening
4. `e63a52f` migrations 036-039 applied to prod (script + audit log)
5. `1c12715` agent-briefing + /api/claims + claim-resolver + lint cleanup
6. `c2153bb` Manus peer review fixes — state machines + briefing + finance-verify + Stripe scaffold (migration 040 applied)
7. `a96af61` Grok asset handoff — directory scaffold + 8 integrations wired with fallbacks

Backup tag: `backup/desktop-pre-resync-2026-05-09 → 3fad7c7`

## What's new in prod (after final deploy from `a96af61`)

**Schema (migrations 036-040 all applied via Supabase Management API):**
- `claims` + `claims_audit` tables, status enum (active/soft/disabled), audit trigger
- `paysheets` extended: `state` (8 states + `cancelled`), `version`, `superseded_token_at`, `completed_at`, `payable_at`, `paid_at` + `paysheet_state_log` audit + transition trigger
- `estimates` extended: `state` (12 states + `proposal_expired`), 18 new columns covering approval timing, contract status, deposit/finance status enums + amounts + timestamps, schedule_due_by, GHL drift visibility (`last_synced_at`, `ghl_sync_status`, `ghl_sync_error`) + `estimate_state_log` audit
- `change_orders` + `change_order_log` — central CO ledger per Bible §5.3 (customer + sub sides separate, accept tokens both, margin_impact, full status lifecycle)

**lib/state.js — single source of truth:**
- `PAYSHEET_TRANSITIONS`, `ESTIMATE_TRANSITIONS`, `CHANGE_ORDER_TRANSITIONS` tables
- API: `canTransition`, `nextStates`, `assertTransition`, `isTerminal`
- Helpers: `paysheetEditRequiresReAccept`, `paysheetTransitionRequiresTokenAction`, `changeOrderCanApprove` (Manus §1.3 enforcement — pending_both is a computed result, not a button), `estimateCanResumeFromChangeOrder`, `computeRateHoldExpiry` (30d), `computeRepCallDue` (24h), `computeScheduleDue` (3 biz days, weekend-aware), `computeDepositAmountCents` (33%)
- `closed_won` semantics documented as "commercially secured/sold" NOT "completed"

**lib/claims.js + 9 Plus Ultra claims seeded:**
- 7 active: certainteed_select_shinglemaster, workmanship_warranty_tiered, leak_free_year_one, companycam_photo_documentation, verified_google_reviews, locally_owned, licensed_and_operating_nb (interim substitute for GL/WCB)
- 2 soft: gl_2m_liability + wcb_coverage with `retracted_reason` set
- `getActiveClaims`, `getActiveClaim`, `renderClaimsBlock`. Returns only render-safe fields — internal notes never leak.
- Verified: `getActiveClaim('gl_2m_liability')` returns null (soft hidden from render path)

**lib/auth-server.js — `requireOwnerOrAdmin`** Bearer-token resolver, builds on existing `api/auth.js` sessions table. Used by finance-verify + deposit-checkout.

**Endpoints (all live in prod):**
- `GET /api/agent-briefing` — 14 block types end-to-end. Severity-sorted. Currently p0=2 (soft_claims_present + contract_missing_gl_wcb_claim).
- `GET /api/claims` — public, only active claims, soft hidden server-side
- `POST /api/finance-verify` (owner auth + Tier 3 typed-name) — FULL implementation. financing_pending → schedule_pending with full audit log.
- `POST /api/deposit-checkout` (owner auth) — SCAFFOLDED. 503 STRIPE_NOT_CONFIGURED until Mac adds STRIPE_SECRET_KEY.
- `POST /api/stripe-webhook` (signature verification) — SCAFFOLDED. Idempotent on payment_intent. Webhook is THE ONLY authority for `deposit_status='cleared'`.
- `POST /api/paysheet-edit` — owner edit with field allowlist + token-revoke + version-bump + new-token + SMS-sub on accepted/pending_re_accept
- `POST /api/paysheet-accept` UPDATED — uses canTransition guard, syncs both new `state` + legacy `sub_acceptance_status` columns
- `POST /api/proposal-accept` UPDATED — sets all state machine fields. **Bug fix:** `customerPayload` was referenced at line 302 (repair-ticket auto-create) before defined at line 343. Would `ReferenceError` on every repair acceptance and skip the auto-ticket. Moved definition above first use.

**Asset integration scaffolding:**
- 4 directories created with `.gitkeep` markers tracked in git
- 13 prod files patched with canonical asset paths + graceful fallbacks (admin/login/index/app/manifest/production-jobs/tickets/paysheet HTML files)
- `public/assets/AUDIT_2026-05-09.md` documents 24 canonical paths + 4 fallback patterns + per-task integration status

**Lint guard (scripts/lint-claims.mjs):**
- Pre-commit/CI claim guard. Greps customer-facing files for hardcoded GL/WCB/$2M/fully-insured/BBB/GAF/100%-satisfaction phrases.
- Bible v0.2 §4 motion enforcement on RESTRAINED_SURFACE_PATTERNS (proposal-client.html, paysheet.html, contract*, deposit*, proposal-715-*).
- BBB regex tightened to uppercase-only (was matching #bbb hex colors as case-insensitive).
- Baseline: 24 violations / 21 P0 → **8 P0 (all in proposal-client.html, Mac's territory)**

**Documentation:**
- `docs/interface_bible_v0.1.md` (Manus, May 9)
- `docs/interface_bible_v0.2_addendum.md` (Manus + Claude, May 9 — 10 enforcement standards)
- `docs/integration_proposal_client_claims.md` — drop-in patches for 5 hotspots in proposal-client.html
- `docs/stripe_setup.md` — full activation checklist with 9 hard rules

## Customer work this session

**Kataria #45 — single proposal, dual system:**
- Merged metal pricing into existing asphalt #45 (deleted parallel #53 cleanly — proposal-client.html already had `switchSystem()` at line 2584)
- Added LF measurements (eaves 60, rakes 75, ridges 30, valleys 12, walls 50)
- Injected vinyl siding rework on rake walls ($1,000 raw × 51.3% margin → +$2,050 customer-facing) — the `extras` param didn't propagate from /api/quote engine; manually injected line items + recomputed at preserved margin rate
- Final: asphalt Gold $8,400/Plat $9,875/Dmd $14,125 (dropped from prior because remediation correctly removed per May 8 doctrine), metal Standard $19,900/Enhanced $22,075 (recommended)/Premium $31,775
- Profitability verified: 16.3% real cash net at Enhanced, sub clears $700/day floor 2x+
- Single share URL: https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-45
- Draft Darcy SMS prepared, NOT sent — awaiting Mac sign-off

**Anne Marie #51 — earlier in session:**
- 686 Royal Oaks Boulevard (other half of Luc/Brian #48 duplex)
- Mac caught her + husband in person, presented at honored floor
- Locked at honored floor matching duplex chain (Gold $20,750 / Plat $22,500 / Dmd $34,200)

## Server-side claim violations patched (lint cleanup)

13 files patched, 13 P0 violations resolved. List:
- `public/index.html:173` — "Fully Insured" trust badge → "Licensed in NB"
- `public/admin-tenant.html:122` — placeholder text in certifications field
- `public/marketing-strategy.html:303` — internal copy describing trust stack
- `public/sales-proposal.html:793` — JS default tenant fallback
- `public/assets/ryujin-tenant.js:20` — DEFAULT for new tenants (most strategic)
- `public/proposal-715-rt-11.html` — 3 customer-facing claim spots
- `lib/metalProposalCopy.js:84` — METAL_INCLUDED_ALL bullet
- `lib/documentRenderer.js:686` — footer template
- `api/proposal.js:87` — BBB cert row removed
- `api/proposal.js:425` — gallery caption
- `api/breakdown-pdf.js:283` — PDF footer

Remaining 8 P0 all in `public/proposal-client.html` per Mac's "leave it, I'll have it uploaded soon" — Mac handling separately.

## Manus 72h plan status

| # | Priority | State |
|---|---|---|
| 1 | proposal-client.html → 0 P0 | ⏳ Mac (8 P0 remaining) |
| 2 | /api/agent-briefing | ✅ Complete (4 new blocks, escalation, warn-once) |
| 3 | sales-proposal Advanced Refactor | ⏸ Gated on #1 |
| 4 | Stripe Checkout + webhook | ⚠️ Scaffolded (needs Mac setup per docs/stripe_setup.md) |
| 5 | FinanceIt manual verification | ✅ Complete (auth-server + finance-verify) |
| 6 | CO endpoints minimal | ⏳ Schema applied, endpoints not wired |
| 7 | First live test logging | ⏳ Awaiting Ryan/customer action |

## Carry-forward (next session)

- 🟡 Push to origin still required — most pushes happened this session (chain `9e20c62..a96af61`). Verify no orphaned commits.
- 🔴 proposal-client.html copy edits + claim integration (Mac)
- 🔴 Stripe activation per docs/stripe_setup.md (Mac)
- 🟡 Kataria Darcy SMS sign-off + relay
- 🟡 Cowork prompt fired for 24-asset Grok download
- 🟡 Quote engine `extras` propagation bug — fix in lib/quoteEngineV3.js so future estimates with extras flow correctly without manual injection
- 🟡 GHL pipeline map fix (carry-forward from Session 64 AM)
- 🟢 Test cycle observation logging starts on first Ryan paysheet click + first customer proposal-page hit

---

# Session notes — 2026-05-09 (Session 64, AM) — chat brain backtick fix + image-attach fix + FAB icon + El Rody #52 GHL link-up

## What's new in prod (`dpl_6RbpK4ZqmFzfTC194bMBuHYYWZ2C`)

- **`api/chat.js`** — backticks escaped on lines 379 + 443 of BASE_PROMPT. Prior code had inner backticks around `planes`, `{sqft, pitch, label}`, `pitch`, `square_feet: 238`, etc. that closed the outer template literal early. SyntaxError on import → /api/chat 500'd on every request. Verify after deploy: `POST /api/chat` with empty body returns 400 ("No message provided"), not 500.
- **`public/assets/ryujin-chat.js`** — upload fetch URL changed from `/api/chat-upload` to `/api/chat-upload?tenant=plus-ultra`. The endpoint requires the tenant param via `requireTenant` middleware; widget wasn't sending it; uploads were silently 400'ing; image attachments vanished. One-line fix.
- **`public/assets/branding/orb.jpg`** — new dragon-orb glassmorphic asset (125 KB, blue dragon head in clear sphere on light grey bg). Old saved as `orb-OLD-2026-05-09.jpg`. FAB icon updated across all 42 mounted pages. Hard-refresh required to bust browser cache. Visual note: light-grey background, sits on dark pages — Mac may eventually want a transparent/dark-matted version.

## All three files UNCOMMITTED on desktop

These need to ride alongside the Session 63 `acc9c24` audit-fix commit and laptop's pending server-side push (paysheet+per-km work). Push sequence remains unchanged: laptop pushes server-side first → desktop pulls + rebases → desktop pushes audit + Session 64 fixes → Vercel auto-deploys → validate at 375/414/768.

## El Rody #52 — Ryujin estimate fully wired into GHL

| | Value |
|---|---|
| Estimate row | `220ea44a-c108-4425-b5ff-e02a7d2dc93a` |
| Share token | `plus-ultra-52` |
| Customer row | `c04d1e1b-b6e1-41de-ae6b-2c541c140ee4` (715 Ammon Rd, Moncton) |
| `customers.ghl_contact_id` | `fJpxW6q1fCKSJ4jDV463` |
| `estimates.ghl_opportunity_id` | `Z96Qm71RpORdRav7Zluy` (Internal Pipeline → New Lead, unassigned, $18,075) |
| `estimates.ghl_estimate_id` | `69ff3579a79898d03d98bec9` (GHL estimate doc #26, $18,075 valid 30d) |
| `estimates.tags` | `[address:715-ammon-rd, pipeline:internal]` |

Photos still pending. Quote not yet sent to customer (Mac/Darcy review pending).

## CRITICAL — `api/ghl.js` PIPELINE map is severely stale

Caught while wiring El Rody. The hardcoded `PIPELINE_NAMES` + `PIPELINE_STAGES` constants (lines ~6-68) drift from live GHL state:

- `OF6SJPdnmQS7KcgRffrb` is labeled "Mack's Pipeline" — actual: **"10 CM Pipeline"**
- Stage `b0742a38…` labeled "Mack's Pipeline / Quote Sent" — actual: "10 CM Pipeline / Follow Up 3 Sent"
- **Missing entirely:** Internal Pipeline, Operations Pipeline, Instant Estimator, Repair Pipeline

Live patch captured in `_brain/claude-memory/reference_ghl_pipeline_map_stale.md`. **Apply when next touching this file.** Long-term better fix: cache live pipelines from `GET /opportunities/pipelines?locationId=...` at startup with TTL ~1h instead of hardcoding.

## Lessons that became persistent rules

`feedback_no_pipeline_owner_inference.md` — when wiring a Ryujin estimate into GHL and the contact's `source` is empty, ASK Mac which pipeline/stage/rep. Don't pattern-match off recent neighbors or contact name. "Quote Sent" stage is only valid AFTER actually sending — creating + sending in the same instant is not possible.

---

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
