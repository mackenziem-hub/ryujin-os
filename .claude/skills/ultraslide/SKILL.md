---
name: ultraslide
description: "Build and iterate Ryujin visual slide decks, the in-house Gamma replacement. Layouts, stat cards, callouts, four data charts (bar, line, donut, funnel), flow diagrams, Higgsfield hero images, and a suggest-and-refresh review loop. Invoke when Mac asks to build, make, or iterate a deck, slide deck, presentation, component gallery, or to refresh / apply notes left on a deck. Default target is the Ryujin presentation.js engine; supports standalone single-file decks too."
---

# UltraSlide — the deck generator

The official, in-house deck engine. Replaces Gamma. Every deck is one HTML page of
`section.slide` blocks on the shared `presentation.js` engine, living inside Ryujin's
Proposal Generator catalog. Mac built the look over the calendar/redesign/AIA/Aetheria
decks; this skill makes it repeatable, with the hard rules baked in.

**Not for customer-facing roofing proposals** — those are the separate Custom Scope
Proposal Generator (`custom-proposals.html`). UltraSlide is internal/ops/strategy/
design-review/SOP/partner decks. (See `reference_ryujin_proposal_generator`.)

## Hard rules — non-negotiable

1. **Palette by audience. Pick one, hold it for the whole deck.** A mixed palette is an
   instant template-seam tell.
   - **Internal** (ops, SOP, strategy, design review): navy `#0e1a35` + gold `#facc15`. This is the default.
   - **Crew / admin** (anything a worker sees): navy + teal-mint `#2dd4bf` / `#0ea5e9`. (`feedback_grok_mockup_internal_portals`)
   - **Customer** (homeowner sees it): cream + royal-blue, Jewels visual rules, lock-in CTA. (`feedback_jewels_visual_rules`) — rare for this skill; usually use the Custom Scope generator instead.
2. **No em dashes or en dashes anywhere** — body, headings, captions, alt text, code comments. AI tell. Use commas, periods, or " · ". (`feedback_no_em_dashes`)
3. **Real numbers and real assets only.** No placeholder lorem, no invented stats. If a figure isn't known, ask or leave the slide out. Every claim should map to a real asset/number.
4. **One idea + ideally one number per slide.** Depth over density. If a slide has three points, it's three slides or a card grid.
5. **Verify before you call it done.** A deck isn't done until it renders headless with zero console errors and the charts actually draw (see Verification target).
6. **Ship the Ryujin way** (engine decks): `node --check` the extracted inline script, codex review, manual `npx vercel --prod --yes`, curl-smoke. Deploy is **Mac's call** unless he says ship it — branch protection + manual deploy are real. (`feedback_vercel_manual_deploy_required`, `feedback_codex_review_pr_gate`)
7. **Build outside OneDrive.** Work in your `ryujin-os` clone (a clean checkout outside any cloud-synced folder), never a cloud-synced tree. Fast-forward to origin/main first; check for parallel terminals before any git reorg. (`feedback_no_git_in_onedrive`, `feedback_check_parallel_terminals_before_reorg`)

## Invocation modes

- `/ultraslide <topic>` — build a new Ryujin engine deck (default).
- `/ultraslide refresh <slug>` — read the notes left on a deck, apply them as edits, re-verify, redeploy.
- `/ultraslide standalone <topic>` — build an AIA/Aetheria-style single-file deck with its own Vercel project (secondary mode, below).

## Build loop (engine deck — the default)

1. **Outline first.** Agree the slide list and the one number/idea per slide before writing. Pour energy here so the build one-shots. (`/boris`)
2. **Copy the scaffold.** `public/deck-ultraslide-kit.html` is the canonical component gallery + scaffold (layouts, stat cards, callouts, all four charts, flow, palette reference). For flow-heavy ops decks, `public/deck-calendar-workflow.html` is a good base too. Save as `public/deck-<slug>.html`.
3. **Build the slides.** `<section class="slide" id="...">` blocks with a `.slide-inner` wrapper. First slide is `.cover`. Add one `<a href="#id">` per slide to the `nav-dots`. Keep `<script src="/scripts/presentation.js?v=8" defer></script>` at the bottom — that's the whole engine, it auto-activates.
4. **Charts: copy from the kit, recompute coordinates.** The four chart types live as pure inline SVG (no JS, renders headless) in `deck-ultraslide-kit.html` slides 5-8, each with a scale-math comment:
   - **Bar** (slide 5): `bar top y = 320 - value*scale`, height `= value*scale`. Value labels above each column.
   - **Line** (slide 6): `point y = 320 - value*scale`, x evenly spaced; polyline + a faded-gold area `<path>` closed to the baseline.
   - **Donut** (slide 7): `r=50`, circumference `2*pi*50 = 314.16`; `stroke-dasharray="filled gap"` where `filled = pct/100*314.16`; `transform="rotate(-90 60 60)"` so it starts at 12 o'clock. Gold/teal/green to distinguish multiple rings.
   - **Funnel** (slide 8): horizontal bars, `width = count*scale`, centered `x = (vbWidth - width)/2`; conversion % between stages; brightest fill on the win stage.
   Recompute every coordinate for the real data — do not ship the sample numbers. Keep the `role="img"` + `aria-label` describing the real values.
5. **Visuals (Higgsfield).** For cover/`.media` hero images: `generate_image` with `nano_banana_pro`, 16:9 (cover) or 4:3 (`.media` panel). Save as webp under `public/assets/deck-<slug>/`, set as the panel/cover `background`. The kit cover is a CSS gradient (no asset) — fine when you don't want to spend credits. Customer renders never carry an address. (`reference_higgsfield_ui_asset_pipeline`, `before_after_no_address`)
6. **Catalog.** Add a card to `public/decks.html` in the grid (copy an existing `<a class="card">`; tag it appropriately).
7. **Recent-decks list.** Prepend the new deck to the brain's recent-decks list (`recent-decks.md`; owner machines that have the vault) (title, public/gated, live URL, date; trim the tail to ~8). LOAD/ql surface the top 3 with links, so Mac always has the last decks one click away.
8. **Verify, then hand off / ship.** Run the verifier (below). Show Mac the deck URL + screenshots. Deploy only on his go.

## Verification target (boris)

A deck is done when it renders headless with **zero console/page/request errors** and
every chart draws. Use the bundled verifier:

```
node ".claude/skills/ultraslide/verify-deck.cjs" deck-<slug>.html [slideNumsToShoot...]
```

It serves `ryujin-os/public` over http, walks every slide with the arrow keys (hash nav
is same-document and won't re-render), captures errors, and screenshots the slides you
name (default: first/middle/last). Read the screenshots to eyeball the charts — element
presence in the DOM is not proof they look right (a wrong scale renders clean but lies).
Also `node --check` the extracted inline `<script>` before pushing. (`feedback_node_check_api_handlers`)

The live deck URL after deploy: `ryujin-os.vercel.app/deck-<slug>.html`, listed at `/decks.html`.

## Suggest + save-refresh (the review loop)

This is how a deck iterates. Two halves:

**Suggest (in the deck).** Press **N** on any slide to drop a sticky note. Notes persist in
localStorage; when Mac (or Cat) opens the deck logged into Ryujin, they sync server-side to
the `deck_notes` table via `api/deck-notes.js` (migration 077, `requirePortalSessionAndTenant`).
Yellow = Mac's, gold = coaching, blue = revised copy. This is the collaborative review surface.

**Trigger (how the refresh starts).** Mac chose `ql`-surfacing over an in-deck button (a browser deck can't rewrite + redeploy itself). Every `ql` / `load` runs `scripts/list-deck-suggestions.mjs`, which lists decks with unaddressed user notes; surface them and offer to apply. Mac can also run `/ultraslide refresh <slug>` on demand. (CLAUDE.md ql/load protocol wires this in.)

**Save-refresh (`/ultraslide refresh <slug>`).** Pulls the notes back and turns them into the new deck:

1. **Read the notes** (no browser console needed — the service token is gated; this script uses the service key):
   ```
   node --env-file=.env.local scripts/read-deck-notes.mjs deck-<slug> plus-ultra
   ```
   (Run from a clone with a populated `.env.local`. Tenant defaults to `plus-ultra`.)
2. **Interpret each note as an edit** to `public/deck-<slug>.html` (copy change, slide add/remove/reorder, data/chart-value update, layout swap). Show Mac a tight summary of the edits before applying, then apply.
3. **Re-verify** with `verify-deck.cjs` (zero errors, charts redraw) + `node --check` the inline script.
4. **codex review**, then redeploy on Mac's go (`npx vercel --prod --yes`), curl-smoke.
5. **Clear the addressed notes** so they don't re-apply next refresh: in-deck via the × button, or a session-authed `DELETE /api/deck-notes?deck=deck-<slug>&note=<clientId>`. List which notes you addressed.
6. **Recurring asks become memory.** If the same kind of edit keeps coming up (a phrasing rule, a layout preference, a chart style), write it to auto-memory as `feedback` so the next deck is built that way from the start. That's the "memory saves" half of the loop.

## Confidential mode (gated internal documents)

Decks with customer PII or financials (names, addresses, amounts) must NOT be public.
Ryujin deck URLs are unauthenticated-fetchable, so a normal `public/deck-*.html` would
leak. Confidential decks use the gated internal-document tool instead:

- The deck HTML lives at **`api/_decks/deck-<slug>.html`** (under `api/`, which Vercel
  never serves statically; the `internal-decks/` or `public/` path would still be
  fetchable, so do NOT use those). `vercel.json` `functions["api/internal-deck.js"].includeFiles = "api/_decks/**"` bundles it.
- **`api/internal-deck.js`** serves it through a two-layer gate: `requireOwnerOrAdmin`
  (owner/admin role) + a tenant-scope check against the **`DECK_OWNER`** registry
  (`{ '<slug>': '<tenant-slug>' }`, which also whitelists slugs). Add a new slug there.
- Viewed at **`/internal-deck.html?slug=<slug>`** (PII-free shell, only renders for a
  logged-in owner/admin of the owning tenant). Do NOT list it on the public `decks.html`.
- Notes still work: the shell injects `window.RYUJIN_DECK_ID = 'deck-<slug>'` so
  `presentation.js` keys notes correctly inside the iframe; `/ultraslide refresh` reads
  them via `read-deck-notes.mjs deck-<slug>`.
- Built 2026-05-31 (PR #160). First doc: `q2-numbers`. codex flagged six real issues
  on first build (static-exposure, tenant scope, srcdoc id, deep-link, session loop,
  open redirect) — gated financials are high-stakes, so review hard.

## Standalone mode (secondary)

For decks that want their own Vercel project and the auto-scaling 1280×720 stage (like
`aia-playbook-deck`, `aetheria-deck`): build a single self-contained file at
a `<slug>-deck/index.html` folder outside the repo. Pattern: a `#stage`/`#deck` scaled stage,
slides as absolutely-positioned `.slide.active`, simple arrow/dot/click-zone JS nav, the
navy + mint/blue gradient palette, Higgsfield bg images on key slides. Deploy with
`npx vercel deploy --prod --yes` from the deck folder; curl-verify 200.

Standalone decks have no server notes — refresh = Mac describes the edits in chat or pastes
exported notes. The four chart SVGs port directly; swap `--gold`/`#facc15` for the mint
`#2dd4bf` if you want them on-palette.

## Quick reference

- Engine: `public/scripts/presentation.js` (auto-activates on `.slide`; `DECK_ID` = filename, so each deck needs a unique name).
- Controls: arrows/Space/swipe = nav, S/Esc = scroll mode, F = fullscreen, N = note, `#slide-N` deep-links.
- Scaffold / gallery: `public/deck-ultraslide-kit.html`. Catalog: `public/decks.html`.
- Notes table: `deck_notes` (mig 077) · API: `api/deck-notes.js` · reader: `scripts/read-deck-notes.mjs`.
- Verifier: `~/.claude/skills/ultraslide/verify-deck.cjs`.
- Build clone: your `ryujin-os` checkout (not a cloud-synced folder).
