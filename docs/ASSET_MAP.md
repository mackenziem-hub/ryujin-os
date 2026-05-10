# Ryujin OS — Asset Map (Updated May 9 2026 — Grok batch wired)

All assets live under `public/assets/`. This document is the single source of truth
for what exists, what each file looks like, and where it's wired in code.

---

## Design System Constants

```
Background:   #0a0e1a  (dark navy)
Accent cyan:  #4a9eff
Purple mode:  #8b5cf6
Orange mode:  #f97316
Text:         #e0e6f0
Success:      #4ade80
Warning:      #fb923c
Danger:       #f87171
```

Theme: Japanese sea dragon, glassmorphism, ocean depth, caustic light.

---

## Directory Structure

```
public/assets/
├── logo/               Brand identity
├── textures/           Full-bleed backgrounds + overlay tiles
├── images/             UI illustrations, icons, badges, onboarding
├── videos/             Looping backgrounds + micro-animations
├── archetypes/         AI personality avatar videos (12 archetypes)
├── branding/           Orb / promo visuals
├── picker/             Agent picker loading states
├── _review/            Unused alternates from Grok batch (safe to delete later)
└── voice/              Voice mode assets (placeholder)
```

---

## LOGO  `public/assets/logo/`

| File | What it looks like | Used in |
|------|-------------------|---------|
| `icon.png` (198K) | Cyan S-coil dragon symbol on dark bg | Favicon, PWA manifest, splash screen |
| `wordmark.png` (85K) | "RYUJIN" bold block text | Navbar (`index.html` nav) |
| `logo-full.png` (177K) | Combined icon + wordmark | Splash / landing hero |
| `logo-glow.jpg` | Glowing dragon R mark (fallback) | Fallback if icon.png missing |
| `wordmark-glow.jpg` | Glowing wordmark (fallback) | Fallback if wordmark.png missing |
| `logo-full.jpg` | Full logo JPG (fallback) | Fallback if logo-full.png missing |
| `logo-dragon-r.jpg` | Dragon R mark alternate | Spare |

### Implementation pattern (navbar)
```html
<img src="/assets/logo/wordmark.png" alt="RYUJIN OS"
     onerror="this.style.display='none';this.nextElementSibling.style.display='inline'">
<span class="nav-name" style="display:none">RYUJIN OS</span>
```

---

## TEXTURES  `public/assets/textures/`

| File | What it looks like | Used in |
|------|-------------------|---------|
| `app-bg.png` (132K) | Dark underwater caustic light, 1168×784 | `admin.html` body background |
| `login-bg.png` (141K) | Dark stormy atmospheric ocean, 1168×784 | `login.html` .bg-anim |
| `card-overlay.png` (88K) | Subtle dot grid / dragon scale pattern, 1168×784 | Glassmorphic card `::after` layer |
| `wave-divider.png` (169K) | Cyan wave line on light bg, 1168×784 | Section dividers |
| `dragon-watermark.jpg` | Faint dragon watermark (existing) | Spare |
| `hero-ocean.jpg` | Ocean hero scene (existing) | Spare |
| `storm-bg.jpg` | Storm background (existing fallback) | Fallback for app-bg |
| `login-bg.jpg` | Login bg JPG (existing fallback) | Fallback for login-bg.png |

### Implementation patterns
```css
/* Layered background — silently skips missing layers */
body {
  background:
    url('/assets/textures/app-bg.png') center/cover no-repeat fixed,
    url('/assets/textures/storm-bg.jpg') center/cover no-repeat fixed,
    radial-gradient(ellipse at 20% 50%, #1a2a4a 0%, #0a0e1a 100%);
}

/* Card overlay — dragon scale at low opacity */
.card::after {
  content: '';
  background: url('/assets/textures/card-overlay.png') center/cover;
  opacity: 0.04;
  position: absolute; inset: 0;
  pointer-events: none;
}
```

---

## IMAGES  `public/assets/images/`

### Empty States (shown when list data is empty)

| File | What it looks like | Slot | Wired in |
|------|-------------------|------|---------|
| `empty-tickets.png` (97K) | Cyan dragon face line art, circular | I8 | `app.html` tasks empty, `production-tickets.html` |
| `empty-projects.png` (202K) | Blueprint floor plan, cyan lines | I9 | `app.html` projects empty, `production-jobs.html` |
| `empty-photos.png` (164K) | Camera/building icon in frame | I10 | `app.html` media empty grid |
| `empty-time.png` (113K) | Clock face with wave-line hands | I11 | `production-paysheet.html` empty match |
| `success-complete.png` (226K) | Green checkmark circle | I12 | `app.html` showTaskCompleteOverlay() |

```html
<!-- Empty state pattern -->
<div class="empty-state" id="tasks-empty" style="display:none">
  <img src="/assets/images/empty-tickets.png" alt="" style="width:160px;opacity:0.7">
  <p>No tasks assigned yet</p>
</div>
```

### Nav Icons (bottom tab bar, 24×24 rendered)

| File | What it looks like | Tab | Wired in |
|------|-------------------|-----|---------|
| `icon-tickets.png` (106K) | Clipboard + checkmark, cyan | Tasks | `app.html` bottom nav |
| `icon-calendar.png` (145K) | Calendar grid with dot markers, cyan | Clock | `app.html` bottom nav |
| `icon-projects.png` (173K) | House/building icon, cyan | Projects | `app.html` bottom nav |
| `icon-account.png` (61K) | Person silhouette + bar chart, cyan | Account | `app.html` (spare — not current nav slot) |

> ✅ **Nav icon set complete** — `icon-home.png` and `icon-photos.png` landed May 9 2026 (Grok batch). Auto-activated via existing `<img onload>` handlers in `app.html`.

```html
<!-- Nav icon pattern — SVG fallback always visible, PNG hides it on load -->
<img class="ryu-nav-icon-png" src="/assets/images/icon-tickets.png"
     style="display:none;width:24px;height:24px"
     onload="this.style.display='block';this.nextElementSibling.style.display='none'">
<svg viewBox="0 0 24 24"><!-- always-visible fallback --></svg>
```

### Status Badges (priority/status indicators on ticket cards)

| File | Color | Shape | Priority/Status |
|------|-------|-------|----------------|
| `badge-urgent.png` (121K) | Red #f87171 | Lightning bolt | URGENT |
| `badge-high.png` (136K) | Orange #fb923c | Flame / upward arrow | HIGH |
| `badge-open.png` (146K) | Cyan #4a9eff | Open circle outline | OPEN |
| `badge-active.png` (146K) | Green #4ade80 | Pulsing dot | ACTIVE / IN PROGRESS |
| `badge-done.png` (131K) | White #e0e6f0 | Checkmark in circle | DONE / CLOSED |

### Onboarding Illustrations (first-login flow, 784×1168)

| File | What it shows | Slide |
|------|--------------|-------|
| `onboard-tickets.png` (197K) | Phones with task/ticket UI | Slide 1 — Tasks |
| `onboard-calendar.png` (148K) | Calendar app view with schedule | Slide 2 — Schedule |
| `onboard-photos.png` (182K) | Dark phone + media interface | Slide 3 — Photos/Media |
| `onboard-metrics.png` (158K) | 75% circular gauge + bar charts | Slide 4 — Performance |

---

## VIDEOS  `public/assets/videos/`

Canonical slots (V1–V6) fall back to existing files if the canonical file is missing.
The browser tries each `<source>` in order.

| Canonical path | Status | Fallback | Used in |
|----------------|--------|---------|---------|
| `splash-loop.mp4` | ✅ landed May 9 | `dragon-logo-pulse.mp4` | `admin.html` cutscene |
| `hero-bg-loop.mp4` | ✅ landed May 9 | `ocean-caustics-bg.mp4` | `index.html` hero |
| `onboarding.mp4` | ❌ not yet | `onboarding-nav-cards.mp4` | First-login flow |
| `task-complete.mp4` | ✅ landed May 9 | `task-complete-checkmark.mp4` | Task done overlay |
| `notification-pulse.mp4` | ⏳ landed, not yet wired | none | Awaiting notification-UI hook |
| `login-bg-loop.mp4` | ✅ landed May 9 | `ocean-caustics-bg.mp4` | `login.html` bg |
| `level-up-effect.mp4` | ✅ landed May 9 | none | `ryujin-xp.js` showLevelUp() overlay |
| `achievement-unlock-toast.mp4` | ✅ landed May 9 | none | `ryujin-xp.js` unlockAchievement() toast (call `RyujinXP.unlockAchievement(name)` or dispatch `ryujin-achievement-unlock` event) |

**Existing videos (active fallbacks):**
- `dragon-logo-pulse.mp4` — Dragon R mark pulsing cyan glow
- `ocean-caustics-bg.mp4` — Caustic underwater light patterns (32MB, main hero fallback)
- `task-complete-checkmark.mp4` — Checkmark draw animation (22MB)
- `onboarding-nav-cards.mp4` — 4 cards slide up animation
- `deep-ocean-bubbles.mp4` — Rising bubble field, dark
- `vortex-spiral-loading.mp4` — Spiral loading animation
- `particle-dragon-network.mp4` — Dragon network particle effect
- `ocean-wave-energy.mp4` — Wave energy loop
- `backround scrolling dragon.mp4` — Scrolling dragon background (13MB)
- `bacround cinematic update.mp4` — Cinematic background (32MB)
- `dragon-wireframe-panel.mp4` — Wireframe dragon panel
- `activate-button-ripple.mp4` — Button ripple animation
- `production cinematic.mp4` — Production cinematic (3MB)

```jsx
/* Video background pattern */
<video autoPlay muted loop playsInline
  poster="/assets/textures/storm-bg.jpg"
  style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',opacity:0.6}}>
  <source src="/assets/videos/hero-bg-loop.mp4" type="video/mp4" />
  <source src="/assets/videos/ocean-caustics-bg.mp4" type="video/mp4" />
</video>
```

---

## ARCHETYPES  `public/assets/archetypes/`

12 AI personality archetypes. Each has an active video + a standby loop.

| Archetype | Files |
|-----------|-------|
| Caregiver | `caregiver.mp4`, `caregiver-standby.mp4` |
| Creator | `creator.mp4`, `creator-standby.mp4`, `creator.jpg` |
| Everyman | `everyman.mp4`, `everyman-standby.mp4` |
| Explorer | `explorer.mp4`, `explorer-standby.mp4`, `explorer.jpg` |
| Hero | `hero.mp4`, `hero-standby.mp4` |
| Innocent | `innocent.mp4`, `innocent-standby.mp4`, `innocent.jpg` |
| Jester | `jester.mp4`, `jester-standby.mp4`, `jester.jpg` |
| Lover | `lover.mp4`, `lover-standby.mp4` |
| Magician | `magician.mp4`, `magician-standby.mp4` |
| Outlaw | `outlaw.mp4`, `outlaw-standby.mp4` |
| Ruler | `ruler.mp4`, `ruler-standby.mp4`, `ruler.jpg` |
| Sage | `sage.mp4`, `sage-standby.mp4`, `sage.jpg`, `sage.png` |

---

## BRANDING  `public/assets/branding/`

| File | Notes |
|------|-------|
| `orb.jpg` | Ryujin orb promo visual (current) |
| `orb-OLD-2026-05-09.jpg` | Previous orb version (archived) |

---

## Grok batch May 9 2026 — gamification + admin chrome (22 new images, wired)

These landed in the same Grok batch as the missing videos+icons. Each is now wired into the spot listed.

### Quest system (`admin-quests.html`)

| File | Wired as |
|------|----------|
| `quest-card-bg.png` | `.quest-card` bg with `background-blend-mode:overlay` |
| `quest-icon-daily.png` | `.quest-type.daily::before` glyph (11×11) |
| `quest-icon-campaign.png` | `.quest-type.campaign::before` glyph |
| `quest-icon-optional.png` | `.quest-type.optional::before` glyph |
| `quest-cat-sales.png` | `.quest-cat.sales::before` glyph |
| `quest-cat-marketing.png` | `.quest-cat.marketing::before` glyph |
| `quest-cat-ops.png` | `.quest-cat.ops::before` glyph |
| `quest-cat-finance.png` | `.quest-cat.finance::before` glyph |
| `quest-cat-customer.png` | `.quest-cat.customer::before` glyph |
| `quest-cat-strategy.png` | `.quest-cat.strategy::before` glyph |

### Power / XP (`admin-power.html` + `assets/ryujin-xp.js`)

| File | Wired as |
|------|----------|
| `xp-bar-empty.png` | `.hero-bar` background |
| `xp-bar-fill.png` | `.hero-bar-fill` background (blended w/ gradient) |
| `power-gauge.png` | `.hero::after` decorative gauge, right side, opacity 0.18 |
| `badge-locked.png` | `.ach-medal` background (locked achievements) |
| `badge-unlocked.png` | `.ach.unlocked .ach-medal` background |

### Agents (`admin-agents.html`)

| File | Wired as |
|------|----------|
| `agent-card-frame.png` | `.agent-card` frame overlay |
| `agent-report-bg.png` | `.drawer` (agent detail) background |

### Overview (`admin-overview.html`)

| File | Wired as |
|------|----------|
| `briefing-hero.png` | Morning Briefing section-head bg banner |
| `kpi-gauge-circle.png` | `.kpi-tile:nth-child(3n+1)::after` decorative motif |
| `kpi-gauge-bar.png` | `.kpi-tile:nth-child(3n+2)::after` decorative motif |
| `kpi-gauge-trend.png` | `.kpi-tile:nth-child(3n+3)::after` decorative motif |

### Crew tickets (`app.html`)

| File | Wired as |
|------|----------|
| `priority-urgent.png` | `.badge-urgent::before` glyph |
| `priority-high.png` | `.badge-high::before` glyph |
| `priority-normal.png` | `.badge-open::before` glyph |

### Other admin

| File | Wired as |
|------|----------|
| `simulator-frame.png` | `.scene-card` frame overlay (`simulator.html`) |
| `rule-editor-canvas.png` | Rule Editor launcher card bg (`admin-advanced.html`) |

---

## What's Still Missing

Priority order for next generation batch:

1. `videos/onboarding.mp4` — Branded onboarding loop (falls back to `onboarding-nav-cards.mp4`)
2. `textures/card-overlay.png` — May need a more transparent/subtle version (current at 88K may be too visible)
3. Notification UI hook — `videos/notification-pulse.mp4` is staged, awaits a slot in `app.html` nav badge or briefing-item badge

---

## _review/ Folder

Contains 33 unused alternates from the Grok generation batch + 4 grok-image PNGs
from previous chat sessions. Safe to delete the whole folder once you've confirmed
the placed assets look correct in the app. The `_sources/` subfolder has the originals
of every file that was placed into a canonical path.
