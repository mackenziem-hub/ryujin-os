# Product

## Register

brand

> Scope: this file governs CUSTOMER-FACING Plus Ultra surfaces (instant-estimator.html, proposal-client.html, photos-share.html, landing pages). Internal portals (portal-mobile, command-center, admin) follow the Grok teal-mint system instead and are out of scope here. Mixing the two registers is an instant tell.

## Users

New Brunswick homeowners, roughly 35-65, in Moncton / Riverview / Dieppe and surrounding towns. Most arrive on a phone from a Meta ad (the price-counter ad family). They expect contractor phone-tag and vague "free quote" forms; they want a real number without talking to anyone. Skeptical of pressure, responsive to proof. Secondary user: the spouse who gets the link texted to them and needs to trust it in 10 seconds.

## Product Purpose

The Instant Estimator is Plus Ultra's best lead generator. It converts an ad click into a qualified lead by trading contact info for a real, engine-priced 3-tier estimate, then books a 20-minute inspection. Success = form completion rate (8-10% industry average, 15%+ target) and booked inspections. The same skeleton will be cloned for the Go Nano rejuvenation estimator, so every pattern here must be reusable.

## Brand Personality

Confident, transparent, premium-trade. Plus Ultra is the contractor that shows you the number: fixed price, no upsell, CertainTeed certified (never GAF). The voice is direct and unhedged, no softener words ("just", "happy to", "no rush"), no em dashes anywhere. It should feel like a $20,000 contractor built this, not a SaaS startup: real jobs, real crew, real aerial measurement.

## Anti-references

- Generic AI landing-page grammar: uppercase tracked eyebrow kickers above every section, hero-metric templates, identical icon-card grids, gradient text.
- Typical roofing lead-gen sites: stock handshake photos, red "FREE QUOTE!!!" urgency, walls of trust badges.
- SaaS-cream minimalism: the cream palette here is the Jewels brand standard, not a default. It must read deliberate (committed navy moments, one gold action color), never like an unstyled warm-neutral template.
- Internal-portal teal-mint aesthetics leaking onto customer pages.

## Design Principles

1. **Show the number.** Transparency IS the brand. The price reveal is the hero moment of the page; everything before it builds to it, nothing hides it.
2. **Proof over promise.** Real Plus Ultra jobs (the lakeside drone shot, the crew-in-action shot), real Google reviews, real aerial measurement with the imagery year stated. Never stock, never implied.
3. **One job per screen.** Each step asks one thing, with big tappable answers. Progress is always visible. Mobile first at 375px.
4. **The measurement is magic, the math is honest.** Wow the homeowner with the aerial measure moment, then recap their inputs plainly and say what gets confirmed on site. Every wow degrades gracefully (fail-open) when an upstream API is missing.
5. **Premium trade, not tech demo.** Motion under 300ms with strong ease-out, one orchestrated reveal, no decorative chrome. If a detail does not build trust or move toward the price, cut it.

## Accessibility & Inclusion

WCAG AA contrast (4.5:1 body text). Every animation has a prefers-reduced-motion alternative (instant or crossfade). Tap targets 44px+. The flow must complete with JS-degraded aerial lookup (manual questions fall back with zero added friction). Forms use proper autocomplete attributes.
