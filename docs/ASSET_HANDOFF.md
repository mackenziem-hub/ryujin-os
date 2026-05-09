# Ryujin OS — Grok Asset Generation Handoff

**Session Date:** May 9, 2026  
**Status:** All assets generated via Grok Imagine (grok.com/imagine)  
**Next Step:** Download each asset from Grok, save to the target paths below, then implement via Claude Code.

---

## HOW TO DOWNLOAD FROM GROK IMAGINE

1. Go to [grok.com/imagine](https://grok.com/imagine)
2. Scroll through your generation history
3. Click any image/video to open full-size view
4. Click the **download icon** (↓) on the right side panel
5. Save to the target file path listed below

---

## IMAGES — Already Generated

### Logo & Brand (I1–I3)
Generated in earlier session via Grok project chat.

| Asset | Target Path | Notes |
|-------|-------------|-------|
| I1 App Icon | `public/assets/logo/icon.png` | Abstract dragon coil, cyan, 512x512 |
| I2 Wordmark | `public/assets/logo/wordmark.png` | "RYUJIN" text, cool white |
| I3 Full Logo | `public/assets/logo/logo-full.png` | Icon + wordmark combo |

### Backgrounds (I4–I5)
Generated in earlier session via Grok project chat.

| Asset | Target Path | Notes |
|-------|-------------|-------|
| I4 App Background | `public/assets/textures/app-bg.png` | Dark navy, caustic light, 1920x1080 |
| I5 Login Background | `public/assets/textures/login-bg.png` | Dragon silhouette, atmospheric, 1920x1080 |

### Textures (I6–I7)
Generated this session via Grok Imagine — Image mode.

| Asset | Target Path | Prompt Used | Pick |
|-------|-------------|-------------|------|
| I6 Card Overlay | `public/assets/textures/card-overlay.png` | Dragon scale hexagonal pattern, 3-5% opacity | Best seamless tile variant |
| I7 Wave Divider | `public/assets/textures/wave-divider.png` | Cyan wave line, 3-4 crests, wide format | Best horizontal variant |

### Empty States (I8–I12)
Generated this session via Grok Imagine — Image mode.

| Asset | Target Path | Description |
|-------|-------------|-------------|
| I8 Empty Tickets | `public/assets/images/empty-tickets.png` | Dragon resting on ocean waves, cyan line art |
| I9 Empty Projects | `public/assets/images/empty-projects.png` | Blueprint floor plan in cyan, dragon watermark |
| I10 Empty Photos | `public/assets/images/empty-photos.png` | Camera icon with lens flare, photo placeholders |
| I11 Empty Time | `public/assets/images/empty-time.png` | Clock face with dragon tail hands, wave lines |
| I12 Success Complete | `public/assets/images/success-complete.png` | Green checkmark, cyan particles, dragon scales |

### Nav Icons (I13)
Generated this session via Grok Imagine — Image mode. 4 variants per icon; pick cleanest.

| Asset | Target Path | Description |
|-------|-------------|-------------|
| I13a Tickets Icon | `public/assets/images/icon-tickets.png` | Clipboard + checkmark, cyan line-art |
| I13b Calendar Icon | `public/assets/images/icon-calendar.png` | Calendar grid with dots, cyan |
| I13c Projects Icon | `public/assets/images/icon-projects.png` | House/building + gear, cyan |
| I13d Account Icon | `public/assets/images/icon-account.png` | Person silhouette + performance chart, cyan |

### Status Badges (I14)
Generated this session via Grok Imagine — Image mode.

| Asset | Target Path | Color | Shape |
|-------|-------------|-------|-------|
| I14a Urgent | `public/assets/images/badge-urgent.png` | Red #f87171 | Lightning bolt |
| I14b High | `public/assets/images/badge-high.png` | Orange #fb923c | Upward arrow/flame |
| I14c Open | `public/assets/images/badge-open.png` | Cyan #4a9eff | Open circle |
| I14d Active | `public/assets/images/badge-active.png` | Green #4ade80 | Pulsing dot + ring |
| I14e Done | `public/assets/images/badge-done.png` | White #e0e6f0 | Checkmark in circle |

### Onboarding Illustrations (I15–I18)
Generated this session via Grok Imagine — Image mode.

| Asset | Target Path | Description |
|-------|-------------|-------------|
| I15 Onboard Tickets | `public/assets/images/onboard-tickets.png` | Cascading task cards connected to crew avatar |
| I16 Onboard Calendar | `public/assets/images/onboard-calendar.png` | Week-view grid with colored task dots |
| I17 Onboard Photos | `public/assets/images/onboard-photos.png` | Phone → house → photo grid cascade |
| I18 Onboard Metrics | `public/assets/images/onboard-metrics.png` | Bar chart + percentage + trend arrow |

---

## VIDEOS — Generated This Session

All videos generated via Grok Imagine — Video mode (720p).

| Asset | Target Path | Duration | Description |
|-------|-------------|----------|-------------|
| V1 Splash Loop | `public/assets/videos/splash-loop.mp4` | 6s loop | Dragon mark pulsing cyan glow on dark |
| V2 Hero BG Loop | `public/assets/videos/hero-bg-loop.mp4` | 10s loop | Caustic light patterns, particle drift |
| V3 Onboarding | `public/assets/videos/onboarding.mp4` | 10s | 4 feature cards slide up, dragon logo |
| V4 Task Complete | `public/assets/videos/task-complete.mp4` | 6s | Green checkmark draws + cyan burst |
| V5 Notification Pulse | `public/assets/videos/notification-pulse.mp4` | 6s loop | Cyan dot radar ping animation |
| V6 Login BG Loop | `public/assets/videos/login-bg-loop.mp4` | 10s loop | Fading dragon silhouette + particles |

---

## DIRECTORY STRUCTURE TO CREATE

```
public/assets/
├── logo/
│   ├── icon.png          (I1)
│   ├── wordmark.png      (I2)
│   └── logo-full.png     (I3)
├── textures/
│   ├── app-bg.png        (I4)
│   ├── login-bg.png      (I5)
│   ├── card-overlay.png  (I6)
│   └── wave-divider.png  (I7)
├── images/
│   ├── empty-tickets.png   (I8)
│   ├── empty-projects.png  (I9)
│   ├── empty-photos.png    (I10)
│   ├── empty-time.png      (I11)
│   ├── success-complete.png (I12)
│   ├── icon-tickets.png    (I13a)
│   ├── icon-calendar.png   (I13b)
│   ├── icon-projects.png   (I13c)
│   ├── icon-account.png    (I13d)
│   ├── badge-urgent.png    (I14a)
│   ├── badge-high.png      (I14b)
│   ├── badge-open.png      (I14c)
│   ├── badge-active.png    (I14d)
│   ├── badge-done.png      (I14e)
│   ├── onboard-tickets.png (I15)
│   ├── onboard-calendar.png (I16)
│   ├── onboard-photos.png  (I17)
│   └── onboard-metrics.png (I18)
└── videos/
    ├── splash-loop.mp4        (V1)
    ├── hero-bg-loop.mp4       (V2)
    ├── onboarding.mp4         (V3)
    ├── task-complete.mp4      (V4)
    ├── notification-pulse.mp4 (V5)
    └── login-bg-loop.mp4      (V6)
```

---

## IMPLEMENTATION NOTES FOR CLAUDE CODE

### Priority 1 — Drop in immediately
- **I4 app-bg.png**: Replace the CSS radial gradient in `src/app/layout.tsx` or global CSS
- **I5 login-bg.png**: Use as `<video>` or `<img>` background on login page
- **I1 icon.png**: Replace favicon and PWA manifest icons
- **I2 wordmark.png**: Replace text "RYUJIN" in Navbar component

### Priority 2 — Component integration
- **I8–I12 empty states**: Add to respective list components when `data.length === 0`
- **I13 nav icons**: Replace inline SVGs in bottom tab bar
- **I14 badges**: Replace colored text badges in ticket/status components
- **I12 success**: Trigger as overlay when task marked complete

### Priority 3 — Polish
- **I15–I18 onboarding**: Wire into first-login onboarding flow
- **V1 splash-loop**: Use in PWA loading screen
- **V2 hero-bg-loop**: Use as `<video autoplay muted loop>` on landing page
- **V4 task-complete**: Trigger as micro-animation on task completion
- **I6 card-overlay**: Layer as `::after` pseudo-element on glassmorphic cards
- **I7 wave-divider**: Drop between content sections

### Video implementation pattern
```jsx
<video 
  autoPlay 
  muted 
  loop 
  playsInline
  className="absolute inset-0 w-full h-full object-cover opacity-60 pointer-events-none"
>
  <source src="/assets/videos/hero-bg-loop.mp4" type="video/mp4" />
</video>
```

### Image background pattern
```css
.app-background {
  background-image: url('/assets/textures/app-bg.png');
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
}
```

---

## GROK IMAGINE HISTORY REFERENCE

All assets are in your Grok Imagine generation history at:
**https://grok.com/imagine**

Scroll up in the history to find each generation batch. Each batch of 4 variants — pick the cleanest one per asset. For transparent-background assets, look for the checkered background pattern in the thumbnail.
