# Session notes — 2026-05-24 evening — 4 in-house jobs staged + 3 hotfix PRs + paysheet hygiene cleared

**What:** Mac walked the cockpit and surfaced the gap: pipeline data sat in GHL + Ryujin estimates + WORK_LOG but nothing turned "Mac says X signed" into a kanban card. Plus a 3-day photo-delete frustration. He delegated full execution ("you do everything, I'm handling installs") and I cleared 4 signed jobs end-to-end + shipped 3 hotfix PRs + cleared morning's stuck paysheets in one session.

## What shipped

### PRs
- **#33 photo-delete** — `.ptile { overflow:hidden }` was clipping the 5th menu item (Delete photo) below tile boundary. Moved clip to inner `.pthumb`, added `:has(.pmenu.on) { z-index:20 }`. 3-line CSS change. Mac's 3-day frustration.
- **#34 drawer-pipeline-suggestions** — HAL agent (3 codex passes). Adds `[STAGE]` rows to Workspace Drawer Tasks tab, deep-links to admin-pipeline.html#suggestion-<id>. Patched pre-existing Bearer-token auth bug on admin-pipeline.html in same PR.
- **#35 before-after-trio** — three paper cuts: BACK button dropping to /hub on `?estimate_id=` path, cross-origin download anchor ignoring download attribute on Vercel Blob, "colored boxes" output from HEIC sources masked by sharp's failOn:'none'. All three in one diff.

### DB writes (via _oneshot scripts)
- `stage_in_house_jobs_2026-05-24.mjs` — created Plus Ultra Crew sub row + 4 customers + 4 WOs + 4 paysheets + Roger lightweight estimate PU-75. Flipped Egbuwoku PU-37 + Shelley #62 to accepted.
- `paysheet_hygiene_runner_2026-05-24.mjs` — flipped Shelagh/Kyle/Donna/Pardy paysheets to completed + Shelagh + Kyle WOs to complete. (Note: WO status enum uses `complete` no -d, paysheet uses `completed`. Burned a cycle.)
- `correct_staged_jobs_2026-05-24.mjs` — corrected Brian to Platinum $17,945 at 1530 Route 475 (was Gold $16,200 with no street), Shelley to 37 Wilbur St (was 34 — typo from inspection booking). Both pulled from Obsidian deal files.

## Final WO state

| WO | Customer | Address | Start | Total | Tier | Estimate |
|---|---|---|---|---|---|---|
| WO-18 | Brian Dorken | 1530 Route 475, Wellington NB | Mon May 25 | $17,945 | Platinum + 3% | #39 accepted |
| WO-19 | Shelley Hope | 37 Wilbur St, Moncton NB | Fri May 29 (3d) | $12,370 | Gold | #62 accepted |
| WO-20 | Adedoyinsola Egbuwoku | 75 Rue Rachel, Shédiac NB | Wed Jun 3 | $13,570 | Gold | PU-37 accepted |
| WO-21 | Roger Moreau (shed) | 160 Riverbend Dr, Moncton NB | TBD | $1,092.50 | Gold shell | PU-75 new |

All assigned to Plus Ultra Crew sub row (`15f30fa1-119c-4ad3-ab54-53ebbfd50ac2`).

## Lessons saved

- **`.ptile { overflow:hidden }` clips kebab dropdowns** — move rounded-corner clip to inner thumbnail, bump z-index on `:has(.menu.on)`. Memory: `feedback_photo_kebab_clipped_by_overflow.md`.
- **vercel env pull encodes literal `\n` 2-char sequences inside quoted values** — local scripts must `.replace(/\\n/g, '')` when parsing .env.local. Memory: `feedback_vercel_env_pull_encodes_literal_newlines.md`.
- **Plus Ultra Crew sub row** is the in-house placeholder. Stays through any future external sub additions. Memory: `reference_plus_ultra_crew_sub_row.md`.
- **Workorders status enum is `complete` (no -d)**; paysheets use `completed`. Schema inconsistency caught by `workorders_status_check` violation.
- **`HEIC` source images** silently produce black panels under sharp's `failOn:'none'`; SVG overlay paints rectangles on top → "colored boxes with boxes inside" Mac saw. Magic-byte sniff + labeled error per PR #35.

## What's still loose

- Brian Monday weather call (rain forecast Sat night)
- Roger install date — set post-Mon color confirmation
- Server-side HEIC → JPEG transcode (follow-up to PR #35)
- Snapshot blob rebuild on next agent cron — kanban is honest, snapshot summaries reflect pre-staging state
- GHL opp creation gap for Egbuwoku + Roger

---

# Session notes — 2026-05-13 evening (late) — Production pillar live overview SHIPPED + cockpit orbit fix + HTML cache hardening + Codex review proves out

**What:** Late-evening focused session, three real wins layered on top of a structural discovery.

## What shipped (5 commits, all on origin/main, all deployed)
