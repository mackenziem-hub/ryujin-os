# Design

Visual system for Plus Ultra customer-facing pages (the Jewels cream + royal-blue brand). Source tokens live in proposal-client.html and instant-estimator.html; this file is the contract they follow. Internal portals (Grok teal-mint) are a separate system.

## Theme

Light, warm paper field with deep royal-navy authority moments and a single gold action color. Scene: a homeowner on their phone at the kitchen table, daylight, deciding whether to trust a roofing company with $20K. The page is bright and calm; the navy moments (measurement, price) carry weight.

Color strategy: **Committed.** Navy carries the brand at the moments that matter (aerial measure, confirm, price reveal). Cream is the field, not the statement. Gold appears only on primary actions and the recommended tag.

## Palette

| Token | Value | Role |
|---|---|---|
| `--cream` | `#f8f4ea` | Page background (brand paper) |
| `--cream-dark` | `#efe7d4` | Recessed fills, image placeholders |
| `--paper` | `#fffaf0` | Cards, header, footer |
| `--paper-warm` | `#faf3e3` | Hover fills, soft panels |
| `--ink` | `#1a1f2e` | Headings, primary text |
| `--ink-soft` | `#3d3d3d` | Body text |
| `--ink-mute` | `#6a6a6a` | Captions, fine print (large sizes only) |
| `--pu-navy` | `#1a3a8c` | Brand royal blue: links, focus, selected states |
| `--pu-navy-deep` | `#0f2766` | Navy gradients, hover |
| `--navy-ink` | `#0c1d4d` | Darkest navy, moment-card gradients |
| `--pu-yellow` | `#fdcc02` | Gold action color: primary CTA, recommended tag, measure highlights. Nowhere else. |
| `--pu-bronze` | `#7a5a32` | Warm metallic accents, sparing |
| `--green` | `#0a8754` | Success, verified marks |
| `--danger` | `#c53030` | Errors |

Lines and shadows are warm-tinted, never pure gray: `rgba(26,58,140,0.14)` borders on cream, `rgba(60,40,20,…)` shadows.

## Typography

| Role | Font | Notes |
|---|---|---|
| Headings | **Montserrat** 600/700/800 | The Plus Ultra brand face (proposal, marketing clips). Tight but never below -0.02em tracking. |
| Body / UI | **Inter** 400/500/600/700 | Workhorse. 1.5-1.6 line height, 65-75ch max measure. |

No serif display faces on customer surfaces (Playfair was retired June 2026). Scale is modular, ~1.25 ratio; hero h1 `clamp(1.9rem, 5vw, 2.9rem)`. `text-wrap: balance` on h1-h3. No all-caps body or all-caps field labels; caps only for short tags 11px+ with moderate tracking.

## Components

- **Option cards** (`.opt`): white on cream, 1.5px warm border, 12px radius, generous padding, whole card tappable (44px+ target). Selected = navy border + navy tint + corner check. Hover lifts 1px.
- **Buttons** (`.btn`): navy fill, white text, 10px radius, `scale(0.97)` on `:active`. `.btn.gold` = gold fill + ink text for the ONE primary action per screen. Ghost = navy outline.
- **Moment cards** (measure confirm, price reveal band): navy gradient `linear-gradient(150deg, var(--navy-ink), var(--pu-navy))`, gold highlight numbers, white text at 85%+ opacity. These are the only dark surfaces on the page.
- **Progress**: numbered dots + connecting bars, navy active, green-check done. Labels hidden under 640px.
- **Photo treatments**: real Plus Ultra job photos only. Hero gets a bottom-up cream gradient so the photo stays visible (no full-bleed veils). Cards use 16:10 crops.

## Motion

Strong ease-out everywhere: `cubic-bezier(0.23, 1, 0.32, 1)` (ease-out-quint family). UI transitions 150-250ms. Step changes: 250ms fade+rise (6px). Nothing animates from `scale(0)`.

Signature moments (the only places motion exceeds 300ms):
1. **Aerial measuring sequence**: scan line sweep + status text cycle while the lookup is in flight (real latency, never faked), satellite tile crossfades in when ready, corner brackets lock.
2. **Price counter**: recommended price counts up ~900ms with ease-out-expo on first reveal, matching the price-counter ad family. Runs once.

`@media (prefers-reduced-motion: reduce)`: counters render final values instantly, scan sequence becomes a static panel with a spinner, step changes become crossfades.

## Layout

Single column, `max-width: 720px` form shell, 880px hero text. Fluid spacing with clamp. Mobile (375px) is the primary design target: full-width cards, 2-col option grids, sticky header slimmed.
