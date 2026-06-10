# Ryujin OS Full-Platform Pillar Review - 2026-06-09

**Audience:** Mac (owner), deciding what to build next to reach 9/10 functionality and market value before the ~July 2026 ship.
**Method:** Per-pillar deep review + adversarial verification pass on every claimed issue. 88 issues were claimed across 9 pillars; 47 survived verification, 41 were PHANTOM (refuted by reading the actual code or hitting the live API). All scores below are **post-verification**. Phantom findings are dropped entirely and several are explicitly corrected in Section 2 so nobody builds fixes for problems that do not exist.

---

## 1. Scoreboard (post-verification)

| # | Pillar | Functionality | Utility | Design | Market Value | One-line verdict |
|---|--------|:---:|:---:|:---:|:---:|------------------|
| 1 | HQ / Dashboard | **7.2** | **7.0** | **7.5** | **6.8** | Solid daily command center; needs polish, not surgery. Dead gamification code and KPI null-state ambiguity are the only confirmed defects. |
| 2 | Marketing | **6.5** | **5.5** | **7.6** | **5.0** | Healthier than it looks: backend (campaigns, ads, leads, clips, brand voice) is live; the real gaps are the capture pipeline, calendar backend, re-engagement logic, and 6 WIP pills shipping to a daily user. |
| 3 | Sales | **7.0** | **6.0** | **5.5** | **6.0** | Strong engine (pipeline, proposals, quote engine all live) dragged down by a fully fake transcripts page and 131 em-dashes across 11 files. |
| 4 | Production | **7.2** | **6.8** | **8.1** | **6.5** | The workhorse pillar. Blind spots: hardcoded review KPIs, no photos in WO context, payment_tracker readable but never writable. |
| 5 | Service | **5.5** | **5.0** | **7.0** | **4.0** | Well-built skeleton waiting on its v1.1 brain: rules engine is UI-only, SLA and rate config is stored but never consumed, tickets float unlinked to customers/estimates. |
| 6 | Customer / CRM | **6.5** | **6.0** | **8.3** | **5.8** | Beautiful lookup tool that does not act yet. Three real P1s (LTV calc divergence, no review-ask dedupe column, GHL sync stub), all small to fix. |
| 7 | Finance | **4.0** | **4.0** | **7.0** | **3.0** | Read-only dashboards over a working ledger. The match button literally tells the operator to go edit Supabase Studio while the PATCH endpoint it should call sits wired and unused. |
| 8 | Inventory / Materials | **2.0** | **2.0** | **6.0** | **2.0** | Earliest-stage pillar. PO CRUD genuinely works and merchants are seeded, but 5 of 6 advertised sub-pages 404 and there is no business logic above the CRUD. |
| 9 | Admin / Settings | **6.8** | **6.2** | **7.1** | **5.9** | Feature-complete and navigation-fractured; this is where the decks orphan lives. |
| | **Platform average** | **5.9** | **5.4** | **7.1** | **5.0** | Design carries the platform; market value lags it by two full points. The gap is wiring and operator workflows, not visuals. |

**Read on the averages:** the platform consistently looks like an 8 and operates like a 5.5. Nearly every confirmed defect is a last-mile wiring or workflow gap on top of a backend that already works. That is good news for a July ship: the remaining work is disproportionately SMALL-sized.

---

## 2. The orphan / discoverability map (headline section)

### 2a. Confirmed orphans and broken paths

1. **decks.html - THE headline orphan (CONFIRMED).** The ultraslide deck library, a core asset Mac uses daily, is linked **only** from administration.html (lines 76, 191). admin.html, the actual Admin pillar panel, has **zero** references to it. Every visit routes admin.html -> Administration tile -> administration.html -> decks card. Fix: one link card on admin.html. This is the purest example of the dual-admin-surface fracture.
2. **Inventory pillar is second-class in admin.html (CONFIRMED via grep).** admin.html's pillar shortcut grid carries Sales, Marketing, Production, Service, Finance, plus an Administration tile - **Inventory is absent** (0 grep matches in admin.html). It is reachable only via the administration.html "Vendors & Materials" card. The 9th canonical pillar should sit in the pillar grid with the other eight.
3. **Five inventory sub-pages 404 (CONFIRMED).** inventory.html links to inventory-admin.html, inventory-advanced.html, inventory-suppliers.html, inventory-readiness.html, inventory-catalog.html (lines 101-170). None exist on disk. Every layer card except Purchase Orders is a broken link, on a pillar entry page.
4. **One-way admin navigation (CONFIRMED, narrower than first reported).** admin.html DOES link to administration.html (pillar tile, line 1462) - the "two totally unlinked surfaces" claim was overstated. But the reverse path does not exist: administration.html's back button goes to command-center.html, never back to admin.html. Result: 2-hop-only access from admin.html to custom-proposals.html, roles-coverage.html, and inbox.html, and no way to retrace your steps.
5. **Dual entry-point naming debt.** Both `marketing.html` (RyujinSubHub dispatcher) and `marketing-panel.html` (layer-selector entry) exist - same for sales, production, and service. Both schemes work, but two parallel "front doors" per pillar is the same fracture pattern as admin.html vs administration.html. Pick the canonical per pillar and make the other redirect.

### 2b. Corrected record - phantoms cleared by adversarial verification

These were claimed by the link-graph inventory and **proven false**. Do not spend a session on them:

- **marketing.html / sales.html / production.html / service.html / finance.html are NOT missing.** All five exist as functional RyujinSubHub dispatcher pages (finance.html is 19.4KB, dated 2026-05-30). The sidebar links on customer.html:103-107 resolve fine. The "5 broken pillar links on every sidebar" finding was a phantom.
- **proposal-client.html is not orphaned** - referenced from job.html, admin-portals.html, production-materials.html, proposal-history.html, and dynamically from the proposal builders.
- **Merchants ARE seeded** - live API returns 5 active merchants for plus-ultra (Birdstairs, Castle, Coastal Drywall, Home Depot Moncton, Kent Riverview). The PO supplier dropdown populates.
- **sales-followups.html DOES filter** - it pulls only open leads in FOLLOWUP_STAGES and buckets by staleness with human-readable stage names (PIPELINE_STAGES map in api/ghl.js). The "shows the whole pipeline with raw UUIDs" claim was phantom.
- **service-admin settings persist and the service agent DOES emit briefing items** (migration 047 + persistAgentRun pipeline both verified). The two highest-severity Service claims were phantom.

---

## 3. Cross-pillar themes (platform work, not per-pillar work)

### Theme 1: The last-mile wiring gap (Finance, Service, Sales, Production - 4+ pillars)
The single most common confirmed defect: **the API exists and works, the UI never calls it.**
- Finance: match button shows an `alert()` telling the operator to edit Supabase Studio, while PATCH /api/payments accepts matched_estimate_id today.
- Service: ticket form omits customer_id and source_estimate; warranty form omits service_ticket_id - all three accepted by the APIs.
- Production: paysheet detail *reads* payment_tracker but saveEdit() never writes it.
- Sales: transcripts page calls no API at all (Fathom exists as an integration).

**Platform play:** a "wire the form to the endpoint that already exists" sweep. Highest score-per-hour work on the board.

### Theme 2: Orphaned configuration (Service, Customer, Finance - 3 pillars)
Settings get stored and never consumed: Service SLA targets, after-hours multiplier, travel rate, and the hardcoded 8% callback threshold; Customer GHL sync_direction + default_tag with no agent reading them; Finance single flat daily_overhead with no category breakdown. **Platform play:** config consumption audit - every tenant_settings key gets a consumer or gets cut. Matches the "prefer customizable config" doctrine, which only pays off if the config does something.

### Theme 3: Hardcoded data in live UIs (Sales, Production, platform-wide)
Sales transcripts: 6 fully fabricated meetings + 19 stubs. Production post-production reviews: 4.9-star KPIs and customer names/phone numbers baked into HTML. Plus the known single-tenant residue (Plus Ultra branding, crew names) everywhere. Hardcoded data is invisible-stale: it looks alive in a demo and lies within a month.

### Theme 4: Bug Class #10 - silent numeric coercion, save-time-only validation (Production x2, Inventory)
paysheet updateLine() coerces "$100" to NaN-then-0; WO numOrZero('') silently stores 0; PO line items accept empty/zero rows with no feedback. Validation gates exist but only fire on save click. **Platform play:** one shared on-blur numeric validator dropped into all three surfaces.

### Theme 5: The v1.1 IOU pile (Service, Finance, Customer, Marketing - 4 pillars)
In-product text promises future versions: Service rules "advisory until v1.1", Finance "full reconciliation UI in v1.1" + "90-day projection in v1.1", Customer "review_request_sent_at is a v1.1 schema add", Marketing's 6 WIP pills. Each IOU is an unfinished-product signal a prospect can read. **Ship it or hide it** - never advertise the gap.

### Theme 6: Audit-trail gaps (Finance, plus known tickets gap)
payments has no updated_at/updated_by, so reconciliation changes are unlogged; tickets activity_log already has a known 45% bypass. Compliance and dispute-resolution risk; cheap migrations.

### Theme 7: Em-dash hygiene
131 confirmed in the Sales pillar alone across 11 files (memory rule: none in any text). One sed sweep, then a platform-wide grep gate.

---

## 4. The 9/10 roadmap

### Session-sized batches (every confirmed SMALL gap, ordered by impact)

**Batch A - Navigation & discoverability sweep** *(kills the headline finding + every confirmed broken link)*
1. Add decks.html card/link to admin.html (Documents area or new Admin Tools row).
2. Add Inventory tile to admin.html's pillar shortcut grid.
3. Stub or de-link the 5 missing inventory sub-pages (minimal layer scaffold + "Phase 2" note) so nothing 404s.
4. Add breadcrumb/back link on administration.html pointing to admin.html (two-way navigation).
5. Declare the canonical entry per pillar (X.html dispatcher vs X-panel.html) and redirect the non-canonical one.
6. Document migration 063 (purchase_orders) in the repo CLAUDE.md schema table.

**Batch B - Finance operator loop** *(lowest-scoring major pillar; converts read-only to operable)*
1. Payments reconciliation modal: search/pick estimate, PATCH /api/payments with matched_estimate_id, toast + refresh. Replaces the Supabase Studio alert. The API is already live.
2. Migration: payments.updated_at + updated_by; log every match/unmatch (who, when, previous -> new).
3. Overhead categories: tenant_settings.overhead_categories (jsonb) form in finance-admin + P&L recalc summing by category.

**Batch C - Service close-the-loop** *(biggest single-session score jump available: ~5.5 -> ~7)*
1. Customer + source-estimate dropdowns in the ticket modal (API already accepts both fields).
2. Linked-ticket dropdown on the warranty claim form (API accepts service_ticket_id).
3. Auto-routing on ticket POST: read service_config.auto_route, route by estimated_cost vs aj_cap.
4. SLA activation: acknowledged_at column; service_scan reads the saved SLA config instead of hardcoded 24h; make the 8% callback threshold configurable.
5. Stat-tile drill-downs (Tickets Open -> ?status=open etc.) and an Escalate-to-Mac button.

**Batch D - Data integrity sweep** *(kills Bug Class #10 and the two confirmed CRM data P1s)*
1. Shared on-blur numeric validator -> paysheet labour totals, WO measurement fields, PO line items.
2. Guard: WO cannot move to "issued" without linked_estimate_id (red banner + estimate picker).
3. lib/customerLtvCalc.js - one canonical sellingPrice precedence (total ?? summary.sellingPrice ?? sellingPrice), consumed by customer-state.js AND customer-list.html. Ends the two-pages-two-LTVs divergence.
4. Migration: customers.review_request_sent_at + dedupe logic in the review-ask queue (stops duplicate asks; memory rule: no ask without positive signal stays in force).

**Batch E - Sales hygiene & quick wins** *(removes AI-tells and unfinished-product signals pre-demo)*
1. Em-dash sweep: sed across public/sales*, proposal*, custom*; then platform-wide grep gate.
2. Hide or gate the 6 WIP pills on marketing-panel.html ("Coming soon" behind a tenant feature flag, or finish the page).
3. Unify proposal entry points: canonize sales-proposal.html, deprecation banners on custom-proposal-new/custom-proposal.
4. Proposal staleness columns on sales-proposals.html: last viewed, days since sent (events already in GHL activity log).
5. "Upcoming Installs" section in sales-portal.html (fetch workorders by rep) - closes the sold-it-to-scheduled loop for reps.

**Batch F - HQ & Admin polish** *(dashboard trust + mobile + daily-felt context)*
1. Gamification: remove the dead power/XP/dragon CSS + API fields, or re-enable the UI - pick one.
2. KPI tiles: visual distinction for null/unset vs real zero; stale flag if last_updated_at > 1 day; render a flat placeholder when trend_pct missing instead of blank space.
3. Briefing cards: pillar/source-agent color badge for scanability.
4. Mobile breakpoints for admin-pricing.html (3-col) and admin-integrations.html (5-col rail).
5. WO detail modal photo strip: fetch estimate_photos by linked estimate so crew sees scope photos without leaving the work order.

### LARGE gaps (one-line scope + why it matters for market value)

**Tier 1 - market value movers, sequence before July:**
1. **Seeded demo tenant + onboarding wizard** (Admin, known item) - you cannot demo or sell tenant #2 while real customer PII renders in every screen and there is no signup path. This is THE market-value gate; everything else is polish behind it.
2. **True P&L: real material costs from quote_line_items** (Finance) - replaces the 50/50 guess with actual gross margin; the first thing a lender, buyer, or serious contractor checks.
3. **Supplier/AP ledger + aging report** (Finance) - "who do we owe and how old is it" is table stakes vs ServiceTitan/AccuLynx; today payables = paysheets only.
4. **Live review pipeline** (Production) - replace hardcoded 4.9-star KPIs and baked-in customer cards with live GHL/review-table data; the reputation engine is a sale-closer and the current fake stars would embarrass a demo.
5. **Customer propensity scoring + GHL sync agent** (Customer/CRM) - converts the CRM from lookup tool to proactive re-roof revenue engine; the strongest differentiator story Ryujin can tell.

**Tier 2 - strong roadmap material:**
6. **Fathom transcripts integration** (Sales) - call intelligence (objections, playbook mining) is a moat; stub the live wire first, Claude analysis next.
7. **Sales cockpit analytics build-out** - funnel by stage, close-rate trend, time-to-close; the daily-use dashboard Mac will actually open.
8. **Marketing capture pipeline** (getUserMedia -> upload -> brand select) - completes the selfie-to-clip content flywheel, the most demoable marketing feature.
9. **Content calendar backend** - drag-to-schedule onto scheduled_posts; multi-brand planning.
10. **Lead re-engagement automation** (Marketing) - stale-lead detection + sequenced re-touch; turns the lead list into pipeline.
11. **payment_tracker ledger UI** (Production/Finance) - partial payments to subs recorded in-app instead of spreadsheets.
12. **90-day cashflow projection chart** (Finance) - from runway calculator to forward planning.
13. **Balance sheet view** (Finance) - assets/liabilities/equity; lender-ready reporting (chart of accounts already exists, migration 049).
14. **Supplier invoice upload + GL posting** (Finance) - closes invoice -> AP -> pay -> reconcile for Melodie.
15. **Service cost modifiers + auto-callback from messages** - real quotes (travel, after-hours) and leak-keyword auto-ticketing from inbox.
16. **Inventory Phase 2** - overdue-PO agent, per-job readiness checklist, supplier scorecard, catalog management UI; the pillar's path from 2 to 6.
17. **Roles coverage visual timeline** (Admin) - drag-and-drop time-off simulation instead of a text matrix.
18. **Admin surface merge** - long-term: one admin home (fold administration.html's dispatcher into admin.html or vice versa); ends the fracture class that produced the decks orphan.
19. **Animated KPI gauges on HQ** - decorative tiles become value-driven SVG; perceived-sophistication lever for demos.

---

## 5. Ultraslide deck outline (14 slides)

**Slide 1 - Title: "Ryujin OS - 9 Pillars, Verified"**
- Full-platform review, 2026-06-09; every finding adversarially verified against code + live APIs
- 88 claims tested: 47 confirmed, 41 phantom - this deck contains only what survived
- Goal: the road to 9/10 before the July ship

**Slide 2 - How we verified (donut chart)**
- Donut data: Confirmed 47 / Phantom 41 (47% of claimed issues were refuted by reading the code or curling the live endpoint)
- Lesson: review claims are hypotheses; the verifier saved ~6 sessions of fixing non-bugs
- Biggest saves: "5 missing pillar pages" exist; Service settings persist; merchants are seeded

**Slide 3 - The scoreboard (bar chart)**
- Bar data (functionality by pillar): HQ 7.2, Marketing 6.5, Sales 7.0, Production 7.2, Service 5.5, Customer 6.5, Finance 4.0, Inventory 2.0, Admin 6.8
- Production and HQ lead; Finance and Inventory are the floor
- Verdict line: the platform looks like an 8 and operates like a 5.5

**Slide 4 - Four dimensions (grouped bar chart)**
- Bar data (platform averages): Functionality 5.9, Utility 5.4, Design 7.1, Market Value 5.0
- Design carries the platform by 2 full points over market value
- The gap is wiring and operator workflows, not visuals - cheap to close

**Slide 5 - Headline: the decks orphan**
- decks.html (daily-use deck library): zero links from admin.html; only reachable via administration.html dispatcher
- Same fracture pattern: Inventory missing from admin.html's pillar grid; administration.html back button never returns to admin.html
- Fix is one session (Batch A) - and a decision: one admin home, eventually

**Slide 6 - The corrected record**
- marketing/sales/production/service/finance.html all EXIST as live dispatcher pages - the "5 broken pillar links" finding was phantom
- Also cleared: proposal-client not orphaned, merchants seeded (5 live), follow-ups filter correctly, Service settings + briefing pipeline work
- Takeaway: do not build redirects for pages that exist

**Slide 7 - Theme 1: the last-mile wiring gap (4 pillars)**
- Pattern: API live and tested, UI never calls it
- Exhibits: Finance match button -> alert() instead of its own PATCH; Service forms omit fields the API accepts; paysheet reads payment_tracker, never writes it
- Highest score-per-hour fix class on the board

**Slide 8 - Theme 2: config nobody reads + the v1.1 IOU pile**
- Service SLA/rates stored, agent uses hardcoded 24h and 8%; Customer GHL sync direction stored, no agent; Finance overhead = one flat number
- Six WIP pills + four "in v1.1" banners visible to users today
- Rule: every config key gets a consumer; every IOU gets shipped or hidden

**Slide 9 - Theme 3: hardcoded data + hygiene**
- Sales transcripts: 6 fabricated meetings; Production reviews: 4.9-star KPIs + customer names baked in HTML
- 131 em-dashes across 11 Sales files (instant AI-tell; house rule bans them)
- Bug Class #10: silent numeric coercion on 3 surfaces - one shared validator fixes all

**Slide 10 - Pillar snapshots: the strong half**
- HQ 7.2 / Production 7.2 / Sales 7.0 / Admin 6.8 (functionality)
- These work end-to-end daily; their gaps are polish (KPI states, photos-in-context, em-dashes, nav links)
- One batch each takes any of them to 8+

**Slide 11 - Pillar snapshots: the build half (bar chart)**
- Bar data (functionality): Service 5.5, Customer 6.5, Marketing 6.5 vs Finance 4.0, Inventory 2.0
- Service + Customer: small wiring sessions unlock big jumps (forms -> APIs that already accept the fields)
- Finance + Inventory: the only pillars needing real construction, not just wiring

**Slide 12 - The roadmap: 6 session batches (funnel chart)**
- Funnel data (batch -> items): A Navigation 6, B Finance loop 3, C Service loop 5, D Data integrity 4, E Sales hygiene 5, F HQ/Admin polish 5
- Ordered by impact: discoverability first (what a prospect hits in 60 seconds), then the two operator loops
- 28 confirmed SMALL fixes total - roughly 6 working sessions

**Slide 13 - The five large bets for market value**
- 1) Demo tenant + onboarding wizard (the sales gate - live PII blocks every demo today)
- 2) True P&L + supplier/AP ledger (lender-grade finance) ; 3) Live review pipeline (reputation engine)
- 4) Propensity scoring + GHL sync (CRM becomes a revenue engine) ; 5) Fathom call intelligence (the moat)

**Slide 14 - Decide now**
- Pick the canonical admin home (admin.html vs administration.html) - ends the orphan class permanently
- Pick Finance ship scope for July: operator loop only (Batch B) vs lender-grade (true P&L + AP ledger)
- Greenlight the demo tenant - it gates every sales conversation more than any feature does

---

*Report generated 2026-06-09. Scores reflect adversarial verification adjustments; phantom findings (41 of 88) are excluded throughout. Source reviews + verdicts archived in the session that produced this file.*
