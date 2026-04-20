# Session notes — 2026-04-19

Autonomous overnight pass. Everything committed to `main` and deployed on Vercel. Summary of what happened across the day + night.

## Live URLs

- Sales page: https://ryujin-os.vercel.app/sales-client.html
- Proposal (client-facing): https://ryujin-os.vercel.app/proposal-client.html
- Proposal generator: https://ryujin-os.vercel.app/sales-proposal.html
- Jobs board: https://ryujin-os.vercel.app/production-jobs.html
- Work orders: https://ryujin-os.vercel.app/production-workorders.html
- Calendar: https://ryujin-os.vercel.app/production-calendar.html
- Materials: https://ryujin-os.vercel.app/production-materials.html
- Pay sheet: https://ryujin-os.vercel.app/production-paysheet.html
- Owner hub (full): https://ryujin-os.vercel.app/command-center.html
- Owner hub (laptop-safe): https://ryujin-os.vercel.app/command-center.html?lite=1
- Admin hub (classic, fastest): https://ryujin-os.vercel.app/admin.html

## What changed — sales & proposal

- Proposal demo now renders with real Plus Ultra CDN photos (cover, 2× before/after, 6-card showcase) and the Darcy intro video. Video aspect fixed for vertical mobile format (object-fit: contain).
- Default recommended tier is **Platinum** (was Gold).
- Accept section now reads "Your Investment" (was "Your selection") — Jewels framing.
- New **sales-client.html** page ported from renderSalesPageHTML: hero → personal letter → Darcy video → 3 trust cards → 4-step process → value stack (asphalt/exterior auto-switch) → gallery → testimonials (Steve V / Brad W / Tarah M) → about estimator → CTA "See Your Investment Breakdown" that forwards `?data=` to proposal-client.
- Green digital / Share Tech Mono labels near the bottom of the proposal toned down to Orbitron.

## What changed — production data flow

- `ry_v1_work_orders_v5` is now the single source of truth for work orders. Work orders, jobs board, materials, and pay sheet all read it.
- Crew roles corrected everywhere:
  - **Ryan (Atlantic Roofing)** — sub · primary installer on every pipeline job · also owns caulking + debris
  - **AJ** — Production Assistant + door setter
  - **Diego** — Operations Specialist (repairs + inbound sales calls, not installs)
  - **Pavanjot** — Laborer
- Added **178 Summerhill** (Apr 21-23) and **115 North St** (Donna Glen, Apr 28-30) to the WO seed. Arzaga flipped to status=active.
- Dead sample arrays removed: LEGACY_JOBS (materials), DEFAULT_WOS_OLD (workorders). −171 lines.

## What changed — jobs board (previously 5 panels of hardcoded mockup)

- Tickets: dynamic from WO store, sorted active → scheduled soonest → draft → complete.
- KPIs: Active / Scheduled / Needs Info / Pipeline $ / Deposits — all computed live.
- Crew Status panel: live roster, load % from open WO assignments (regex-matched against WO.crew).
- Material Orders panel: sums auto-generated material lists across open WOs, grouped by vendor.
- Pay Sheets panel: estimates pipeline at $75/SQ across install jobs, surfaces any draft in progress.
- 3-Day Schedule: auto-built from WO start dates + days field (multi-day shows day N/M).
- Alerts strip: dynamic — overdue scheduled, drafts needing scope, scheduled with SQ=0, active without phone. Shows ALL CLEAR when empty.
- Mark Complete now flips WO status to `complete` (was just opacity-dimming the card).

## What changed — calendar

- Live 5-day Moncton forecast via Open-Meteo (free, no API key), 1-hour localStorage cache.
- WMO weather codes mapped to icons + severity (alert / warn / default). Each row: Day · icon + condition + precip% · high/low °C.
- Dropped the "Coming soon — Environment Canada" stub.

## Performance work (command-center was glitchy on laptop)

- All background videos across command-center / login / boot / admin now use `preload="metadata"` — was default (often "auto"), meaning browsers eagerly downloaded 9-22MB files before the page finished parsing. Biggest single win.
- Command-center LOW_PERF mode: auto-triggers on mobile width < 900, prefers-reduced-motion, or save-data. Disables bg video, drops stars 2000 → 400, antialias off, pixelRatio capped at 1, autoRotate off.
- Per-machine Lite toggle via `?lite=1` URL → persisted in localStorage. Tiny chip bottom-left shows LITE · ON/AUTO/OFF.
- **Status: laptop was still laggy after lite mode. Switched to admin.html as daily driver.** Likely need to strip the CSS3D + OrbitControls render loop entirely for a "classic" fallback — not done tonight.

## Security

- Scanned repo + git history for committed secrets → clean.
- Removed plaintext password from auto-memory file.
- Added `.github/workflows/secret-scan.yml` (gitleaks) — runs on every push/PR.
- Vercel / Supabase / Anthropic / Blob tokens marked for your rotation via dashboards (not something I could do).
- `main-HAL` branch deletion attributed to a prior Claude Code worktree cleanup, not a breach.

## Photo migration script (awaiting your desktop)

- `scripts/upload-photos.js` + `scripts/photos-to-upload/` folder (gitignored).
- Workflow: download Drive "Photos - Before/ After" photos, drop in folder, run with `BLOB_READ_WRITE_TOKEN` env var, get back Blob URLs to paste into proposal-client.

## Known issues / TODO next session

1. **Command-center still laggy on laptop even in Lite mode.** Real fix: cut WebGL + CSS3D entirely and use CSS-only 2D hub, or make /command-center a `<iframe>` of admin.html on that device.
2. **Materials page** still uses `LEGACY_JOBS`-style sample data in one spot? Double-checked during dead-code sweep — the LEGACY_JOBS array was already removed, but the `POS` and `VENDORS` arrays below it (line 266+) are still hardcoded samples. Low impact (display only).
3. **Jobs board tutor (Ryujin.init)** — states still have generic follow-up choices. Could wire each state's action buttons to real effects (e.g., "Order EagleView" actually drafts the Gmail).
4. **331 Mountain Rd / Diaa proposal** is in the prior Claude Code session `b5db4715` transcript. Run `claude --resume b5db4715` from the ryujin-os directory to recover the payload.
5. **Materials page's `LEGACY_JOBS` was removed but the POS + VENDORS arrays below are still hardcoded samples.** Separate problem, lower priority.
6. **Three mockup pages on jobs board (Crew/Materials/Pay Sheets)** now live. 178 Summerhill + 115 North added but with `sq: 0, total: 0` — you'll want to edit in the real numbers.
7. **Materials overrides vs auto-generated list** — currently regenerates from SQ + tier every load. Saving edits → overrides key works, but edits are lost if the key is bumped (happens on seed changes). Consider moving overrides to be keyed by WO.num stably.
8. Weather forecast hardcodes Moncton NB lat/lon. Future: pull from `tenant_settings` postal code.

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
```
