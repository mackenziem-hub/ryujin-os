# Manus peer-review brief: feature/game-mvp

**Repo:** `mackenziem-hub/ryujin-os` (Vercel + Supabase, ESM Node serverless)
**Branch:** `feature/game-mvp` at commit `1a4d538`
**Base:** `origin/main`
**Diff:** see `docs/reviews/game-mvp-diff.patch` (1,540 lines, attach to the Manus task)

## Required model + mode

- **Model:** `manus-1.6-max` (not lite — lite hallucinates ~50% on discovery audits)
- **Mode:** evidence-required. Every finding MUST cite `file:line` and quote the exact code being flagged. No findings without quoted evidence.

## What's in this PR

A new optional 8-bit / cyberpunk-anime "game" UI for the Ryujin OS internal cockpit. It's gated behind `localStorage.ry_ui_mode === '8bit'`; the default cockpit is unchanged. Three files in scope:

1. **`public/game.html`** (new, ~1,380 lines, single-file HTML+CSS+inline JS)
   - 4 view states: TITLE → MAP → SECTOR → DIALOGUE overlay, plus PAUSE modal.
   - Renders live business data from `/api/snapshot`, `/api/me`, `/api/cc-presence`.
   - All asset refs use `/assets/rpg/**/*.webp` (49 files, all confirmed to resolve).
   - WebAudio chiptune SFX, FF6-style typewriter dialogue, mobile-responsive.
2. **`public/command-center.html`** (modified)
   - 8bit boot mode now `window.location.replace('/game.html')` instead of painting the cockpit shell with CSS classes.
3. **`scripts/optimize-rpg-assets.mjs`** (new, sharp-based)
   - Recursively converts PNG/JPEG under `public/assets/rpg/` → WebP siblings (max 1920×1080, q80, sharp effort 6, idempotent via mtime check).
   - Flags: `--rewrite-html`, `--delete-originals`, `--dry-run`.
   - Bundle reduction in this PR: 310.8 MB → 4.67 MB (98.5%, 49 files).

## Self-review already completed (DO NOT re-flag)

A pre-Manus self-review caught and fixed these — they are NOT bugs anymore, please don't surface them again:

1. **Snapshot consumer keys** — `state.snapshot = await r.json()` originally read top-level fields, but prod returns `{ sections: {...}, updated_at }`. Now unwrapped via `normalizeSnapshot()` at `public/game.html:608-628`. Verified against live prod payload.
2. **Pipeline shape** — prod returns `pipeline` as an array of deals, not an object. Reshaped inside `normalizeSnapshot` into `{ deals, totalValue, openDeals, top5_deals }` and filtered to exclude `lost|cancelled|won|signed` statuses before computing top5/totals.
3. **Alerts** — prod doesn't include an `alerts` array. Synthesized from `watchdog.tier1Count/tier2Count` inside `normalizeSnapshot`.
4. **Snapshot age** — `renderTopbar` was reading non-existent `s.timestamp`; now uses `state.snapshotAt` populated at fetch time.
5. **Em dashes** — all 11 stripped from `game.html` per CLAUDE.md rule 10.
6. **API_BASE on localhost** — extended file:// branch to also route to prod when host is localhost/127.0.0.1 (for local smoke-testing without `vercel dev`).
7. **NPC_PORTRAIT template literal** — manually patched from `.png` to `.webp` (the script regex excluded `)`, missed it; regex tightened for future runs).

## Constraints from CLAUDE.md (must hold)

- **Multi-tenant:** every API route uses `requireTenant()`. Snapshot is currently public (pre-existing); the game hardcodes `TENANT = 'plus-ultra'` at `game.html:527` — this is a known Plus-Ultra-tenant-1 MVP shortcut, **not a finding**. Flag only if you see other tenant-scope leaks.
- **Auth gate:** `requirePortalSessionAndTenant` pattern lives in `lib/auth-guard.js`. `/api/snapshot` and `/api/me` are pre-existing endpoints — do NOT review their auth; only review the game's *use* of them.
- **No em dashes** anywhere in code, comments, or UI strings. Already cleaned in game.html; please grep the diff and flag any I missed.
- **node --check** on every API handler with inline `<script>` extraction. game.html's inline script passes (verified locally).
- **No `git add -A`** patterns or secret leaks in the diff.
- **Visual aesthetic:** internal portals (this one) follow the Grok teal-mint mockup (`--accent:#2dd4bf` / `--accent-2:#0ea5e9`), NOT Jewels' cream + royal-blue (which is customer-facing only). game.html uses dark navy + cyan/gold/magenta accents — accept this as cyberpunk variant of the internal-portal aesthetic.

## Focus areas — please go DEEP on these

Rank findings P1 (must-fix before merge) / P2 (fix before public users see it) / P3 (style or low-impact).

### 1. Race conditions and async correctness (game.html)
- `boot()` fires `Promise.allSettled([fetchSnapshot, fetchMe, fetchCcSessions])` without awaiting; meanwhile `setTimeout(..., 2500)` reads `state.snapshot` and `state.snapshotErr`. Is the 2500ms window guaranteed to be after the first fetch resolves on a slow connection? What happens on a 5-second snapshot fetch?
- `setInterval(fetchSnapshot, 5*60*1000)` and `setInterval(fetchCcSessions, 30*1000)` — never cleared. Is that a real leak risk for a single-page session, or fine for the lifetime of the tab? Look for any view-mounting/unmounting that should cancel them.
- `fetchSnapshot` mutates `state.snapshot` and calls `renderMap`/`renderSector` based on `state.view`. If a second `fetchSnapshot` is in flight when the first returns late (network reordering), can stale data clobber fresh? Look for a request-supersession guard need.

### 2. XSS / injection (game.html)
- The `el()` helper at `public/game.html:586-597` uses `textContent`, `setAttribute`, `addEventListener`. Look for any place where snapshot-derived strings are concatenated into HTML attributes or `innerHTML`. Specifically `wizardsHere.map(w => w.user_label).join(', ')` injected as `title=` (line ~947) — what if `user_label` contains `"` or HTML entities? Is `setAttribute('title', ...)` safe here? (I believe yes, but please verify.)
- `dialogue body` typewriter — does it ever set `innerHTML` from snapshot data? Trace `openDialogue` and `advanceDialogue`.

### 3. Error paths and fallback UX
- What happens if `/api/snapshot` returns 500 or non-JSON? Game catches the error and sets `state.snapshotErr`, but renders never check for that — every sector card shows `loading…` forever. Is the "✓ live data ready · press start" → "⚠ offline mode" transition reachable? Trace it.
- What if `/api/cc-presence` 404s (it's not deployed yet on `main` — lives on a different branch)? `fetchCcSessions` catches and sets `state.ccSessions = []` — acceptable, but confirm no downstream code assumes the field exists in a specific shape.
- What if a `/assets/rpg/portraits/${npc}.webp` 404s (typo in NPC mapping)? The `<img>` will silently show alt text — is there a broken-image fallback we should add?

### 4. Keyboard input handling
- `document.addEventListener('keydown', ...)` at `public/game.html:1263-1312`. Are there focus-stealing risks if the user is typing in another input on the page? (Game doesn't have other inputs, but `dialogue` and `modal` are layered.)
- The `m` / `M` global mute toggle (line 1311) fires regardless of view, including during TITLE — is that intentional? Could it interfere with the `M` key meaning something else in modals?
- WASD movement only in MAP — does `state.focusedSector` clamp correctly on grid edges? 8 sectors, 4-column grid; `+4` from sectors 4-7 lands out of range (clamped to 7). But what about non-grid-aligned states?

### 5. Mobile / touch
- `user-select: none; -webkit-tap-highlight-color: transparent` on html/body. Is touch tap-through working on all 8 map hotspots? Trace event handlers on `.map-hot` — `onclick` is set, but no `ontouchstart`. iOS Safari sometimes needs explicit touch handlers.
- Audio context resume — WebAudio on mobile is gated until user gesture. Is `ensureAudio()` correctly called from a user-initiated event (click/keypress) before any beep?
- Title screen press-start: works on click? Trace `viewTitle` click handler.

### 6. Save persistence
- `localStorage.setItem(SAVE_KEY, ...)` swallows errors silently. If localStorage is full or disabled (incognito), every save attempt no-ops. Acceptable? Or should we surface a one-time toast?
- `state.save.dismissed_quests` grows unbounded over time. Is there pruning logic? If user dismisses 1000 quests over 6 months, does this hurt boot time?

### 7. `optimize-rpg-assets.mjs`
- The script is run *once* (or rarely) by Mac. Look for: argument parsing correctness (currently `args.has('--flag')`), idempotency claims (mtime comparison at `newerThan()`), and the deletion path. Specifically: `--delete-originals` deletes the source file AFTER writing the .webp — what if the write succeeded but the file is corrupt? No verification of the written bytes before deletion.
- The HTML rewrite regex `(\/assets\/rpg\/[^'"\\\s]+?)\.(png|jpe?g)\b` — does it correctly handle backticks in template literals? (Previously missed `${...}.png` because `)` was excluded; now fixed by removing `)` from the negated class.) Look for other escape edge cases.

### 8. The `command-center.html` boot change
- Old behavior: 8bit mode added CSS classes `perf-lite` + `mode-8bit` and set `window.__RY_8BIT__ = true`, then continued painting the cockpit.
- New behavior: 8bit mode calls `window.location.replace('/game.html')` and returns early, never paints the cockpit.
- **Question:** If `/game.html` is not deployed (i.e., `vercel --prod` hasn't run yet after merge), the user gets a 404 page instead of the cockpit. Is that the right failure mode, or should we feature-detect first? See `public/command-center.html:11-23` for the IIFE.

## Out of scope — don't review

- Anything else in `main` (other API routes, lib/, schema/, existing cockpit pages).
- The 49 binary WebP assets (treat as opaque, just confirm they're referenced).
- Untracked files in working tree (`api/cc-inbox.js`, `public/overworld.html`, `tools/`, etc.) — those belong to a different branch.

## Expected output schema (strict)

Return findings as JSON in this exact shape — Manus must produce a single JSON document with no preamble:

```json
{
  "branch": "feature/game-mvp",
  "commit": "1a4d538",
  "reviewer_model": "manus-1.6-max",
  "findings": [
    {
      "id": "F-001",
      "priority": "P1|P2|P3",
      "category": "race|xss|error|input|mobile|persistence|script|boot|other",
      "file": "public/game.html",
      "line_start": 1234,
      "line_end": 1245,
      "title": "one-line summary",
      "evidence_quote": "EXACT code copied from the file, verbatim",
      "explanation": "why this is a bug",
      "recommendation": "specific code change, with the replacement snippet",
      "false_positive_risk": "low|medium|high — explain why I might disagree"
    }
  ],
  "summary": {
    "p1_count": 0,
    "p2_count": 0,
    "p3_count": 0,
    "merge_recommendation": "merge|fix_first|reject"
  }
}
```

Drop the brief + the diff into Manus as a single task. Send the JSON back here when done.
