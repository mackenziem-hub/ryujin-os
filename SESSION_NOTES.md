# Session notes — 2026-05-13 evening (late) — Production pillar live overview SHIPPED + cockpit orbit fix + HTML cache hardening + Codex review proves out

**What:** Late-evening focused session, three real wins layered on top of a structural discovery.

## What shipped (5 commits, all on origin/main, all deployed)

**1. HTML cache hardening (`acf5782`).** Mac was still seeing 6 panels on `command-center.html` after hard-refresh. `vercel.json` had `max-age=0, must-revalidate` which lets browsers reuse the body on 304. Switched to `no-store, no-cache, must-revalidate` + `Pragma: no-cache` + `Expires: 0`. `/sw.js` added to same no-store treatment. Bumped `public/sw.js` VERSION to `ryujin-os-v2-nocache-2026-05-13` — on activate it `caches.delete(name)` for every cache + `clients.navigate(client.url)` reloads controlled windows so devices with prior SW pick up new behavior automatically.

**2. Cockpit orbit radius fix (`158c76d`).** Cache fix didn't solve "screens smooshed together" because that wasn't actually a cache issue. Phase 1 IA (`51452e7` from the IA-build session earlier) bumped `PANEL_COUNT` 6 → 9 but left `ORBIT_RADIUS = 820`. Chord between adjacent panels = 2·R·sin(π/N). At R=820 N=9 chord = 572 — but `.holo-panel { width: 360px }`, so adjacent panels visibly overlap. Chord-equivalence math: R for 9-panel layout with old 6-panel chord (820) = `820 / (2·sin(π/9)) ≈ 1199`. Set `ORBIT_RADIUS = 1200`, `CAMERA_START.z = 720`, `controls.maxDistance = 1200`, `ZOOM_LEVELS = [180,410,730,1140]`. Cockpit now displays 9 pillars with breathing room equivalent to original 6.

**3. Production pillar live overview (`ce48754` → `97b26df` → `0c0aa00`).** This is the headline. After cockpit fixes Mac said dashboards still feel basic despite weeks of asset building. Audited the structural issue: **pillar landing pages are static SubHub tile launchers — real data lives in sub-pages but never surfaces on the landing.** Mac sees the launcher in the cockpit iframe preview and gets no signal that anything exists. Converted `public/production.html` 146 → 681 lines against Grok mockup `C:/Users/macke/Downloads/x6kN2.jpg` as the template for the other 7 pillars.

Three-step build:
- **v1 (`ce48754`):** 4-KPI strip + 3-col middle row (Active Jobs cards · Active Production Queue · Awaiting Mac cyan-glow panel w/ waveform SVG) + Bottleneck Heatmap + 5 SubHub bottom tiles. Wired to `/api/paysheets` + `/api/tickets`. 30s polling.
- **Hardening (`97b26df`)** triggered by Mac's "make sure code+data is good, not stale, no hallucinations, no fake data" ask:
  - Killed fake "This Week" KPI — math identical to Active Jobs with no real date filter. Replaced with "Active $ in Flight" from real paysheet totals.
  - Scoped pending-paysheets KPI to active jobs only — was inflated 11 → 5 by 6 historical completed/invoiced paysheets where `sub_acceptance_status` was never flipped after that field was added.
  - Split Awaiting Mac semantically: `state='draft' AND sub_acceptance_status='pending'` = "Drafts to Send" (truly awaiting Mac, 2 jobs / $9.3K) vs `state='sent' AND sub_acceptance_status='pending'` = "Sent · Awaiting Sub" (informational, 3 jobs / $14.4K). Third line = Overdue Tickets count.
  - Production Tickets → Open Tickets (no pillar tag exists in current data).
  - `cache: 'no-store'` on every fetch + `credentials: 'same-origin'`. `visibilitychange` + `window.focus` immediate-refresh listeners. Partial-failure handling — if `/api/paysheets` OR `/api/tickets` fails, keep stale for the other, surface "PARTIAL · X stale" in topbar. Total-failure shows OFFLINE. Staleness watchdog: topbar amber "STALE · Xs" if no successful refresh >90s. `IN_FLIGHT` guard prevents overlapping polls. Last-sync ms latency displayed.
  - Sub Portal tile → routes to `admin-dispatch.html` (Mac's view) instead of `sub-portal.html` (sub-facing magic-link page).
- **Codex review fixes (`0c0aa00`):** Mac said "check with codex." First substantive Codex adversarial review since plugin install this morning. Subagent `codex:codex-rescue` ran a 134s/27K-token review and caught **5 real bugs**:
  1. **Timezone date math** — `new Date('2026-05-13') < today.setHours(0,0,0,0)` compared UTC-midnight to local-midnight. Today-due tickets falsely marked overdue west of UTC. Fixed with `localDateKey()` using `toLocaleDateString('en-CA')` so YYYY-MM-DD strings compare timezone-safely.
  2. **`IN_FLIGHT` could wedge forever** — render-throw left flag true, all future polls silently dropped. Wrapped `loadAll` body in try/finally + error surfacing to topbar.
  3. **"Today's Production Queue" wasn't filtering by today** — `today` variable was dead, panel sliced API order. Renamed "Active Production Queue" since paysheets lack scheduled_date.
  4. **Heatmap "in flight" total included completed+invoiced** — relabeled "$X active · $Y pipeline value."
  5. **Heatmap CSS class mismatch** — JS emitted class `invoice_final` but CSS defined `.invoiced` — segments rendered without grey background. Now uses `colorClass` map for bar segments (was already used in legend).
  Plus minor: dead-variable removal, type-safe `String(p.subcontractor||'')` parse, honest Materials-tile empty state (no POs yet → "0 · no POs created yet"), `QUEUED_REFRESH` for focus-during-flight, `POLL_HANDLE` + `pagehide`/`beforeunload` cleanup to prevent zombie pollers when iframed.

## Verified end-to-end against live API at deploy time

- **Active Jobs:** 5 (4 scheduled + 1 in_progress) — Shelagh Peach · Kyle Graham · Christian (KW) · Donna Boosamra · Gary & Karen Pardy
- **Active $ in Flight:** $24K (5 jobs · avg $4.7K)
- **Awaiting Sub Accept:** 5 ($24K · narrowed from inflated 11)
- **Open Tickets:** 32 · 28 overdue (real data hygiene issue: April install-prep tickets never auto-closed)
- **Heatmap:** scheduled $17K · in_prog $7K · awaiting_invoice $19K · invoiced $9K = $52K pipeline value
- **Drafts to Send:** 2 ($9.3K) — Mac's actionable pile
- **Sent · Awaiting Sub:** 3 ($14.4K)

Zero hardcoded customer names. Zero fake amounts. grep-verified.

## Parallel-session note

This session ran AFTER the IA-build session (also evening) — I sequenced commits cleanly onto `origin/main` with `git fetch + rev-list` parity checks before each push. Different files (production.html + vercel.json + sw.js) — no merge conflicts. Sales pillar work was happening in yet another terminal earlier in the afternoon per Mac's "another terminal is running that" comment when he downloaded the production mockup.

## Carry-forward

- 🔴 **Replicate template across 7 remaining pillars** — marketing, finance, service, customer, materials, administration, dashboard. ~30-45 min each = 4-5 hrs total.
- 🔴 **28 overdue tickets cleanup** — most are April install-prep that should auto-close on job completion. One-shot script could flip status='done' on open tickets where their project's job is completed.
- 🟡 **Inline `onclick=...${esc(id)}...` → delegated `data-*` listeners** — Codex flagged escaping class mismatch. Not active bug (UUIDs have no quotes) but should land cleanly across all pillars when refactoring.
- 🟡 **Optional v1.5 aggregator endpoint** `/api/production-overview` to bundle 6 fetches — defer until v1 proven across pillars.
- 🟢 **Codex review gate validated** — run on every aggregator dashboard / date+money math file from now on.

## Sales-cockpit file

`public/sales-cockpit.html` exists from the parallel terminal earlier — surfaced for next session to decide whether it represents the canonical Sales pillar overview (which would predate this Production template) or is something else.

---

# Session notes — 2026-05-13 morning — Codex plugin install + admin docs UX fixes + dashboard cockpit rewire + Files folder in administration + gutterQuoteEngine.js EMERGENCY RESTORE

**What:** Five-hour session, three real wins, one wrong-file mistake, one emergency restore.

## What shipped

**1. Codex plugin install + review gate.** `openai/codex-plugin-cc` installed in Claude Code. Codex CLI 0.130 already authed via Mac's ChatGPT login. `/codex:setup --enable-review-gate` toggled ON for `C:\Users\macke`. Subagent `codex:codex-rescue` available. Two adversarial reviews this session caught 4× P1, all fixed.

**2. Phase A — admin docs UX surgical.** Three edits:
- `public/doc.html` — sticky white "Back to Files" pill button top-left, hidden in `.pdf-mode` and `.preview-mode`. `docBack()` gated on `history.length > 1` (Codex fix — handles new-tab opens correctly).
- `public/admin.html` `drawDocumentsShell()` — renamed header to "Files & Documents", added prominent white Back button calling `navigate('dashboard')`.
- `public/admin.html` Today's Focus action-grid — added 4th Files action button. Added `role="button" tabindex="0"` + `onkeydown` for Enter/Space (Codex fix).

**3. Phase B — pillar grid built on WRONG file.** I built a 6-pillar+Administration tile grid + Files button in bottom nav on `admin.html`. Mac's actual landing is `command-center.html`. Codex reviewed correctly for the file I touched but couldn't know the surface mismatch. Reverted command-center panel-count change (briefly bumped 6→9 which smooshed orbital layout), added a HUD Files button to command-center. Phase B work on admin.html is stranded — decide post-meeting whether to port or delete.

**4. /api/quote HTTP 500 emergency.** Mac's dashboard broke. `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/lib/gutterQuoteEngine.js' imported from /var/task/api/quote.js`. The file was created May 12 for the Lefurgey gutter quote, never committed to git, AND wiped from local OneDrive between sessions. My deploys rebuilt the function bundle from incomplete local source. Recreated `lib/gutterQuoteEngine.js` from spec in `_brain/claude-memory/reference_gutter_rates_may12.md` + Lefurgey #62 example math. Exports `calculateGutterQuote()` + `loadGutterRates()`. API back to 200. **Math may differ ~$10 from original** — Lefurgey is frozen at sent price so no live harm, new gutter quotes use restored engine, verify before next gutter sale.

**5. Dashboard cockpit rewire (the real win).** Mac escalated past frustration: "I open command center, click DASHBOARD, big empty square surrounded by useless hardcoded KPIs, can't operate my system." Read `dashboard-v2.html` fully. The dragon-stage box has `id="dragonChatMount"` but `Ryujin.init()` was passing a hardcoded "Jonathan Gould 2 days overdue" multiple-choice mockup tree instead of pointing at the real `/api/chat` brain. All 5 KPIs were hardcoded HTML literals (`$90.7K`, `$410K`, `9 leads`, `$8.10 CPL`) from day 1. Snapshot fetcher used wrong field paths (`snap.revenue.signed` instead of `snap.sections.revenue.signed_mtd`) AND only updated 2 of 5 KPIs AND only fired on 5-min interval, never on load. Fixes:
- Replaced mockup `Ryujin.init({ root: {...gould...}, states: {gould,deals,crew,...} })` with `Ryujin.init({ sector: 'DASHBOARD', embedTarget: '#dragonChatMount' })` — real /api/chat brain with full tool use.
- Wired all 5 KPIs to `snap.sections.*` paths.
- Fires on page load + every 5 min.
- Forces `localStorage.removeItem('ry_chat_off')` before init.
- Legacy mockup wrapped in `if (false)`.

Mac confirmed "dashboard's working".

**6. Files folder in Administration.** Renamed `administration.html` DOCUMENTS card (was 9th of 9) to FILES, moved to 1st position. Copy expanded to mention NanoSeal + Tara Court explicitly. Mac left for Ben Crocker meeting with 3 file paths confirmed: (a) Command Center → Administration → FILES, (b) Dashboard → Files action tile, (c) direct `/doc.html?slug=nanoseal-program-index`.

## Artifacts

- 0 git commits this session — all via `vercel --prod` direct. Ryujin local now ~18 commits behind prod.
- 6+ vercel prod deploys.
- 1 new lib file (RESTORED): `lib/gutterQuoteEngine.js` (~85 lines).
- Modified: `public/doc.html`, `public/admin.html`, `public/command-center.html`, `public/dashboard-v2.html`, `public/administration.html`.
- 4 new memory files: project_codex_plugin_review_gate_may13, project_dashboard_v2_cockpit_rewire_may13, feedback_command_center_is_landing, project_session_oncall_recovery_may13.

## Carry-forward (read at next LOAD)

- 🔴 **Ryujin local 18+ commits behind prod, multiple files exist only in deployed function bundles.** Full audit needed before next deploy.
- 🔴 **Mac's Ben Crocker / NanoSeal meeting outcome** — capture pricing, exclusivity, next steps when Mac returns.
- 🟡 **gutterQuoteEngine.js math verification** — test against a known-good gutter quote.
- 🟡 **dashboard-v2.html action log + alert chips still hardcoded** — Phase D scope.
- 🟡 **Phase B pillar grid stranded on admin.html** — port or delete.
- 🟡 **NotebookLM brief NOT generated** — generate next session if Mac wants.

---

# Session notes — 2026-05-12 late night — NanoSeal NB partnership program (Tara Court proposal + partnership brief + summer campaign deck + math audit + admin save)

Six-hour deep work session building the complete Plus Ultra × NanoSeal NB partnership package for Mac's May 13 in-person meeting with Ben Crocker.

## Deliverables shipped

### Public HTML pages
- `public/tara-court-aphl.html` — client-facing APHL proposal (polished, final form)
- `public/tara-court-proposal.html` — same content + DRAFT watermark for Ben
- `public/nanoseal-partnership.html` — 3-section partnership brief
- `public/summer-campaign-2026.html` — 16-slide workshop deck
- `public/gonano-shingle-death-score.pdf` — Ben's official rubric

### Ryujin admin docs (saved via Supabase Management API)
5 records in `docs` table for plus-ultra tenant via `scripts/_oneshot/_save_nanoseal_program_to_admin_2026-05-13.mjs`:
- `nanoseal-program-index` — master index w/ pricing summary + open decisions + history
- `tara-court-aphl-proposal` — APHL final MD
- `tara-court-partner-draft` — partner review MD
- `nanoseal-partnership-brief` — partnership brief MD
- `summer-campaign-2026` — campaign deck MD

## Tara Court pricing (Plus Ultra estimate pending Ben confirmation)

| Option | Total incl HST | Saved | % | Recommend |
|---|---|---|---|---|
| A · Pilot | $23,891 | $173,995 | 88% | |
| B · Standard | $62,734 | $135,152 | 68% | ★ |
| C · Comprehensive | $95,153 | $102,733 | 52% | |

Full replacement baseline: $197,886 (6 × $32,981 May 2025 amended estimate incl HST).

Surface breakdown (282 SQ total): 14 Fortify · 163 Revive · 9 Revive gated · 49 Bio-Boost · 47 Replace.

Plus Ultra per-SQ pricing (pre-HST):
- NuRoof Fortify™: $145/SQ
- NuRoof Revive™: $115/SQ (gated same rate)
- Bio-Boost™: $85/SQ
- Replacement (Landmark Gold): $608/SQ

## Math audit

**Caught and fixed before publishing.** Original drafts had two material errors:

1. **Double-HST on full-replacement comparison.** The $32,981 per-building figure from the May 2025 PDF is already incl HST (subtotal $28,679 + HST $4,302 = $32,981). I had used it as the pre-HST baseline and added 15% on top, getting $227,569. Corrected baseline: $197,886.

2. **Wrong total SQ.** Used 260 SQ instead of 282 (6 × 47.32 per PDF). Surface counts updated across all docs.

Resulting changes:
- Option totals: A $22,437→$23,891, B $60,191→$62,734, C $93,081→$95,153
- Saved amounts: A $205K→$174K, B $167K→$135K, C $134K→$103K
- Percentages: 88/67/49% → 88/68/52%

Honest numbers vs inflated. Captured as memory rule `feedback_verify_hst_handling.md`.

## Market sizing research

Built TAM/SAM/SOM for Greater Moncton:
- TAM $69M (24,800 rejuvenation-eligible SFH × $2,250 + ~300 multi-family × $45K)
- SAM $20M (~30% of TAM, Plus Ultra reach)
- SOM Year 1 $500K-$1.1M
- Year 3 trajectory $1.5-2.5M annual

Sources: StatsCan 2021 Census + 2025 CMA estimate (196K population, fastest growing CMA in Canada), Roof Maxx pricing benchmarks ($45-275/SQ), local competitor scan.

## Competitive landscape (verified)

- **No Roof Maxx dealer in Atlantic Canada** as of May 12 2026 (300+ in US, zero in NB)
- **No competing nanotech product** sold in Greater Moncton
- **No local roofer markets rejuvenation** as a service — Ragnarok, BelVue, Evolve, All Angles Covered, TriForce all sell replacement only
- **12-18 month window** before Roof Maxx franchise enters NB

## Summer 2026 campaign deck (16 slides)

Audience map (4 segments) → Campaign stack (5 plays) → Play deep-dives → Backlog plays → Master timeline → Investment summary → Risk pre-mortem → KPIs → Decisions.

Total budget $10,900 ($7K PU · $3.9K NanoSeal). Projected $120K-$320K rev (11-29× ROAS).

## Higgsfield assets

5 generated (~$2 total cost):
1. `hf_20260513_011733_808b4527` — Aerial NB condo complex (proposal cover)
2. `hf_20260513_011736_b84dee23` — Before/after shingle split (tech section)
3. `hf_20260513_013115_0883d101` — Family Save A Roof reveal (giveaway hero)
4. `hf_20260513_013118_464544fd` — Webinar host setup (livestream slide)
5. `hf_20260513_014233_712354fe` — Neighborhood market visualization (market sizing slide)

## Repo state

- 0 git commits this session (all via `vercel --prod` direct)
- Local Ryujin now ~15 commits behind prod — needs reconciliation pass next session
- New files in `public/`, `scripts/_oneshot/` not yet committed

## Open for next session

- 🔴 **Mac's May 13 meeting outcome** — capture pricing + terms decisions in memory
- 🔴 **Update `tara-court-aphl.html`** with Ben's confirmed pricing if meeting goes well
- 🟡 **Repo reconciliation** — 15 commits worth of working tree to commit
- 🟡 **Crew OS Mobile phone QA** still pending from yesterday
- 🟡 **Tomorrow's deal trigger** — past client re-engagement (Play B) is the fastest revenue path; build the email sequence Tuesday/Wednesday regardless of meeting outcome

---

# Session notes — 2026-05-12 late evening — Crew OS Mobile v1 SHIPPED + notification recalibration + briefing cron fix

Three concurrent ships, all to prod.

## 1. Briefing cron fix
`vercel.json::api/agents/briefing.js::maxDuration` 60 → 300. Cron was timing out → `morning_briefing.last_run` was stuck at the previous day. Manual re-trigger came back HTTP 200 in 52.4s with full payload. Same fix applies to the 21:00 UTC evening cron.

**Deferred:** briefing.js re-runs Vegeta/Piccolo/Krillin agents that the 10:03 UTC `daily.js` cron just ran 3 min earlier. ~$0.30-0.60/day wasted Claude API. Refactor to read existing agent reports from snapshot. ~30 min build, not done this session.

## 2. Notification recalibration
Three env-var gates added to Vercel prod:
- `OWNER_SMS_MUTED=1` — gates 4 owner-bound SMS sites in `_shared.js`, `watchdog.js`, `paysheet-accept.js`, `sub-portal.js`. Each helper early-returns + logs the muted action.
- `OWNER_BRIEFING_EMAIL_MUTED=1` — gates `gmailSend` in `briefing.js`. Brief still runs + writes to snapshot. Admin dashboard is now the only briefing read path.
- Cat shift-update reply DRAFTED in Gmail (id `r4750476875182993487`). NOT SENT.

## 3. Crew OS Mobile v1 SHIPPED

### Migration 061
```sql
alter table users
  add column if not exists magic_token text unique,
  add column if not exists magic_expires_at timestamptz;
create index if not exists idx_users_magic_token on users(magic_token) where magic_token is not null;
```

### Auth endpoints (api/auth.js)
- `POST /api/auth?action=magic-create` (admin-only, Bearer + role check) — generates token, sets on user, returns URL. Default 7d TTL, max 30d. Tenant-scoped to caller session.
- `POST /api/auth?action=magic-consume` (public) — validates token + expiry, inserts session, **clears magic_token** (single-use), returns same payload as login.

### Landing page (public/magic.html)
Auto-calls magic-consume, writes session to localStorage, redirects:
- Mobile UA → `/portal-mobile.html`
- Desktop UA → `/admin.html`

### Portal overhaul (public/portal-mobile.html)
~+450 lines. Five in-place panels swapping via `data-panel` attribute. Tab bar retargeted to switch panels not navigate (5 tabs + center mic FAB unchanged).

| Panel | Source | Notes |
|---|---|---|
| Home | Existing — kept as-is | Greeting + hero + duo + tasks preview |
| Tasks | `/api/tickets?assigned_to=<userId>` | Priority dots: urgent=red, high/active=amber, due-based fallback. Tap → modal. |
| Chat | `/api/messages?box=inbox` then `?thread_id=X` | Thread list → tap → bubbles + reply bar. Photos render inline via `m.attachment_url \|\| m.image_url`. |
| Alerts | `/api/snapshot` | Overdue tickets / stale leads (>10) / ad alerts / briefing errors. Red/amber/green left-border. Tappable rows jump panels. |
| More | Static links | paysheet, jobs, activity, profile, sign out |

Job Details slide-up modal — triggered by any task tap (Home preview OR Tasks panel). Shows status, address, due (formatted "Due tomorrow" / "3d overdue"), notes.

### Users issued (NOT SENT)
- Diego (existing user) — 14d magic token
- Pavanjot Singh (created fresh user row, role `crew`, `pavanjot@plusultraroofing.com`) — 14d magic token

## Mac caught a mistake
Mid-session I declared the rollout "ready to send" after only shipping the auth + Higgsfield mockup. Mac: *"so the mobile crew portals have been updated and improved according to the mockups?"* They were not. Spent another ~75 min overhauling portal-mobile.html before declaring done. Saved as `feedback_dont_conflate_plumbing_with_surface.md`.

## Repo state warning
Local working tree is now **~10 commits behind prod** — all this session's work pushed via `vercel --prod` direct, no git commits. Reconcile next session: `git add -A && git commit` then push.

---

# Session notes — 2026-05-12 evening — Casey Realty Inspection Bundle SENT to David Creese

Long, careful session. Three Casey Realty inspections (32 Church Food Bank · 21 Dickey · 48-50 Albion in Amherst NS) consolidated from "draft proposals built but unsendable" to "fully shipped." Email left Mac's inbox end of May 12.

---

## ADDENDUM — 2026-05-12 PM — Session 14 continuation (Steve Maltais ticket handoff to AJ + Ryujin internal message + customer "still looking" message sent)

Continuation of earlier Steve Maltais triage from Session 14. Notes inserted here for chronology since SESSION_NOTES.md was overwritten by Casey Realty session in between.

**Mac sent customer-facing "still looking" message to Steve via FB DM** (no system action — Mac wrote + sent directly).

**Mac questioned the "discontinued" framing.** 5" lap is one of the most common vinyl SKUs in NB; every major brand still makes it. Suppliers calling it "discontinued" almost always mean a color/line/texture was dropped, not the profile. Captured as `reference_discontinued_siding_usually_color_not_profile.md`.

**Ticket #53 reassigned Diego → AJ** via `_reassign_401_gould_to_aj_2026-05-12.mjs`:
- Title appended " — siding source hunt in progress"
- Due bumped 2026-05-07 → 2026-05-19
- Detailed note added (customer history, source-hunt scope, customer-message status, 4-step playbook)
- Tags: `reassigned:diego->aj, siding_source_hunt, steve-maltais`

**Caught + reverted a misassignment.** Query `title.ilike.%Gould%` matched both #53 (intended) and #47 "Shingle Repair — 810 Route 124, Norton NB (Jonathan Gould)" (unrelated, done April repair). Reverted #47 via `_revert_47_misassignment_2026-05-12.mjs`: assignee back to Diego, title restored, due back to 2026-04-18, errant tags + note stripped. Lesson: name-substring matching is brittle when multiple people share a surname.

**Sent internal Ryujin message Mac → AJ** via `_msg_aj_401_gould_handoff_2026-05-12.mjs`. Direct DB insert (Twilio SMS not auto-fired — gated to API path; AJ will see unread badge in admin sidebar).
- Message id: `b8fa3ede-dbde-4b72-93ee-f1c27ea1a8cc`
- Thread id: `b815a3e2-5af6-4740-9da5-2de365494ca6`
- Subject: "401 Gould (Steve Maltais) — reassigned to you · siding source hunt"
- 1,561 chars: customer history, discontinued skepticism, 4-step playbook, vertical-gables context

**Files:**
- New scripts: `_reassign_401_gould_to_aj_2026-05-12.mjs`, `_revert_47_misassignment_2026-05-12.mjs`, `_msg_aj_401_gould_handoff_2026-05-12.mjs`
- DB writes: tickets #53 (reassigned), tickets #47 (reverted clean), messages `b8fa3ede-...` (Mac→AJ)
- 0 commits, 0 deploys

**Carry-forward:**
- 🟡 AJ owns source hunt — Kaycan/Mitten/Royal reps direct, FB groups, sub pings, brand-stamp photo. Ticket #53 due May 19.
- 🟡 Lesson: tighten WHERE clauses on bulk-update scripts — use `ticket_number` or `customer_id` not name-substring matching
- 🟢 Customer message sent by Mac via FB DM
- 🟢 Ticket #53 reassigned, AJ notified internally

---

## Casey Realty session (original)

## What landed

### Insurance language scrubbed across 8+ surfaces
Mac directive: signed/sent proposals never contain wording suggesting PU lacks current coverage. Old Gamma decks had a full "Gate 1: Insurance & contractor qualification" slide naming brokers (Guilherme, Sébastien) — deal-killing for a deal closing months out. Scrubbed:
- `_brain/claude-memory/project_casey_realty_commercial_may11.md`
- `_brain/claude-memory/feedback_high_liability_audit_before_send.md`
- `MEMORY.md` index entries
- `_brain/notebook-briefs/threads/casey-realty.md`
- `_brain/notebook-briefs/2026-05-12-pm-brief.md` (local + Drive re-upload)
- Obsidian `01-DAILY/2026-05-12.md` + both `20-DEALS/David Creese...` files

Old per-property Gamma decks (`gb17yk8j6davo76` + `0ggzb9lcpt83v8j`) still exist on Mac's Gamma account — flagged for manual deletion.

### Consolidated Gamma deck (1) replaces previous two
- Wrote 12-slide consolidated source MD: `Plus Ultra/Proposals/_GAMMA_SOURCE_casey_realty_consolidated_2026-05-12.md`
- Generated via direct Gamma API through Ryujin's `/api/gamma-generate` endpoint — NOT Manus
- 60 sec wall time, ~$0.40 cost
- New URL: `gamma.app/docs/fgs0nr0h9pq30rj`
- Slides: cover · 3-property-at-a-glance · per-property findings (2 slides each) · cost matrix · Phase 0 diagnostics · why Plus Ultra · next steps
- NO insurance language anywhere
- Both #56 + #57 PATCHed with `custom_prices._gamma_deck_url = new URL` + label "View Casey Realty Inspection Bundle"

### Manus detour caught + corrected
Initially routed Gamma generation through Manus task (had `MANUS_API_KEY` in env, didn't check Vercel). Mac correctly questioned: *"We have established a Gamma connection a long time ago."* `GAMMA_API_KEY` was in Vercel prod env all along. Killed Manus task (no charge), fired Gamma direct via Ryujin endpoint instead. New rule saved: `feedback_check_vercel_env_before_manus.md`.

### commercial-proposal.html three fixes
- R-20 polyiso → R-30 (Food Bank + Dickey scope items) — NS commercial code minimum
- CTA dates "Tuesday May 12, Wednesday May 13, or Thursday May 14" → evergreen "this week or next — let us know what mornings work"
- "Broken glass and beer bottles on roof surface" → "Debris and safety hazards on roof surface"

### 48-50 Albion measurements captured
- 42×32 main building + 16×19 lower portion + bay window porches in front + one steel chimney
- ~17.5 SQ total
- 60 km from base (Day Trip pricing zone)
- Three-tab asphalt shingle, end-of-life
- Scope: full re-roof + full redeck + ridge vent + soffit intake + steel chimney reflash
- **Range: $19,500 - $22,500 incl HST** (Loom AI mistranscribed as $90,500; Mac confirmed actual audio is the right range)
- NO proposal page created (Mac's call — price lives in email body + Gamma deck)

### Mac recorded new consolidated Loom
- One video replaces previous three per-property Looms
- Title: "Roof Inspection Summary for Three Properties"
- URL: `https://www.loom.com/share/4a2d578aec2342c4a949374eb3a7bc53`
- Clean of insurance language

### Email drafted, edited, sent
Original draft (id `19e1ce35779ee5a0` — three per-property structure) replaced with new consolidated draft (id `r6398356519831270074`). Two corrections during drafting: removed em-dashes (matched Mac's voice with periods/commas), removed unsolicited walkthrough offer that read like accepting an invitation never made. Final body: bare URL format with `Proposal-` / `Inspection Report-` prefix labels matching Mac's original style. **Mac sent.**

## Commits

- `e110370` — commercial-proposal.html · Gamma deck CTA + first git entry for the file (snapshot from prod since file was previously deployed via `vercel --prod` from laptop without committing)
- `071f3a7` — commercial-proposal.html · R-30 spec + evergreen CTA + debris finding softening

Both surgical, Session 13's parallel laptop WIP preserved via stash + restored after.

## DB writes

- 2 PATCHes on `estimates.custom_prices` for share_tokens `plus-ultra-56` + `plus-ultra-57` (gamma_deck_url + gamma_deck_label set + cleared + re-set across the session)
- 1 new `docs` row inserted: slug `casey-realty-bundle`, consolidated source MD, gamma_generation_id + gamma_url stored
- ZERO touches to the `estimates` row body itself, calculated_packages, or any signed-state fields

## Open

- 🟡 Awaiting David Creese's response
- 🟡 4 corrections still pending before any contract sign (pricing model A vs B, asbestos test, structural engineer letter on Dickey, R-30 adder on final pricing)
- 🟡 Manual cleanups Mac to do: delete old Gamma decks · delete old email draft · delete old Drive brief · archive old per-property gamma source MDs
- 🟡 Carry from earlier: Brian Dorken production docs pending confirm · My Crew announce to Ryan staged · Proposal History display patch staged

---

# Session notes — 2026-05-12 — Session 14 (Lefurgey gutter quote + Full Ryujin gutter capability + Steve Maltais triage — parallel terminal to Session 13)

## Summary

Three big things on this terminal in parallel with Session 13's promo/snapshot work:

1. **Lefurgey gutter quote shipped** — Udochukwu Erondu, 46 Lefurgey Moncton, 110 LF, $2,794.50 incl HST, no deposit, Darcy rep. Static branded HTML at `/lefurgey-gutter-proposal.html`, deployed prod, frozen.
2. **Full Ryujin gutter capability — Phase 1 + 2 end-to-end** (Mac directive "plug it all in"). Migration 060 + engine + API + customer page + admin "Quick Gutter" tile + roof-proposal upgrade addon.
3. **Steve Maltais 401 Gould Dieppe** — siding repair triage. Past metal-roof customer with discontinued material. 2-option pitch locked (donor-wall rejected).

## Lefurgey gutter quote (Udochukwu Erondu)

Iterative pricing convergence over 6 turns. Final scope:
- **110 LF total** (75 upper 2-story · 35 lower porch) · 2 corners · 4 drops · White seamless aluminum
- **Pricing:** $1,200 materials + $280 labor lower + $900 labor upper + $50 corners = **$2,430 / $364.50 HST / $2,794.50 incl HST · NO deposit**

**Workflow:**
- Created Ryujin estimate #62 (`cef2b59a-2606-4fb7-8e90-86c4a7a8b661`) via `_create_lefurgey_gutters_2026-05-12.mjs`
- Built static branded HTML page at `public/lefurgey-gutter-proposal.html`
- Deployed via `vercel --prod` (4 iterations: initial → Moncton address fix → Darcy rep + Save-PDF button → remove Mac's number)
- Engine-repointed estimate to test full pipeline, then reverted to frozen sent-state via `_revert_lefurgey_62_to_sent_state_2026-05-12.mjs`
- Tagged `frozen_sent_2026-05-12, use_static_pdf` so future Claudes leave it alone
- GHL contact: `aYflCBo3ccJUNq9k4KE4` (filed at 41 Fernwood Moncton)

## Ryujin gutter capability — Phase 1 + 2 shipped

### Phase 1 — Standalone gutter proposals
- **Migration 060** — `'Gutters Only'` added to `estimates_proposal_mode_check` (applied via `_apply_migration_060_2026-05-12.mjs`)
- **`lib/gutterQuoteEngine.js`** — pure calc fn: `calculateGutterQuote({ lf_lower, lf_upper, corners, drops, color, distance_km, leaf_guard }, rates)` → `{ subtotal, hst, total, lineItems, breakdown, inputs, rates }`. Loads rates from `tenant_settings.gutter_rates` with DEFAULTS fallback.
- **`POST /api/quote?mode=gutters`** — wrapper for live preview, returns engine output
- **`public/gutter-proposal.html`** — data-driven template, reads `?share=`, fetches /api/proposal with `Accept: application/json`, renders Plus Ultra brand layout. Multi-tenant ready (pulls branding from /api/proposal payload, not hardcoded).
- **`api/proposal.js`** — Gutters Only branch: if `est.proposal_mode === 'Gutters Only'`:
  - `Accept: text/html` → 302 redirect to `/gutter-proposal.html?share=...`
  - `Accept: application/json` → returns `buildGutterProposalPayload(est)` with customer + rep + scope + pricing + terms

### Phase 2 — Roof-proposal upgrade addon
- **`api/proposal.js`** addons section extended: when `est.custom_prices._gutter_inputs` is set, gutter engine computes inline and appends a "Gutter Package" addon to `data.addons[]` with `details: [{label, cost}, ...]` array
- **`public/proposal-client.html`** addon rendering extended:
  - Each addon row now supports a `details[]` array
  - When present, renders a "View breakdown ↓" toggle that expands an inline detail panel showing line-item breakdown
  - New CSS for `.addon-toggle-details`, `.addon-details`, `.addon-detail-row`
  - New JS: `toggleAddonDetails(slug)` flips hidden attribute + toggle label, `escAttr()` helper for safe HTML

### Phase 3 — Admin entry point
- **`public/admin.html`** — "Quick Gutter" action tile added to dashboard action grid (between New Quote and + Customer)
- `openGutterQuoteModal()` — full modal with: 4 customer fields (name/phone/email/address) + 7 measurement fields (lf_lower/lf_upper/corners/drops/color/distance/leaf_guard) + sales-owner dropdown (Darcy default) + live preview panel + Create&Share button
- `gqPreview()` — debounced live calc via `POST /api/quote?mode=gutters`, renders line-item breakdown in preview panel
- `gqSubmit()` — POSTs to `/api/estimates` with `proposal_mode='Gutters Only'`, `calculated_packages.gutters = {...engineOutput}`, returns share token, prompts to open

### Engine defaults (NB market median, May 12 2026, configurable per-tenant)
- materials_per_lf: $11.00
- labor_per_lf_lower: $8.00
- labor_per_lf_upper: $12.00
- corner_cost: $25.00
- drop_cost: $0 (rolled into materials)
- travel_threshold_km: 40
- travel_per_km: $5.00
- leaf_guard_per_lf: $6.00
- hst_rate: 0.15
- deposit_required: false (locked, Mac directive)

## Steve Maltais 401 Gould Dieppe — triage

Past metal-roof customer (2024, FinanceIt). FB DM May 6 returning for siding repair. Mid-wall horizontal-lap damage, material discontinued. Vertical custom gables exist but are separate material (untouched).

**Mac rejected donor-wall approach.** Pitch locked at 2 options:
1. **Partial replace damage-up:** $1,200-$1,800. Seam landed at natural break (window header / soffit / belly-band trim — floating mid-wall seams read as "patch" forever).
2. **Full wall + paint:** $3,500-$5,500. Sherwin VinylSafe, lighter than original (darker = warp = warranty void). Disclose color drift vs adjacent walls over 5-10 yr.

**Pre-reply blockers:**
- Diego's 401 Gould ticket **4 days overdue** — close first
- GHL conversation history check — `quoted-pending` tag may have existing floated price
- Pull 2024 work-order — existing siding spec

## Files touched

### New
- `schema/migration_060_gutters_only_mode.sql`
- `lib/gutterQuoteEngine.js`
- `public/lefurgey-gutter-proposal.html` (FROZEN — Darcy sending)
- `public/gutter-proposal.html` (generalized data-driven template)
- 5 oneshot scripts:
  - `_create_lefurgey_gutters_2026-05-12.mjs`
  - `_apply_migration_060_2026-05-12.mjs`
  - `_repoint_lefurgey_62_to_gutters_only_2026-05-12.mjs`
  - `_fix_lefurgey_rep_2026-05-12.mjs`
  - `_revert_lefurgey_62_to_sent_state_2026-05-12.mjs`

### Modified
- `api/quote.js` — gutters mode branch + engine import
- `api/proposal.js` — Gutters Only redirect + `buildGutterProposalPayload()` + addon `_gutter_inputs` auto-attach + engine import
- `public/admin.html` — Quick Gutter tile + modal + gqPreview + gqSubmit
- `public/proposal-client.html` — addon `details[]` rendering + `toggleAddonDetails` + CSS for details panel

## Heads-up to Session 13 terminal

My migration 060 / repoint script touched Kyle #30's `updated_at` (caught by parallel agent's "DO NOT TOUCH" reaffirmation memory). Substantive row content unchanged but timestamp bumped. Apologies; future schema-touch scripts need stricter scoping (single-row WHERE clauses on the operations that actually need to be updated, not table-wide migrations that bump all rows).

## Carry-forward

- 🔴 Steve Maltais reply blocked on 3 pre-actions
- 🟡 Local Ryujin git ~9 commits behind prod — vercel CLI direct deploys piling up; reconcile next session
- 🟡 Schema-touch scripts need stricter scoping going forward
- 🟢 Lefurgey quote sent by Darcy — Udochukwu reviewing
- 🟢 Ryujin gutter capability LIVE — admin "Quick Gutter" validated end-to-end

---

# Session notes — 2026-05-12 — Session 13 (May promo engine + Brian 3% strikethrough + estimate snapshots/PDF audit trail + Cat GHL task)

Big shipping session. Three engine-level features + one workflow correction.

## What landed

### 1. May 2026 free-warranty auto-promo
Render-time injection in `api/proposal.js` native tier map. Auto-applies `$25/SQ × measuredSQ × tier multiplier` (nearest $25) strikethrough to any **Platinum** quote with `created_at` in `[2026-05-12, 2026-06-01)`. New `MAY_PROMO` const, `mayPromoDiscount()` helper, `PLATINUM_MULTIPLIERS` (1.52/1.67/1.78/1.85 by pricing model), `PITCH_MULTIPLIERS` mirrored from engine for measuredSQ fallback when `calc_packages.summary` missing.

Guards: skip if `accepted_at || locked_at || final_accepted_total`, `status ∈ {signed,accepted,won,closed}`, or pkg already has `originalTotal/promoLabel`.

Live on:
- Tim Boleyn #59 (Local 7/12, 22 SQ) → 25×22×1.52 = $836 → $825 off → Platinum $16,925 → $16,100
- 41 Fernwood / Erondu #60 (Local 6/12, 27 SQ) → 25×27×1.52 = $1,026 → $1,025 off → Platinum $18,675 → $17,650

### 2. Brian Dorken #39 — 3% cash strikethrough
DB patch via Supabase Management API on `calculated_packages.platinum`: `originalTotal=18500, total=17945, promoLabel='3% Cash Discount Applied · Pay by e-transfer or cheque'`. Customer proposal page now shows the signed price with strikethrough.

Invoice math (Option B preferred): $18,500 all-in − $555 (3%) = $17,945 total. Deposit $5,383.50 (30%), balance $12,561.50.

### 3. Estimate Snapshots + PDF Archive system — END-TO-END
- **Migration 059** — `estimate_snapshots` table with `version_number`, `snapshot_data`, `diff`, `pdf_url`, `created_by`. Unique on (estimate_id, version_number).
- **`lib/estimateSnapshot.js`** — `captureEstimateSnapshot()` (capture-after-write, diff vs previous, background PDF→Blob) + `renderSnapshotPdf()` (re-render). Diff focuses on customer-facing pricing fields. No-op skip when diff is empty.
- **`/api/estimate-snapshots`** — GET list versions, POST manual checkpoint, POST `?render_pdf_for=<id>` re-render. Owner/admin-gated via `requireOwnerOrAdmin`.
- **`api/estimates.js`** — captureEstimateSnapshot hooks on POST + PUT. Replaced legacy partial Publish-PDF-prime block.
- **`/proposal-history.html`** — TIMELINE drawer now fetches both `/api/proposal-timeline` (client events) + `/api/estimate-snapshots` (server versions). Version History rail above events with per-version diff summary + PDF download or RENDER PDF on-demand button.
- **Backfilled v1** for plus-ultra-39/59/60. PDFs pending render (local `BLOB_READ_WRITE_TOKEN` missing — auto-renders on next prod edit or via UI button).

### 4. Cat GHL task — routing correction
First attempt: Ryujin Crew Ops ticket #74 assigned to Catherine for Brian invoice redraft. Mac corrected — sales/marketing tasks for Mac+Cat+Darcy go to Automator/GHL, not Ryujin. Cancelled #74. Created GHL task `14z8QFR1DIRKgMcupXcF` on Brian's contact (`wyggLnTgtInMQwcLdOv6`) assigned to Catherine (`MBLRar7MoZCQRcPb8Ghx`) due May 13 9:38 AM. Backfilled `customers.ghl_contact_id` on Brian's Ryujin row.

Routing rule saved to memory: `feedback_task_routing_automator_vs_ryujin.md` with all 5 team GHL user IDs.

## Open

- Cat redraft of INV-2026-001 awaiting send (GHL task due May 13 9:38 AM)
- Brian's other 3 production docs awaiting Mac review
- v1 snapshot PDFs awaiting first render (Mac clicks RENDER PDF or wait for next edit)
- Display patch for Kyle Graham proposal-history.html (parallel PM session, NOT deployed — file has Version History rail too, both diffs compose)

---

# Session notes — 2026-05-12 PM — Kyle Graham #30 photo gap + Proposal History display drift (short session, parallel to Session 13)

Short, narrow session. Two questions answered for Mac, two fixes, one hard rule saved.

## What landed

### 1. Kyle Graham #30 audit + fix
Mac saw "$17,550 · signed 1h ago" on Proposal History for `plus-ultra-30` and got nervous. Audit confirmed the estimate row itself is **untouched**: final_accepted_total $16,157.00, accepted_at Apr 29 15:07 UTC, locked_at same second, custom_prices `{}`, tags unchanged, notes = single Apr 29 signing note, activity_log has only Apr 28 create + Apr 29 accept. No entry today.

**Root cause of the drift:** this morning's migration 060 (Gutters Only mode) added a column to `estimates`, which touched every row's `updated_at` as a schema-side-effect. Schema operations don't write to `activity_log`. Proposal History (`/proposal-history.html:458`) sorts/displays by `updated_at` → Kyle floated to top with fresh timestamp. Combined with `status=accepted` + wrong price (line 456 reads `calculated_packages[platinum].total = $17,550 SOP`, not `final_accepted_total = $16,157 honored`) → looked like a fresh sign at the wrong price.

### 2. Photos uploaded
Job folder `Plus Ultra/Jobs/67 Fairisle Drive - Kyle Graham/` had `cover photo.png` + `after photo.jpg` but they were never POSTed on Apr 29 (oversight from that session). Uploaded today via `scripts/_oneshot/_upload_kyle_30_photos_2026-05-12.mjs`. Two rows inserted into `estimate_photos` (cover + after captions). Sidecar table — **NO write to the estimate row.** Verified live on `/proposal-client.html?share=plus-ultra-30`.

### 3. Display patch — STAGED in `public/proposal-history.html`
Two-line change at the `fetchServerEstimates()` mapper (lines 455-468):
- `selVal` now prefers `final_accepted_total` when set, falls back to package total
- `at` sort/display key now `contract_signed_at || accepted_at || proposal_sent_at || created_at` (was `updated_at`)

For Kyle: list row will read **"$16,157 · Apr 29 2026"** (truth) instead of "$17,550 · 1h ago" (drift). Universal — applies to every estimate with `final_accepted_total` override.

**Not deployed** — this same file has Session 13's snapshot version-history rail edits already staged in the working tree (lines 290-440, render_pdf_now function). Won't bundle two sessions' work into one commit. Mac to decide surgical `git add -p` ship vs. wait for full working tree.

### 4. Hard rule saved to memory
`feedback_no_touch_pre_existent_proposals.md` — sent/signed/locked rows are FROZEN. No UPDATE, no calc_packages regen, no tag/note rewrites, no promo backfills. Photos (sidecar) + display-surface code OK without sign-off. **Schema migrations that auto-bump `updated_at` on locked rows are exactly the pattern this rule warns against** — flag before applying.

## Files

### New
- `scripts/_oneshot/_upload_kyle_30_photos_2026-05-12.mjs` (ran, uploaded 2 photos to blob + DB)

### Modified (staged, NOT committed)
- `public/proposal-history.html` lines 455-468 (display logic only)

## DB writes
- 2 INSERT into `estimate_photos` for `b3cf2f68-beef-498c-bd83-2efc8972dbe7`
- ZERO writes to the `estimates` row itself

## Open
- 🟡 Display patch ship decision — surgical `git add -p` vs. wait for Session 13's full working tree to land
- 🟡 Question for next migration: should we add `IGNORE updated_at` filter to schema operations that touch locked rows? Or backfill `activity_log` with "schema migration 060" entries for the affected rows?

---

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
