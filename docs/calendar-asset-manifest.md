# Calendar Feature — Asset Manifest

Visual asset kit to build **`public/calendar.html`** (booking calendar), **`public/production-calendar.html`** (production calendar), and the shared **booking modal**, matched to the approved mockups. Aesthetic: dark near-black navy `#030611` base, neon cyan `#22d3ee` + teal accents, amber `#fb923c` (production warmth), with violet `#a78bfa` / green `#4ade80` / gold `#facc15` / red `#f87171` semantic accents. Headings in Orbitron; mono labels in Share Tech Mono; body in Inter.

## Conventions grounded in the existing repo
- SVG icons: ship inline (the back-button chevron and month-nav chevrons are already inline `<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">` in `production-calendar.html`). New icon SVGs follow the same 24x24, stroke-based, `currentColor` pattern so accent color is driven by the parent CSS class. Reusable ones can also drop into `public/assets/icons/` (dir exists, currently empty).
- Higgsfield raster illustrations: PNG/WebP under `public/assets/panels/` (heroes, e.g. existing `sales-hero.png`, `service-hero.png`) and `public/assets/images/` (empty-states, e.g. existing `empty-tickets.png`, `empty-projects.png`; badges `badge-*.png`). New calendar assets follow these exact folders/naming.
- CSS/gradient pieces: authored inline in each page's `<style>` (matches `.bg-ambient`, `.bg-grid` already in `production-calendar.html` and the `:root` token block in `calendar.html`).
- Weather currently uses raw emoji glyphs (`☀ ⛅ 🌧 ❄` etc.) keyed off Open-Meteo WMO codes. The mockup upgrades these to crisp SVG glyphs; this manifest specs the SVG replacements 1:1 against the existing `weatherTag()` code branches.

---

## 1. Service-type icons (booking calendar + booking modal)

Three customer/PU-bookable service types. 24x24 inline SVG, stroke-based, color inherited from event-type CSS class.

| # | Name | Type | Used in | Spec |
|---|------|------|---------|------|
| 1 | `ico-roof-inspection` | SVG icon | Booking calendar event cards, booking modal service picker, legend | Roof gable + magnifier lens overlay; cyan-tinted (`--cyan #22d3ee`). Marks "Roof Inspection" (customer-booked). |
| 2 | `ico-service-call` | SVG icon | Booking calendar event cards (service kind), booking modal service picker, legend | Wrench crossed over a roof eave line; amber (`--orange #fb923c`). Marks "Service Call" (customer- or PU-booked). Matches existing `.evt.service` orange accent. |
| 3 | `ico-site-inspection` | SVG icon | Booking calendar event cards, booking modal service picker (PU-only), legend | Clipboard + house outline; violet (`--violet #a78bfa`). Marks "Site Inspection" (PU-internal only). Matches existing `.evt.inspection` violet accent. |
| 4 | `ico-gcal` | SVG icon | Booking calendar event cards (gcal kind), legend | Simple calendar-grid glyph with a small "G" notch; green (`--green #4ade80`). Marks read-only Google Calendar pull-ins. Matches existing `.evt.gcal` green accent. |

---

## 2. Weather glyphs (production calendar — per-day weather pill)

SVG replacements for the current emoji set in `weatherTag()`. Each maps to a `.wx.<cls>` color treatment already defined. 16x16 inline SVG, two-tone (stroke + small accent fill).

| # | Name | Type | Used in | Spec |
|---|------|------|---------|------|
| 5 | `wx-clear` | SVG icon | Production calendar `.wx.clear` day pill | Sun disc + 8 rays; gold (`--gold #facc15`). Maps WMO code 0. |
| 6 | `wx-partly-cloudy` | SVG icon | Production calendar `.wx.cloudy` pill | Small sun behind a cloud; muted blue-white. Maps codes 1/2/3. |
| 7 | `wx-fog` | SVG icon | Production calendar `.wx.cloudy` pill | Three stacked horizontal wavy lines; muted blue-white. Maps codes 45/48. |
| 8 | `wx-drizzle` | SVG icon | Production calendar `.wx.rain` pill | Cloud + 2 short dashes; cyan (`#22d3ee`). Maps codes 51/53/55/56/57. |
| 9 | `wx-rain` | SVG icon | Production calendar `.wx.rain` pill | Cloud + 3 full droplets; cyan. Maps codes 61/63/65/80/81/82 (light/moderate). |
| 10 | `wx-rain-heavy` | SVG icon | Production calendar `.wx.heavy` pill | Cloud + dense droplet streaks; red (`--red #f87171`) — work-blocking. Maps heavy rain (precip ≥70) + freezing rain 66/67. |
| 11 | `wx-snow` | SVG icon | Production calendar `.wx.snow` pill | Cloud + snowflake/asterisks; white. Maps codes 71/73/75/77/85/86. |
| 12 | `wx-thunder` | SVG icon | Production calendar `.wx.heavy` pill | Cloud + lightning bolt; red — work-blocking. Maps codes 95/96/99. |

---

## 3. Scheduling / status icons (shared chrome + booking calendar + production calendar)

24x24 inline SVG, stroke-based, `currentColor`.

| # | Name | Type | Used in | Spec |
|---|------|------|---------|------|
| 13 | `ico-clock` | SVG icon | Booking-calendar event card `.evt-meta` time chip; booking modal time field; drawer "Time" row | Clock face, two hands; inherits chip color. 60-min slot indicator. |
| 14 | `ico-buffer` | SVG icon | Booking calendar slot rendering (60-min buffer band), booking modal availability hint | Clock with a hatched/half arc; muted gray (`--gray #6b7280`). Denotes the post-slot 60-min buffer (not bookable). |
| 15 | `ico-slot-full` | SVG icon | Booking calendar day header when 3/3 slots taken; booking modal disabled days | Calendar day with an X / "FULL" lock; gold→red. Enforces max-3-per-day visual. |
| 16 | `ico-live` | SVG icon | Production calendar in-progress job block; booking-calendar install card `LIVE` flag | Pulsing filled dot (animated via CSS); green (`--green`). Replaces inline `&#9679; LIVE` text. |
| 17 | `ico-notify` | SVG icon | Booking calendar `.notify-pill` ("notify customer"); drawer notify note | Bell with a small dot; gold (`--gold`). Replaces `&#9888;` glyph in `.notify-pill`. |
| 18 | `ico-priority-urgent` | SVG icon | Booking calendar service card (urgent), legend | Filled triangle warning; red (`--red`). Maps `.evt.service.urgent`. |
| 19 | `ico-priority-high` | SVG icon | Booking calendar service card (high) | Outline triangle warning; gold (`--gold`). Maps `.evt.service.high`. |
| 20 | `ico-status-open` | SVG icon | Service card status chip | Open circle; cyan. |
| 21 | `ico-status-accepted` | SVG icon | Production calendar `.event.accepted` (awaiting-schedule estimate) | Checkmark in circle; green (`--green`). Matches accepted-estimate legend swatch. |
| 22 | `ico-phone` | SVG icon | Booking-calendar/drawer phone `tel:` rows; service card | Handset; cyan link color. |
| 23 | `ico-map-pin` | SVG icon | Address rows in cards + drawer (`.evt-detail` address) | Location pin; muted dim text. |
| 24 | `ico-duration-days` | SVG icon | Production calendar multi-day job block; install card `Nd` chip | Calendar span / arrow-between-two-days; amber. Denotes estimated-completion span. |

---

## 4. Crew badges (production calendar + booking calendar crew view + booking modal)

Round-robin model: two production crews (Crew 1 Atlantic Roofing, Crew 2 In-House) and two booking inspectors (AJ, Diego). Existing code renders `.crew-dot` (single-initial colored circle) and `.crew-chip` (pill). The kit upgrades these to designed badges while preserving the color keys.

| # | Name | Type | Used in | Spec |
|---|------|------|---------|------|
| 25 | `badge-crew-atlantic` | SVG icon / CSS | Production calendar job block, booking calendar crew-view column head, drawer | Hexagonal crew badge, "A1" mark, cyan (`#22d3ee`) — Crew 1 Atlantic Roofing (subs). Color matches existing `CREW_ROSTER` atlantic key. |
| 26 | `badge-crew-inhouse` | SVG icon / CSS | Production calendar job block, booking calendar crew-view column head, drawer | Hexagonal crew badge, "C2" mark, gold (`#facc15`) — Crew 2 Plus Ultra In-House. Matches `plus-ultra` key color. |
| 27 | `badge-inspector-aj` | SVG icon / CSS | Booking calendar (round-robin inspector assignment), booking modal inspector field | Round avatar badge "AJ", teal accent ring. Booking-side inspector (AJ = Arielle per roster). |
| 28 | `badge-inspector-diego` | SVG icon / CSS | Booking calendar inspector assignment, booking modal inspector field | Round avatar badge "D", cyan accent ring. Booking-side inspector Diego. |
| 29 | `badge-crew-unassigned` | SVG icon / CSS | Booking/production cards with no crew bucket | Dashed-ring gray (`#6b7280`) "?" badge. Matches existing `.crew-chip.muted` "unassigned" state. |
| 30 | `crew-dot` | CSS-only | Both calendars, crew-view col heads, install card crew member list | Existing 14px (22px in col head) colored circle with white initial; spec'd here as the canonical generated style: `background:<crew.color>; border:1px solid rgba(0,0,0,0.4)`. Round-robin color drives fill. |

---

## 5. Nav / action icons (shared chrome)

24x24 inline SVG, stroke-based.

| # | Name | Type | Used in | Spec |
|---|------|------|---------|------|
| 31 | `ico-chevron-left` | SVG icon | Production calendar month-nav prev, back button | `polyline 15 18 9 12 15 6` (already in repo). Reuse verbatim. |
| 32 | `ico-chevron-right` | SVG icon | Production calendar month-nav next | `polyline 9 18 15 12 9 6` (already in repo). Reuse verbatim. |
| 33 | `ico-back-arrow` | SVG icon | Both calendars back/topbar button | Left arrow; white on the big-white back button (per Mac's UI rule, `.back` / `.btn-back`). |
| 34 | `ico-today` | SVG icon | Production "TODAY" jump button; booking range "Today" | Calendar with center dot/ring on current day; amber/cyan. |
| 35 | `ico-add-event` | SVG icon | Booking calendar FAB (`+`), booking modal trigger | Plus glyph; dark-on-cyan (matches `.fab` `#001218` on cyan gradient). Replaces text `+`. |
| 36 | `ico-view-day` | SVG icon | Booking calendar viewToggle "By day" | Single column / list rows; cyan when active. |
| 37 | `ico-view-crew` | SVG icon | Booking calendar viewToggle "By crew" | Two-column / people split; cyan when active. |
| 38 | `ico-range` | SVG icon | Booking calendar rangeSelector (Today/Week/Month/Quarter) | Bracketed span glyph; violet (`--violet`, matches active range button). |
| 39 | `ico-refresh` | SVG icon | Booking calendar `.refresh-meta` (auto-refresh every 3 min) | Circular-arrows refresh; muted text color. |
| 40 | `ico-external-link` | SVG icon | Drawer "Open in GHL" / "Open Google Cal" / "Open job" actions | Box + out-arrow; cyan. |
| 41 | `ico-edit-reassign` | SVG icon | Drawer "Reassign crew" (privileged) | Pencil / swap; cyan. |
| 42 | `ico-delete` | SVG icon | Drawer block "Delete" danger action | Trash can; red (`--red`, matches `.danger`). |
| 43 | `ico-close` | SVG icon | Drawer + booking modal close | X glyph; dim text. |

---

## 6. Empty-state illustrations (Higgsfield)

PNG, ~480x360, transparent or `#030611`-matched background, dark-navy + cyan/amber glow tone matching existing `images/empty-*.png` set. One per page context.

| # | Name | Type | Used in | Spec |
|---|------|------|---------|------|
| 44 | `empty-calendar.png` | Higgsfield illustration | Booking calendar day/crew board when range has zero events (replaces text `no events` / `No assignments in this range`) | Stylized empty calendar grid with a faint dragon-storm motif and cyan ambient glow; "nothing scheduled" mood, no text baked in. Lives `public/assets/images/`. |
| 45 | `empty-bookings.png` | Higgsfield illustration | Booking modal / day with no available slots | Calendar with soft cyan "open slot" outlines, inviting-to-book mood. |
| 46 | `empty-production.png` | Higgsfield illustration | Production calendar grid when month has zero scheduled WO/PS/estimates (replaces "LOADING/empty" text state) | Empty month grid with amber ambient glow + faint roof-truss linework; warm production tone. |
| 47 | `empty-weather.png` | Higgsfield illustration / SVG | Production weather pill fallback when Open-Meteo fails (currently silent) | Tiny muted "no forecast" cloud-with-dash glyph; gray. Optional small inline SVG acceptable instead of raster. |

---

## 7. Feature hero (Higgsfield)

| # | Name | Type | Used in | Spec |
|---|------|------|---------|------|
| 48 | `panel-calendar-hero.png` | Higgsfield illustration | Shared chrome — booking + production page hero band (parallels existing `panels/sales-hero.png`, `panels/service-hero.png`) | Wide cinematic banner: a glowing dragon-storm calendar grid over near-black navy `#030611`, cyan→teal energy sweeping into amber on the right edge (bridges booking-cyan and production-amber identities). 1600x400. Lives `public/assets/panels/`. Used as the masthead behind the Orbitron "Calendar" H1. |
| 49 | `panel-calendar-hero-narrow.png` | Higgsfield illustration | Mobile hero (booking + production) | 9:16-safe crop of #48 for `portal-mobile`-width hero; same palette. |

---

## 8. CSS-only / gradient pieces (shared + per-page)

Authored inline in each page `<style>`. No raster.

| # | Name | Type | Used in | Spec |
|---|------|------|---------|------|
| 50 | `bg-ambient` | CSS gradient | Both calendars (full-page fixed backdrop) | Radial amber `rgba(251,146,60,0.12)` top-left + faint red bottom-right over `linear-gradient(180deg,#060a14,#030611)`. Already in production-calendar; spec as shared. Booking variant swaps the lead radial to cyan `rgba(34,211,238,0.12)`. |
| 51 | `bg-grid` | CSS gradient | Both calendars (fixed overlay) | 60x60 px line grid `rgba(251,146,60,0.03)` (amber, production) / `rgba(34,211,238,0.03)` (cyan, booking), radial-masked to fade at edges. Already in production-calendar. |
| 52 | `glass-panel` | CSS (glassmorphic) | Calendar container, day columns, crew columns, topbar | `background:rgba(14,22,40,0.55–0.78); border:1px solid rgba(accent,0.16–0.24); border-radius:14px; backdrop-filter:blur(8–20px)`. Canonical glass treatment (matches `.calendar`, `.col`, `.topbar`, `.crew-col`). |
| 53 | `topbar-accent-line` | CSS gradient | Production topbar top edge | 1px `linear-gradient(90deg,transparent,#fb923c,#f87171,transparent)` at 0.5 opacity. Already present; booking variant uses cyan→teal. |
| 54 | `h1-gradient-text` | CSS gradient (text-fill) | Both page H1s | `linear-gradient(135deg,#fff 30%,#fb923c)` (production) / `linear-gradient(135deg,#e0e6f0 20%,#22d3ee 65%,#a78bfa)` (booking), `-webkit-background-clip:text`. Orbitron 900. Already in both. |
| 55 | `cal-month-grid` | CSS grid | Production calendar | 7-col `grid-template-columns:repeat(7,1fr)`, `grid-auto-rows:minmax(110px,auto)`, 1px amber cell borders, 6-week (42-cell) fill, today-cell amber wash. Already in production-calendar; spec as canonical. |
| 56 | `booking-day-grid` | CSS grid | Booking calendar (day view) | Responsive: 1 col (day), `repeat(7,minmax(180px,1fr))` (week ≥1024px), vertical stack (month/quarter). Driven by `body[data-view][data-range]`. Already in calendar.html. |
| 57 | `crewboard-grid` | CSS grid | Booking calendar (crew view) | 2-col `repeat(2,minmax(220px,1fr))`, collapses to 1 col <768px. One column per crew bucket. Already in calendar.html. |
| 58 | `event-accent-bar` | CSS | Booking calendar event cards | 3px left bar with `box-shadow` glow, color per event kind (`install` cyan / `service` amber / `inspection` violet / `gcal` green / `block` violet|gold|cyan). Already in `.evt::before`. |
| 59 | `wx-pill` | CSS | Production calendar day cells | Absolute top-right pill, per-`cls` color treatment (clear gold / cloudy muted / rain cyan / heavy red / snow white). Hosts weather SVG #5–12. Already in `.wx`. |
| 60 | `legend-dots` | CSS | Both legends | 8px glowing dots (booking) / 14px rounded swatches (production), one per type, colors as above. Already present both pages. |
| 61 | `fab-gradient` | CSS gradient | Booking calendar FAB | 54px circle, `linear-gradient(135deg,rgba(34,211,238,0.95),rgba(34,211,238,0.7))`, 2px cyan border, cyan drop-shadow. Hosts `ico-add-event` #35. Already in `.fab`. |
| 62 | `modal-glass` | CSS (glassmorphic) | Booking modal + detail drawer | `rgba(11,17,32,0.96–0.97)` panel, `rgba(2,5,12,0.78)` blurred backdrop mask, sheet-from-bottom on mobile / centered on desktop, 18px radius. Already in `.modal` / `.drawer`. |
| 63 | `crew-pick-swatch` | CSS | Booking modal crew radio picker | Selected-state tinted pills: `sel-plus-ultra` gold wash, `sel-atlantic` cyan wash. Extend to inspector AJ/Diego picks. Already in `.crew-pick`. |
| 64 | `notify-pill` | CSS | Booking calendar install cards + drawer | Gold-wash pill `rgba(250,204,21,0.18)` + gold border; hosts `ico-notify` #17. Already in `.notify-pill`. |
| 65 | `today-cell-highlight` | CSS | Both calendars | Cyan/amber border + soft glow on today's column/cell (`.col.today`, `.cal-cell.today`). Already present. |
| 66 | `multiday-block-span` | CSS | Production calendar | Spanning treatment for multi-day job blocks sized to estimated-completion timeline (continuous bar across consecutive day cells, amber `.event.wo` fill). Extends current single-cell `.event.wo` for the mockup's multi-day blocks. |

---

## Build notes
- **Reuse-first:** items #31, #32, #50–#62, #64, #65 already exist in the two pages' inline styles/markup — they are catalogued here so the mockup-match is complete, not net-new work.
- **Net-new SVG icons** (#1–#24, #33–#43) should be authored as inline 24x24 (16x16 for weather) stroke `currentColor` SVGs so the existing per-kind CSS color classes drive them with zero extra CSS.
- **Net-new Higgsfield rasters** (#44–#49) follow existing folder conventions: empty-states → `public/assets/images/empty-*.png`; heroes → `public/assets/panels/panel-calendar-hero*.png`. Keep palette on-brand (navy `#030611` + cyan/teal for booking, + amber for production) and bake no text into the art.
- **No invented features:** crews limited to Crew 1 Atlantic / Crew 2 In-House; inspectors limited to AJ + Diego; service types limited to Roof Inspection / Service Call / Site Inspection; slot model fixed at 60-min slot + 60-min buffer, max 3/day. No asset implies functionality beyond these.

### Relevant file paths
- `C:\Users\Owner\ryujin-wt-deploy2\public\calendar.html` (booking calendar + booking modal + detail drawer)
- `C:\Users\Owner\ryujin-wt-deploy2\public\production-calendar.html` (production month calendar + weather)
- `C:\Users\Owner\ryujin-wt-deploy2\public\assets\panels\` (hero rasters — destination for #48/#49)
- `C:\Users\Owner\ryujin-wt-deploy2\public\assets\images\` (empty-state + badge rasters — destination for #44–#47)
- `C:\Users\Owner\ryujin-wt-deploy2\public\assets\icons\` (empty; optional home for reusable SVG icons #1–#43)
