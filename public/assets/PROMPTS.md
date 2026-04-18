# Ryujin OS — Grok Asset Generation Guide

---

## GROK PROJECT INSTRUCTIONS

Paste this into a Grok project to keep all generations consistent:

```
You are generating UI assets for Ryujin OS, a dark-themed SaaS web application.

BRAND:
- Ryujin = Japanese dragon god of the sea
- Theme: storm, ocean depths, dragon mythology — elegant and abstract, NEVER cartoonish
- Company: Ryujin Technologies Inc.
- Tagline: "Smart systems designed for you, by you."

DESIGN SYSTEM:
- Background: #0a0e1a (deep navy, almost black)
- Accent: #4a9eff (bright cyan — used for glows, highlights, active states)
- Text: #e0e6f0 (cool white)
- Success: #4ade80 (green)
- Warning: #facc15 (yellow)
- Urgent: #f87171 (red)
- High priority: #fb923c (orange)
- Surfaces: semi-transparent white (rgba 255,255,255 at 4-8%) with backdrop blur (glassmorphism)
- Borders: rgba(255,255,255,0.08)
- Border radius: 12px on cards, 6px on badges
- Font: Inter (geometric sans-serif)

STYLE RULES:
- All assets must work on dark backgrounds (#0a0e1a)
- Use transparent backgrounds (PNG) unless the asset IS a background
- Dragon motifs should be abstract geometric patterns, not fantasy illustration
- Ocean/water references should be subtle — caustic light, depth gradients, wave geometry
- Everything should feel like it belongs in a premium dark-mode app, not a fantasy game
- Flat illustration style for icons/illustrations, not 3D or photorealistic
- Glow effects should be subtle (15-25% opacity), not neon
- Assets are for embedding in a web app — they need to be clean, crisp, and functional

OUTPUT FORMAT:
- Images: PNG with transparent background (unless it's a background/texture)
- Textures/backgrounds: PNG, seamless tileable when specified
- Keep file sizes web-friendly — no unnecessary detail at edges
```

---

## IMAGES — Logo & Brand

### I1. App Icon / Logomark
- **File:** `logo/icon.png` (512x512, 192x192, 48x48 variants)
- **What it is:** Circular app icon with abstract dragon coil. Used as PWA icon, favicon, navbar logo.
- **Prompt:** `Flat minimal app icon. Abstract Japanese sea dragon coiled in a circle, formed from clean geometric lines — like a tech logomark. Cyan (#4a9eff) lines on transparent background. No shading, no gradients, no detail — just clean strokes suggesting a dragon form with scales implied by line spacing. Must read clearly at 48px. PNG, transparent background.`

### I2. Wordmark
- **File:** `logo/wordmark.png` (wide, ~400x80)
- **What it is:** "RYUJIN" text lockup for navbar and headers.
- **Prompt:** `The word "RYUJIN" in a clean geometric sans-serif typeface (similar to Inter or Manrope). Light blue-white (#e0e6f0) letters. The crossbar of the R has a subtle angular notch suggesting a dragon fang. No background, no glow, no effects — just clean crisp text. PNG, transparent background. Horizontal lockup for a navigation bar.`

### I3. Icon + Wordmark Combo
- **File:** `logo/logo-full.png` (wide, ~400x80)
- **What it is:** Dragon icon + "RYUJIN" text side by side. For splash screens and landing page.
- **Prompt:** `Horizontal logo lockup: on the left, a small circular abstract dragon logomark in cyan (#4a9eff), on the right the word "RYUJIN" in light blue-white (#e0e6f0) clean sans-serif. Consistent line weight between icon and text. Minimal spacing. PNG, transparent background. Should work at both 200px and 800px wide.`

---

## IMAGES — App Backgrounds & Textures

### I4. Main App Background
- **File:** `textures/app-bg.png` (1920x1080)
- **What it is:** The main app background. Dark with subtle depth — replaces the current CSS radial gradient.
- **Prompt:** `Dark abstract background for a web application. Base color #0a0e1a (deep navy). Subtle radial gradient from slightly lighter navy at center to pure dark at edges. Very faint ocean caustic light patterns (like light refracting through deep water) in cyan (#4a9eff) at about 5% opacity. No focal point, no objects — just ambient depth. Must not distract from UI elements layered on top. PNG, 1920x1080.`

### I5. Login / Splash Background
- **File:** `textures/login-bg.png` (1920x1080)
- **What it is:** More dramatic background for login/landing page. Still dark, but with visible dragon silhouette.
- **Prompt:** `Dark dramatic background for a login page. Base color #0a0e1a. In the lower half, a very faint abstract dragon silhouette formed from geometric lines dissolves into the darkness — visible but not distracting (about 8-10% opacity in cyan). Upper half has subtle storm cloud texture in dark grays. A single faint lightning-like line of cyan cuts diagonally across. Still primarily dark and functional — UI text must remain readable on top. PNG, 1920x1080.`

### I6. Card Texture Overlay
- **File:** `textures/card-overlay.png` (400x300, tileable)
- **What it is:** Subtle texture for glassmorphic card surfaces. Dragon scale geometry at very low opacity.
- **Prompt:** `Seamless tileable texture of abstract dragon scales. Geometric hexagonal pattern suggesting scales, rendered as thin lines at about 3-5% opacity in white on transparent background. The pattern is barely visible — it's meant to add depth to glassmorphic UI cards when overlaid. Clean, geometric, modern. PNG, transparent background, 400x400, seamlessly tileable.`

### I7. Section Divider — Wave Line
- **File:** `textures/wave-divider.png` (1920x4, or SVG)
- **What it is:** A subtle wave-shaped horizontal divider line for separating content sections.
- **Prompt:** `Thin horizontal decorative line shaped like a gentle ocean wave. Single stroke, cyan (#4a9eff) at 30% opacity, with a subtle glow. The wave has 3-4 gentle crests across a wide format. Clean vector-style, minimal. PNG, transparent background, wide aspect ratio (roughly 1920x20px). Used as a section divider in a dark web app.`

---

## IMAGES — Empty States & Illustrations

### I8. Empty State — No Tickets
- **File:** `images/empty-tickets.png` (300x300)
- **What it is:** Illustration shown when a crew member has no tickets assigned. Calm, encouraging.
- **Prompt:** `Flat illustration for an empty state in a dark web app. A calm ocean surface with gentle geometric waves in cyan (#4a9eff) line art. A small dragon silhouette rests peacefully on the water. The mood is calm and still — "nothing to do right now." Minimal, clean, flat vector style. No text. PNG, transparent background, 300x300px.`

### I9. Empty State — No Projects
- **File:** `images/empty-projects.png` (300x300)
- **What it is:** Illustration for empty projects list. Blueprint/planning theme.
- **Prompt:** `Flat illustration for an empty state in a dark web app. An abstract blueprint or floor plan rendered in thin cyan (#4a9eff) lines on transparent background, with a small dragon logomark watermarked in the corner. Suggests "ready to plan." Minimal geometric line art, flat vector style. No text. PNG, transparent background, 300x300px.`

### I10. Empty State — No Photos
- **File:** `images/empty-photos.png` (300x300)
- **What it is:** Illustration for empty photo gallery in a project.
- **Prompt:** `Flat illustration for an empty state in a dark web app. A simple camera icon made of clean geometric lines in cyan (#4a9eff) with a small lens flare. Below it, faint dashed rectangle outlines suggesting photo placeholders. Minimal flat vector style. No text. PNG, transparent background, 300x300px.`

### I11. Empty State — No Time Entries
- **File:** `images/empty-time.png` (300x300)
- **What it is:** Illustration for when no clock-in/out entries exist yet.
- **Prompt:** `Flat illustration for an empty state in a dark web app. A minimal clock face with clean geometric lines in cyan (#4a9eff). The clock hands form a subtle dragon tail shape. Small wave lines below suggesting calm water. Minimal flat vector style. No text. PNG, transparent background, 300x300px.`

### I12. Success State — Task Complete
- **File:** `images/success-complete.png` (200x200)
- **What it is:** Celebratory illustration when a crew member marks a task done.
- **Prompt:** `Flat illustration for a success state in a dark web app. A circular checkmark in green (#4ade80) with subtle particle effects radiating outward. Around the checkmark, faint abstract dragon scale patterns in cyan. Clean, minimal, satisfying. Flat vector style. No text. PNG, transparent background, 200x200px.`

---

## IMAGES — Nav & UI Icons

### I13. Tab Icons (set of 4)
- **File:** `images/icon-tickets.png`, `icon-calendar.png`, `icon-projects.png`, `icon-account.png` (48x48 each)
- **What it is:** Bottom nav tab icons. Currently inline SVGs — these would be polished replacements with subtle dragon/ocean DNA.
- **Prompt (generate each separately):**
  - Tickets: `Minimal flat icon of a task card/clipboard with a small checkmark. Clean geometric lines, cyan (#4a9eff) stroke on transparent background. 48x48px. Designed for a bottom navigation bar in a dark app.`
  - Calendar: `Minimal flat icon of a calendar page with a grid of dots. Clean geometric lines, cyan (#4a9eff) stroke on transparent background. 48x48px. Bottom nav icon for a dark app.`
  - Projects: `Minimal flat icon of a house/building with a small wrench or gear. Clean geometric lines, cyan (#4a9eff) stroke on transparent background. 48x48px. Bottom nav icon for a dark app.`
  - Account: `Minimal flat icon of a person silhouette with a small performance chart beside it. Clean geometric lines, cyan (#4a9eff) stroke on transparent background. 48x48px. Bottom nav icon for a dark app.`

### I14. Status Badge Icons
- **File:** `images/badge-urgent.png`, `badge-high.png`, `badge-open.png`, `badge-active.png`, `badge-done.png` (24x24 each)
- **What it is:** Small status indicator icons for ticket priority/status badges.
- **Prompt (generate each separately):**
  - Urgent: `Tiny flat icon: lightning bolt, red (#f87171), on transparent background. 24x24px. Clean geometric, single shape.`
  - High: `Tiny flat icon: upward arrow/flame, orange (#fb923c), on transparent background. 24x24px. Clean geometric, single shape.`
  - Open: `Tiny flat icon: open circle, cyan (#4a9eff), on transparent background. 24x24px. Clean geometric.`
  - Active: `Tiny flat icon: pulsing dot or spinning indicator, green (#4ade80), on transparent background. 24x24px. Clean geometric.`
  - Done: `Tiny flat icon: checkmark in circle, white (#e0e6f0) at 50% opacity, on transparent background. 24x24px. Clean geometric.`

---

## IMAGES — Onboarding & Feature

### I15. Onboarding — Ticket Management
- **File:** `images/onboard-tickets.png` (600x400)
- **What it is:** Feature illustration for onboarding carousel. Shows the ticket concept visually.
- **Prompt:** `Flat illustration for a feature showcase in a dark web app. A stack of 3 glassmorphic task cards arranged in a slight cascade, each with a colored status dot (cyan, green, orange). Thin lines connect them to a crew avatar silhouette. Abstract, clean, flat vector style. Cyan (#4a9eff) and white lines on transparent background. No text. PNG, 600x400px.`

### I16. Onboarding — Calendar View
- **File:** `images/onboard-calendar.png` (600x400)
- **What it is:** Feature illustration showing the week calendar concept.
- **Prompt:** `Flat illustration for a feature showcase in a dark web app. A minimal week-view calendar grid with colored dots on different days (cyan, green, orange) representing scheduled tasks. One day is highlighted with a subtle glow as "today." Abstract, clean, flat vector style. Cyan (#4a9eff) and white lines on transparent background. No text. PNG, 600x400px.`

### I17. Onboarding — Photo Documentation
- **File:** `images/onboard-photos.png` (600x400)
- **What it is:** Feature illustration showing the project photo upload concept.
- **Prompt:** `Flat illustration for a feature showcase in a dark web app. A phone silhouette with a camera viewfinder, pointing at a simple geometric house outline. Three small photo thumbnails cascade out of the phone into a grid. Abstract, clean, flat vector style. Cyan (#4a9eff) and white lines on transparent background. No text. PNG, 600x400px.`

### I18. Onboarding — Performance Metrics
- **File:** `images/onboard-metrics.png` (600x400)
- **What it is:** Feature illustration showing the crew performance dashboard.
- **Prompt:** `Flat illustration for a feature showcase in a dark web app. A minimal bar chart with 4 bars in varying heights (cyan, green shades). Above it, a large bold percentage number outline. A small upward trend arrow. Abstract, clean, flat vector style. Cyan (#4a9eff) and green (#4ade80) lines on transparent background. No text. PNG, 600x400px.`

---

## VIDEOS

### V1. PWA Splash / Loading Animation
- **Length:** 2-3 seconds (loop)
- **File:** `videos/splash-loop.mp4`
- **What it is:** Plays while the app loads. Dragon mark pulses with a subtle cyan glow on dark background. Simple, fast, lightweight.
- **Prompt:** `3-second looping animation. Pure dark navy (#0a0e1a) background. A minimal abstract dragon logomark in the center drawn with clean cyan (#4a9eff) lines. The mark pulses gently — a subtle glow expands and contracts like a slow heartbeat. Nothing else moves. Calm, minimal, premium. Designed as a loading screen for a mobile web app.`

### V2. Landing Page Hero Background
- **Length:** 8-12 seconds (seamless loop)
- **File:** `videos/hero-bg-loop.mp4`
- **What it is:** Subtle ambient motion for the landing page `index.html`. Dark ocean depth with slow movement — NOT dramatic, just alive.
- **Prompt:** `12-second seamless loop. Very dark abstract background (#0a0e1a). Slow-moving caustic light patterns (like light through deep water) drift gently across the frame in cyan (#4a9eff) at very low opacity (5-10%). Faint particle dots float slowly upward like deep-sea sediment. No objects, no focal point — just ambient depth and gentle motion. Must not distract from text and buttons overlaid on top. Designed as a website hero section video background.`

### V3. Onboarding Walkthrough
- **Length:** 15-20 seconds
- **File:** `videos/onboarding.mp4`
- **What it is:** Plays during first-login onboarding. Shows the 4 core features as animated cards appearing one by one.
- **Prompt:** `20-second animation on dark navy (#0a0e1a) background. Four glassmorphic cards enter one at a time from the bottom with a smooth slide-up and fade-in. Each card has a simple icon and label: 1) clipboard icon — "Tickets" 2) calendar icon — "Schedule" 3) camera icon — "Photos" 4) chart icon — "Performance". Cards arrange into a 2x2 grid. After all four appear, the Ryujin dragon logomark fades in at the center. Cyan (#4a9eff) accent color. Clean, minimal motion design.`

### V4. Task Complete Celebration
- **Length:** 2-3 seconds (one-shot)
- **File:** `videos/task-complete.mp4`
- **What it is:** Micro-animation that plays when a crew member marks a task done. Quick, satisfying.
- **Prompt:** `3-second one-shot animation. Dark background (#0a0e1a). A green (#4ade80) checkmark draws itself in the center with a swift stroke. On completion, a subtle ring of cyan particles bursts outward and fades. Small and contained — this plays inside a mobile app card, not fullscreen. Satisfying, quick, minimal.`

### V5. Notification Pulse
- **Length:** 1-2 seconds (loop)
- **File:** `videos/notification-pulse.mp4`
- **What it is:** Animated notification indicator. Small cyan dot pulses for new ticket assignments.
- **Prompt:** `2-second looping animation. Dark background (#0a0e1a). A small cyan (#4a9eff) dot in the center pulses — expanding a soft glow ring that fades out, then repeats. Like a radar ping or heartbeat. Very small and subtle. Designed as a notification indicator overlay in a mobile app.`

### V6. Login Page Ambient
- **Length:** 10-15 seconds (seamless loop)
- **File:** `videos/login-bg-loop.mp4`
- **What it is:** More atmospheric than V2. For the login screen — subtle dragon silhouette fades in and out in the background.
- **Prompt:** `15-second seamless loop. Dark navy background (#0a0e1a). A very faint abstract dragon silhouette (geometric line art, cyan at 5-8% opacity) slowly fades in over 5 seconds, holds for 3 seconds, then fades out over 5 seconds. Barely visible — more of a subliminal presence. Slow-drifting particle dots in the foreground. Atmospheric, mysterious. Designed as a login page video background with form fields overlaid.`

---

## ASSET SUMMARY

| # | Type | File | Size/Length | Where It Goes | Priority |
|---|---|---|---|---|---|
| I1 | PNG | logo/icon.png | 512x512 | PWA icon, favicon, navbar | CRITICAL |
| I2 | PNG | logo/wordmark.png | 400x80 | Navbar, headers | CRITICAL |
| I3 | PNG | logo/logo-full.png | 400x80 | Splash, landing | CRITICAL |
| I4 | PNG | textures/app-bg.png | 1920x1080 | Main app background | HIGH |
| I5 | PNG | textures/login-bg.png | 1920x1080 | Login page background | HIGH |
| I6 | PNG | textures/card-overlay.png | 400x400 | Card glassmorphism layer | MED |
| I7 | PNG | textures/wave-divider.png | 1920x20 | Section dividers | LOW |
| I8 | PNG | images/empty-tickets.png | 300x300 | Empty ticket list | MED |
| I9 | PNG | images/empty-projects.png | 300x300 | Empty project list | MED |
| I10 | PNG | images/empty-photos.png | 300x300 | Empty photo gallery | MED |
| I11 | PNG | images/empty-time.png | 300x300 | Empty time entries | LOW |
| I12 | PNG | images/success-complete.png | 200x200 | Task done state | MED |
| I13 | PNG | images/icon-*.png (x4) | 48x48 | Bottom nav tabs | HIGH |
| I14 | PNG | images/badge-*.png (x5) | 24x24 | Status/priority badges | MED |
| I15 | PNG | images/onboard-tickets.png | 600x400 | Onboarding slide 1 | MED |
| I16 | PNG | images/onboard-calendar.png | 600x400 | Onboarding slide 2 | MED |
| I17 | PNG | images/onboard-photos.png | 600x400 | Onboarding slide 3 | MED |
| I18 | PNG | images/onboard-metrics.png | 600x400 | Onboarding slide 4 | MED |
| V1 | MP4 | videos/splash-loop.mp4 | 2-3s loop | App loading screen | HIGH |
| V2 | MP4 | videos/hero-bg-loop.mp4 | 8-12s loop | Landing page hero BG | HIGH |
| V3 | MP4 | videos/onboarding.mp4 | 15-20s | First-login walkthrough | MED |
| V4 | MP4 | videos/task-complete.mp4 | 2-3s | Task completion micro-anim | MED |
| V5 | MP4 | videos/notification-pulse.mp4 | 1-2s loop | New assignment indicator | LOW |
| V6 | MP4 | videos/login-bg-loop.mp4 | 10-15s loop | Login page background | MED |

---

## COLOR REFERENCE

| Token | Hex | Usage |
|---|---|---|
| --bg | #0a0e1a | Every background |
| --accent | #4a9eff | Glows, highlights, active elements |
| --text | #e0e6f0 | Any text or primary strokes |
| --text-dim | rgba(200,220,255,0.5) | Secondary/muted elements |
| --green | #4ade80 | Success, completion, active status |
| --yellow | #facc15 | Warnings, metrics |
| --red | #f87171 | Urgent priority |
| --orange | #fb923c | High priority |

## GENERATION ORDER

1. **Logo set (I1, I2, I3)** — everything else references this
2. **Backgrounds (I4, I5)** — establishes the visual foundation
3. **Nav icons (I13) + Splash video (V1)** — core UI polish
4. **Empty states (I8-I12)** — fills gaps in the live app
5. **Onboarding set (I15-I18, V3)** — first-run experience
6. **Status badges (I14) + micro-animations (V4, V5)** — detail polish
7. **Remaining videos (V2, V6) + textures (I6, I7)** — finishing touches
