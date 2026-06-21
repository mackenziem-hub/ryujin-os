# Concepts — the ultraslide library

"Concepts" is Plus Ultra's folder of ultraslide decks (finance deep-dives, ad reviews, postmortems, sales playbooks, SOPs, process maps). Mac makes a lot of these, so they live in one named place.

## Where they live
- **The library page** is `public/decks.html`, branded "Concepts" (Administration -> Build -> Concepts). It lists every deck as a card, newest first.
- **New deck files** go in this folder: `public/concepts/deck-<slug>.html`, served at `https://ryujin-os.vercel.app/concepts/deck-<slug>.html`. Use ABSOLUTE asset URLs (https://...) inside them, never relative `deck-assets/` paths, so the subfolder location does not break images.
- **Older decks** created before 2026-06-21 stay at the repo root (`public/deck-*.html`) to preserve already-shared links. They are still listed on the Concepts page. Do not move them: several use relative `deck-assets/` paths that would break in a subfolder.

## The build convention (per the /ultraslide rule)
Every ultraslide PUBLISHES to Ryujin prod by default, then the live link is provided and opened. Build it, add its card to `decks.html` (top of the grid), commit both files, PR, merge, `vercel --prod`, verify the live URL, open it. Clone the newest self-contained cinematic deck for the house style.
