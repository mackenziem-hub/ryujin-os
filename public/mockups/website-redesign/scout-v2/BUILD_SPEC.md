# Plus Ultra "Scout-caliber" Homepage — BUILD SPEC (binding for every design direction)

Grounded in deep research on scoutmotors.com (built by Locomotive on Astro + React islands + Lenis/GSAP), the Apple canvas-sequence technique, Polestar/Saisei restraint, and an audit of the eight existing Plus Ultra scout mockups. No em dashes anywhere in output.

## The spine (LOCKED by Mac)
Hero = "the roof transforms old to new." As the user scrolls, a worn/old roof peels away and a premium new roof installs itself (top-to-bottom / shingle-by-shingle), landing on the finished home. This is the scroll-driven centerpiece, the roofing answer to Scout's drive-through-the-page vehicle. The transformation IS the hero.

## The mechanic (non-negotiable feel)
Pinned, scroll-scrubbed, perfectly reversible, silky. Scroll down advances the transformation, scroll up reverses it, locked to the scrollbar. Built on Lenis (smooth scroll) + GSAP ScrollTrigger (pin + scrub). NOT a plain video.

The transformation must be rendered SYNTHETICALLY (SVG / CSS / canvas) so the file is fully self-contained and runs on open with ZERO external image or video assets. No 404s, no broken hero. A stylized but genuinely beautiful house + roof illustration is expected, not a stick figure and not photography.

Lenis + GSAP integration (use exactly this wiring):
```js
const lenis = new Lenis();
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
```
Hero trigger: `ScrollTrigger { trigger:'.hero', start:'top top', end:'+=4000', scrub:0.5, pin:true }`. Drive the transformation progress (mask reveal / shingle draw / layer swap / SVG path draw) off the scrub progress. Reduced-motion (`prefers-reduced-motion`): collapse the scrub to the finished-roof state and show all text beats. Mobile (`max-width:920px`): drop the pin, show the finished state as a static full-bleed hero. Never scrub on a phone.

## Craft bar (the thousand-dollar-designer punch list, hit ALL)
1. ONE display typeface, used with restraint: tight tracking (-0.03em), large display sizes. A single grotesque (Sohne / Hanken Grotesk / Archivo / ABC Diatype register). NO second display face. NO condensed poster-slab (drop Anton).
2. TWO base colors + ONE accent only. Never a second accent. The reticle, links, and CTA all share the one accent.
3. A single NAMED, repeatable section-transition motif reused site-wide (a masked wipe / curtain / drone-parallax reveal) so the page reads as one crafted piece, not assembled blocks.
4. Silky smooth scroll (Lenis), mandatory. Wired through gsap.ticker + lagSmoothing(0).
5. Real nav choreography keyed to scroll (a weighted shrink/translate), not `scale(0.985)`.
6. LCP discipline: the hero paints fast (a real first-frame/poster image or instantly-drawn SVG). Reduced-motion + mobile fallbacks present.
7. Entrance reveals: translateY 24-28px + opacity, 0.8s, ease `cubic-bezier(0.16, 1, 0.3, 1)`.
8. Hover: lift translateY(-3px) 0.3s; image scale 1.02 to 1.08 over ~1.1s.
9. Generous negative space, editorial restraint. Let the transformation own the frame.
10. Page-load choreography: a brief masked intro wipe on first load.

## Section flow (top to bottom)
1. Glass floating nav (pill, blur over the hero; brand left, ~4 links, ONE solid CTA "Get my instant estimate").
2. HERO, the pinned scroll-scrubbed roof-transforms-old-to-new stage, with 2-3 cross-fading text beats over it (only one beat dominant at a time). Suggested beats: "Most roofs fail in winter." then "Ours don't." then "Built to go further beyond." + the two CTAs.
3. Trust bar, one quiet credential row (GAF/IKO, WorkSafeNB, 4.9 Google, fully insured). Restraint, no testimonial wall.
4. Differentiator, "Measured from the sky": a traced-roofline SVG + a measured-area readout, scroll-revealed. The one thing competitors lack.
5. Services, asymmetric feature grid (one large tile + four), not equal cards.
6. Process, 3 steps (measure from the sky / fixed price up front / install + document), image-paired.
7. Proof from above, drone before/after as a numbered horizontal carousel (a "1 / 5" pattern) inside the vertical scroll.
8. Single large testimonial pull-quote (one voice, premium beats a wall of quotes).
9. Closer, full-bleed, "10 Costly Mistakes" guide + instant-estimate CTAs.
10. Footer, dark/forest, contact, credentials.

Sections 3-10 may be tasteful skeletons. The HERO must be fully realized.

## Type scale
H1 `clamp(3rem, 8vw, 7rem)` line-height 1.0-1.04; H2 `clamp(2rem, 4.5vw, 3.4rem)`; body `clamp(1.05rem, 1.4vw, 1.25rem)` line-height 1.6; eyebrow 12.5-13px uppercase, letter-spacing 0.16em. `text-wrap: balance` on headings.

## Motion
Smooth scroll: Lenis, lerp ~0.1. Hero scrub: GSAP ScrollTrigger scrub 0.5, pin true. Entrance: the expo-out cubic-bezier above. Cap devicePixelRatio at 2 for any canvas. rAF-gate every scroll-coupled redraw; never mutate canvas/transform directly inside a raw scroll event.

## Company facts
Plus Ultra Roofing. Riverview / Moncton, New Brunswick. Premium residential roofing. Phone (506) 616-4607 (customer-facing OK). Brand energy: "Plus Ultra / Go Beyond." Real differentiator: measured from the sky + fixed price + documented install.

## Deliverable (per direction)
ONE self-contained HTML file (vanilla HTML/CSS/JS + Lenis + GSAP + ScrollTrigger from CDN). No build step. Runs on open in a browser with NO external assets and NO JS console errors. The roof-transforms-old-to-new pinned scroll hero must actually work (correct pin + scrub, reversible). Make it look like a thousand-dollar designer made it.
