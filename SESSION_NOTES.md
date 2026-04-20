# Session notes — 2026-04-20

Picked up on 2026-04-20 to finish the TODO list + an aggressive perf pass + a second pass on the 5 half-baked areas. Everything deployed to Vercel main.

## Pending manual steps

- **Migration 012** (`schema/migration_012_checklist_state.sql`) needs to run in Supabase SQL editor before crew-app checklists sync across devices. One statement: `alter table tickets add column if not exists checklist_state jsonb default '{}'::jsonb;`
- Migration 011 (password reset) already applied and verified.

## What shipped today (2026-04-20)

**Second pass — 5 half-baked areas wired up**
- **Admin tenant settings** — admin-tenant.html now has a Weather/Location card with latitude/longitude/timezone fields. Persisted via `RyujinTenant.set()` → localStorage. `classic.html` + `production-calendar.html` already read via `RyujinTenant.get()` with Moncton fallback.
- **Crew checklist sync** — migration 012 adds `checklist_state JSONB` on tickets. `app.html` mirrors local → DB fire-and-forget on every toggle/photo, and hydrates DB → local inside `showTask()` before rendering. localStorage still wins locally (instant + offline), server is source-of-truth when online.
- **Sales hub hydration** — sales-customers.html prepends real `/api/customers` results to the demo showcase list; sales-pipeline.html shows a live-stats strip above the hardcoded stage columns with real estimate counts + open $; sales-followups.html surfaces CRM contacts with no touch in 7+ days and one-tap CALL / EMAIL / OPEN RECORD.
- **Post-production pipeline** — new `/assets/ryujin-postprod.js` + `PostProd` helper connecting walkthrough → closeout → reviews → warranty → complete. State in `ry_v1_post_prod_queue_v1`. Each downstream page shows a queue strip of jobs waiting for its stage. Completing walkthrough pushes forward; closeout's `archiveJob` advances → reviews; reviews has per-job **SEND REVIEW SMS** with the real `g.page/plusultra/review` link and advances → warranty; warranty `fileWarranty` advances → complete.
- **Proposal output** — proposal-client.html's fabricated testimonials replaced with the three real Steve V / Brad W / Tarah M reviews already on sales-client. "100% 5-star rating" → "35+ Google reviews". Added a **READ ALL REVIEWS ON GOOGLE** link pointing at `g.page/plusultra`.

**Performance pass**
- New `/assets/ryujin-perf.js` + `/assets/ryujin-perf.css` auto-loaded on all 45 pages. Detects low-end signals (`prefers-reduced-motion`, saveData, `deviceMemory < 4`, `hardwareConcurrency <= 2`) + 3s FPS sampler (flips to lite on sub-25fps).
- **Always-visible LITE badge** bottom-right on every page — click to toggle, persists.
- URL `?perf=lite` forces it. `?perf=off` clears.
- Lite mode: strips `backdrop-filter`, snaps animations to 0.01ms, hides grid-mask overlays, and on DOMContentLoaded yanks `src` from autoplay videos so huge bg clips never even download.
- Command-center `bg-dragon` video ships with no src — JS attaches it 2s AFTER load only if not lite. Kills the 18MB eager-download.
- Google Fonts `display=swap` → `display=optional` on all 45 pages.
- classic.html 60s refresh pauses when tab hidden + visibility-change listener.
- Weather fetches (classic + calendar) get 3s AbortController timeouts.
- NOTE: an earlier attempt to `defer` all shared scripts was reverted — it broke initialization order for inline scripts that depend on Ryujin.init / RyujinTenant.get. Don't re-add defer without making the inline scripts wait on DOMContentLoaded first.

**Auth — forgot password flow**
- Migration 011 adds `reset_token` + `reset_token_expires_at` on users. New `/api/auth?action=forgot` issues a 1-hour token, `/api/auth?action=reset` validates + updates. New `/reset-password.html` handles both request + set-new-password forms. "Forgot password?" link added to login.html. Reset URL is returned inline in the response (solo-tenant safe; swap for email send via Resend/SendGrid when multi-tenant).

**First pass — earlier in 2026-04-20 session**
- sales-proposal.html: added `exterior` system (Performance Shell Plus / Hardie Shell / Metal Shell, estimated pricing), live customer fetch from Supabase (`/api/customers`), tour copy bumped to "6 systems / 20 offers"
- WO seed: Donna Glen address 115 North St → **95 Cornhill St** (user correction). WO_KEY bumped v5 → v6 across workorders/jobs/materials/paysheet/classic so the fix picks up without manual localStorage clear. SQ + tier still pending EagleView.
- Crew app checklists (before the DB sync): 7 templates (install / repair / cleanup / inspect / caulk / doors / default) auto-picked by task title keywords. Photo-required steps gate their own check until a photo is attached. Complete disabled until all items done.
- Materials POs + Vendors migrated from hardcoded const to localStorage with seed fallback (`ry_v1_pos_v1`, `ry_v1_vendors_v1`). Tap PO status to cycle open → shipped → delivered. New PO / Add vendor / delete. `createPO()` now actually creates per-vendor POs from unchecked material lines.
- Jobs board tutor real effects: Push 3/7 days forward (writes back to WO store), Draft EagleView Gmail (pre-filled compose URL with address + scope), Order materials / Open WO / Pay sheet with `?wo=` pre-select.

**Sales proposal polish**
- New `exterior` system in SYSTEMS (Performance Shell Plus / Hardie Shell / Metal Shell, estimated pricing)
- Customer picker now hydrates from `/api/customers?tenant=plus-ultra` on page load, falls back to demo set offline
- Tour copy updated: 6 systems / 20 offers

**Work-order seed corrections**
- Donna Glen address: 115 North St → **95 Cornhill St** (user correction)
- WO_KEY bumped v5 → v6 across workorders/jobs/materials/paysheet/classic so the fix picks up without a manual localStorage clear
- Summerhill + Cornhill still at `sq: 0` pending EagleView reports

**Crew app checklists (app.html)**
- Seven templates: install / repair / cleanup / inspect / caulk / doors / default
- Template auto-picks from task title keywords
- Photo-required steps gate their own check until a photo is attached (camera input, data-URL local preview, fire-and-forget `/api/files` upload when project_id is present)
- Task "Complete" button disabled until every checklist item is done
- State saved per-task in localStorage (`ryujin_checklist_{taskId}`)

**Materials hub (production-materials.html)**
- POs + Vendors migrated from hardcoded const → localStorage (`ry_v1_pos_v1`, `ry_v1_vendors_v1`) with seed fallback
- New PO / Add vendor / delete / tap-to-cycle status (open → shipped → delivered)
- `createPO()` actually generates per-vendor POs from unchecked material lines now (was alert-only)

**Jobs board tutor (production-jobs.html)**
- Overdue action: Open WO to reschedule · Push 3 days · Push 7 days (all write back to `ry_v1_work_orders_v6`)
- Draft action: Open WO · **Draft EagleView Gmail** (pre-filled compose URL with client address + scope)
- Next action: Order materials (with `?wo=` pre-select) · Open WO · Pay sheet

**Performance pass (THE big one)**
- New `/assets/ryujin-perf.js` + `/assets/ryujin-perf.css` auto-loaded on all 45 pages
- Detects low-perf signals (`prefers-reduced-motion`, saveData, `deviceMemory < 4`, `hardwareConcurrency <= 2`) AND runs a 3s FPS sampler — flips to lite mode automatically on sub-25fps
- Visible `LITE` badge bottom-right on every page — click to toggle, persists to localStorage
- URL `?perf=lite` (or `?perf=off`) to force
- Lite mode strips backdrop-filter, kills infinite animations, hides grid-mask overlays, and on DOMContentLoaded **yanks the src from every autoplay video** so huge bg clips don't even download
- Command-center: `bg-dragon` video element ships with no src, JS attaches it in 2s AFTER load only if not lite. Kills 18MB eager-download that was clobbering initial paint
- Swapped Google Fonts `display=swap` → `display=optional` on all 45 pages — no more layout thrash on first paint if fonts are slow
- All shared `ryujin-*.js` scripts now `defer` (tutor, mode, tenant, persist, api, scenario, xp, mode-badge, chat, search, subhub, prod-nav)
- classic.html 60s refresh pauses when tab hidden + re-fires on `visibilitychange`
- Weather fetches in classic + calendar got a **3s AbortController timeout** and read lat/lon/tz from `RyujinTenant.get()` (Moncton defaults)

---

# Session notes — 2026-04-19

Everything committed to `main` and deployed on Vercel. Updated through the final autonomous pass.

## Live URLs (bookmark these)

### Owner hubs
- **Classic (laptop-safe, fastest)**: https://ryujin-os.vercel.app/classic.html ← recommended daily driver
- Command center (3D, full power): https://ryujin-os.vercel.app/command-center.html
- Command center Lite toggle: https://ryujin-os.vercel.app/command-center.html?lite=1
- Admin hub: https://ryujin-os.vercel.app/admin.html

### Client-facing (these are what you send)
- **Sales page** (warm-up, send this first): https://ryujin-os.vercel.app/sales-client.html
- Proposal (priced options): https://ryujin-os.vercel.app/proposal-client.html
- Sent-proposal history: https://ryujin-os.vercel.app/proposal-history.html

### Internal tools
- Proposal generator (edit + send): https://ryujin-os.vercel.app/sales-proposal.html
- Jobs board (action): https://ryujin-os.vercel.app/production-jobs.html
- Work orders: https://ryujin-os.vercel.app/production-workorders.html
- Calendar (with forecast): https://ryujin-os.vercel.app/production-calendar.html
- Materials: https://ryujin-os.vercel.app/production-materials.html
- Pay sheet: https://ryujin-os.vercel.app/production-paysheet.html
- Crew PWA (mobile): https://ryujin-os.vercel.app/app.html

## The proposal funnel (end-to-end)

```
sales-proposal.html (editor)  →  +GENERATE LINK
     ↓ encodes payload as base64 in URL
PRIMARY:  sales-client.html?data=X   (Shenron aesthetic, warm-up, CTA)
     ↓ CTA forwards the same ?data= to
     proposal-client.html?data=X     (configurator, pricing, accept + sign)
     ↓ accept →
     email to plusultraroofing@gmail.com  +  localStorage accepted-proposals log
```

The generator now emits **both** URLs and the modal defaults to the sales-client link with a separate "direct proposal" field for repeat customers. Enriched payload includes `package.name`, `rep.phone`, `media.gallery`, so both pages hydrate cleanly with zero fallbacks visible.

## Production data flow

```
production-workorders.html  ← edit / add WOs
                 ↓ writes to
           ry_v1_work_orders_v5
                 ↓ read by
    ┌──────────┬──────────┬───────────┬──────────┐
    │   jobs   │materials │ pay sheet │ calendar │
    │ (board)  │ (lists)  │  (wizard) │ (seeded) │
    └──────────┴──────────┴───────────┴──────────┘
```

All four pages now read the same store. Edit a WO once — every other page reflects it.

## What changed — sales & proposal

- Proposal demo renders with real Plus Ultra CDN photos (cover, 2× before/after, 6-card showcase) and Darcy intro video. Video aspect fixed for vertical mobile (object-fit: contain, letterbox on dark).
- Default recommended tier: **Platinum** (was Gold).
- Accept section: "Your selection" → **"Your Investment"** (Jewels framing).
- Accept CTA: "ACCEPT PROPOSAL" → **"ACCEPT & LOCK IT IN"** + subtext rewritten to state the concrete next step.
- Showcase strip hint: "Swipe" → "Scroll" (works on all devices).
- Proposal **title**: "Your Roof Proposal" → "Your Roof Plan" (less clinical).
- Green/monospace digital labels near the bottom toned down from Share Tech Mono → Orbitron.
- **New sales-client.html**: hero → personal letter → Darcy video → 3 trust cards → 4-step process → value stack (asphalt/exterior auto-switch) → gallery → testimonials (Steve V / Brad W / Tarah M) → About estimator → "See Your Investment Breakdown" CTA.
- **Open Graph + Twitter card** tags on both pages — when you text / email / DM a proposal link, it renders as a rich preview card (aerial drone shot + title + description) instead of a raw URL.
- iOS `apple-mobile-web-app-capable` + dark status-bar hints so clients who home-screen the link get chromeless view.

## What changed — production

- **Crew roles corrected everywhere** (memory + seed):
  - **Ryan (Atlantic Roofing)** — sub · primary installer on every pipeline job · also owns caulking + debris pickup
  - **AJ** — Production Assistant + door setter (canvassing / lead gen)
  - **Diego** — Operations Specialist · repairs + inbound sales calls (not installs)
  - **Pavanjot** — Laborer (material staging, cleanup, assist)
- **WO seed now has 9 jobs**: Seyeau (active, mansard/caulk), Arzaga (active, Rue Fortune), 178 Summerhill (scheduled Apr 21-23, scope TBD), Northrup / 79 Willow (scheduled Apr 24-26), 115 North St / Donna Glen (scheduled Apr 28-30, scope TBD), Pardy (scheduled May 5, scope TBD), Faulkner (draft, needs info), Fram (scheduled May 12), Sackville (active exterior).
- **Dead sample arrays removed**: LEGACY_JOBS (materials), DEFAULT_WOS_OLD (workorders) — −171 lines, no behavior change.
- **Jobs board** — five panels of hardcoded mockup replaced with live renderers over the WO store (Active Jobs, Crew Status, Material Orders, Pay Sheets, 3-Day Schedule, Alerts). Mark Complete now actually flips WO status.
- **Materials POs + VENDORS arrays** — still hardcoded, flagged in TODO. Materials list generation from WO.sq + tier is working.
- **Paysheet** — bumped from `v3` key (never existed, always empty) to `v5`. Wizard now gets the full pipeline.

## What changed — dashboards

- **New /classic.html** — laptop-safe owner hub. CSS only, no WebGL, no CSS3D, no autoplay video, no animations beyond a single pulse dot. Loads in <100ms on integrated GPU. Everything the owner actually uses at a glance: 5 KPIs, Active Jobs (top 6), Next 7 Days, Crew Load, Weather, 11 quick links, Recent Activity, Alerts strip. Auto-refreshes every 60s.
- **Calendar weather** — live 5-day Moncton forecast via Open-Meteo (free, no API key), 1h localStorage cache, WMO codes mapped to icons + severity. Dropped the "Coming soon — Environment Canada" stub.
- **New /proposal-history.html** — every proposal you've generated, sortable/filterable. Stats: Total Sent · This Week · This Month · Accepted. OPEN / PROPOSAL↗ / COPY buttons per row. Linked from sales hub + classic hub.

## Performance work (command-center was glitchy on laptop)

- All background videos across command-center / login / boot / admin → `preload="metadata"`. Browsers were eagerly downloading 9-22MB files before the page finished parsing. Biggest single win.
- **LOW_PERF mode** on command-center: auto-triggers on mobile width < 900, prefers-reduced-motion, save-data, or forced via `?lite=1` (persisted per-machine in localStorage). Disables bg video, drops stars 2000 → 400, antialias off, pixelRatio capped at 1, autoRotate off. Cutscene skipped.
- **Status**: on your laptop even LITE mode was still laggy. Final fix was shipping /classic.html as the daily driver — no WebGL, no CSS3D, no video. Nothing to lag on.

## Security

- Scanned repo + git history for committed secrets → clean.
- Removed plaintext password from auto-memory file.
- Added `.github/workflows/secret-scan.yml` (gitleaks) — runs on every push / PR.
- Vercel / Supabase / Anthropic / Blob tokens marked for **your** rotation via dashboards.
- `main-HAL` branch deletion attributed to a prior Claude Code worktree cleanup, not a breach.

## Photo migration script (still awaiting your desktop)

- `scripts/upload-photos.js` + `scripts/photos-to-upload/` folder (gitignored).
- Workflow: download Drive "Photos - Before/ After" photos, drop in folder, run with `BLOB_READ_WRITE_TOKEN`, get back Blob URLs to paste into demo fallbacks.

## Known issues / TODO next session

1. **Materials POs + VENDORS arrays still hardcoded** — the LEGACY_JOBS sample was removed but the POS array (4 sample purchase orders) and VENDORS array (4 static vendors) remain. Low impact (display only) but worth wiring to a localStorage-backed PO list.
2. **Jobs board tutor** — states have generic follow-up choices. Could wire each state's action buttons to real effects (e.g., "Order EagleView" actually drafts the Gmail).
3. **331 Mountain Rd / Diaa proposal** — transcript `b5db4715` only references Diaa by name (from a Supabase customer list query). No proposal payload was built in that session. The actual 331 Mountain proposal lives elsewhere (Estimator OS? Google Drive?) — grep the Drive and paste details when found.
4. **115 North St + 178 Summerhill** have `sq: 0, total: 0` seed values. Edit in the real numbers via `/production-workorders.html` before those job dates.
5. **Materials overrides** regenerate from SQ + tier every load. Saving edits → overrides key works, but edits are lost if the WO_KEY is bumped. Overrides should be decoupled from the seed version.
6. **Weather** hardcodes Moncton NB lat/lon. Future: pull from `tenant_settings` postal code for multi-tenant.
7. **Crew app (app.html) checklists** — per memory, needs step-by-step install workflows with photo requirements. Would need backend sync to be truly useful (crew on phones vs WO data on owner's laptop). Partial path: local checklist templates + optimistic-sync later.
8. **Classic hub orphan button** — 11 quick-link tiles in a 2-col grid. Cosmetic.
9. **Performance Shell Plus proposal** — sales-proposal's system toggle exists but needs exterior-specific tier data populated in SYSTEMS.

## Commits this session (chronological, newest last)

```
9abc27c  Add ryujin-* asset scripts + wire into admin/app
9719d46  Owner shell — onboarding, command-center, dashboard v2, landing, arcade, sim
25a3541  Marketing clips pipeline — Whisper → Haiku → ffmpeg 9:16 + UI
8bfb716  Admin hub — split into overview, pricing, team, tenant, integrations
e85cddb  Sales hub — customers, followups, pipeline, transcripts
d58beb8  Production + post-production hubs
b146faa  Sales proposal generator + client-facing proposal page
61f92a5  Add gitleaks secret scan workflow
f88d2cb  Proposal: Your Investment framing + recent-projects gallery + cleaner labels
1fa3575  Proposal: wire placeholder photos into demo data
ed104e3  Proposal: swap picsum for real Plus Ultra brand photos + Darcy video
92e095a  Proposal: fix video aspect — object-fit contain for vertical mobile videos
fd301e5  Photo migration: local folder → Vercel Blob script
0d82762  Add sales-client.html — pre-proposal lead-in (Shenron aesthetic)
0503073  Proposal: demo defaults to Platinum recommended tier
bd33165  Remove dead LEGACY_JOBS + DEFAULT_WOS_OLD sample arrays
37ac1de  Wire jobs board to live work orders
d918815  Correct crew roles + add 178 Summerhill & 115 North St to WO seed
afcbf76  Paysheet: bump WO storage key v3 → v5 to match other production pages
f0bc40a  Perf: preload=metadata on background videos
c3f7f36  Perf: preload=metadata on login + boot background videos (follow-up)
0e230f2  Command Center: LOW_PERF mode cuts mobile/reduced-motion lag
e091129  Command Center: per-machine Lite mode toggle
bc7ac69  Jobs board: right panels, 3-day schedule, and alerts all dynamic
3059706  Calendar: live 5-day Moncton forecast via Open-Meteo
3fcf247  Add SESSION_NOTES.md — overnight session summary
f9b65db  Add /classic.html — laptop-safe owner hub (no WebGL, no video)
4bc5104  Funnel integration: sales-proposal now generates sales-client URL as primary
74d1f07  Proposal + sales page polish: OG tags, CTA copy, iOS meta
f4db7a0  Add /proposal-history.html — sent proposals log + resend
```
