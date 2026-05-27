#!/usr/bin/env node
// One-shot cleanup. Reverses scripts/inject-print-button.mjs on every public/*.html
// page EXCEPT the proposal/document allowlist below. For the static proposal pages
// in the allowlist, swaps the broken window.print() button for a working
// /api/page-pdf?slug=<page> anchor.
//
// proposal-client.html and custom-proposal.html need dynamic URLs and are handled
// manually (their share-token / slug param is JS-resolved at runtime).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public';
const MARKER = 'pu-print-btn';

// Static proposal pages: swap button for working /api/page-pdf anchor.
// Filename → {slug, download} for the endpoint + download attr.
const STATIC_WIRE = {
  'tara-court-proposal':       { slug: 'tara-court-proposal',       download: 'Tara-Court-Proposal.pdf' },
  'tara-court-aphl':           { slug: 'tara-court-aphl',           download: 'Tara-Court-APHL-Proposal.pdf' },
  'proposal-715-rt-11':        { slug: 'proposal-715-rt-11',        download: '715-Rt-11-Proposal.pdf' },
  'lefurgey-gutter-proposal':  { slug: 'lefurgey-gutter-proposal',  download: 'Lefurgey-Gutter-Proposal.pdf' },
  'commercial-proposal':       { slug: 'commercial-proposal',       download: 'Commercial-Proposal.pdf' },
  'nanoseal-partnership':      { slug: 'nanoseal-partnership',      download: 'NanoSeal-Partnership.pdf' },
  'handbook-outside-sales':    { slug: 'handbook-outside-sales',    download: 'Plus-Ultra-Outside-Sales-Handbook.pdf' }
};

// Skip these files entirely — they are already wired correctly or need manual
// handling. Don't strip and don't re-wire.
const SKIP = new Set([
  'ranch-road-rejuvenation',   // already wired in prior commit
  'rejuvenation-template',     // already wired with tokens
  'proposal-client',           // dynamic share token, manual edit
  'custom-proposal'            // dynamic slug, manual edit
]);

// Match the full snippet: comment marker, style block, then either button or anchor
// (anchor variant exists on pages we already wired; this matches both shapes).
const SNIPPET_RE = /<!-- pu-print-btn -->[\s\S]*?<\/(?:button|a)>\s*/g;

const WORKING_SNIPPET = (slug, download) => `<!-- pu-print-btn -->
<style>
@media print { .pu-print-btn { display: none !important; } }
.pu-print-btn { position: fixed; top: 16px; right: 16px; z-index: 99999; background: #0f172a; color: #fff; border: 0; padding: 8px 14px; font: 600 13px system-ui, -apple-system, Segoe UI, sans-serif; border-radius: 8px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.18); display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
.pu-print-btn:hover { background: #1e293b; }
.pu-print-btn.loading { opacity: 0.7; cursor: wait; pointer-events: none; }
</style>
<a class="pu-print-btn" href="/api/page-pdf?slug=${slug}&amp;download=${download}" aria-label="Download proposal as PDF" download="${download}" onclick="this.classList.add('loading'); this.textContent='Generating PDF...'; setTimeout(()=>{this.classList.remove('loading'); this.innerHTML='&#9000; Download PDF';}, 10000);">&#9000; Download PDF</a>
`;

const files = readdirSync(DIR).filter(f => f.endsWith('.html'));
let stripped = 0, rewired = 0, skipped = 0, untouched = 0;

for (const f of files) {
  const path = join(DIR, f);
  const basename = f.replace(/\.html$/, '');
  const html = readFileSync(path, 'utf8');

  if (!html.includes(MARKER)) { untouched++; continue; }
  if (SKIP.has(basename))     { skipped++; continue; }

  let out;
  if (STATIC_WIRE[basename]) {
    const { slug, download } = STATIC_WIRE[basename];
    out = html.replace(SNIPPET_RE, WORKING_SNIPPET(slug, download));
    rewired++;
  } else {
    out = html.replace(SNIPPET_RE, '');
    stripped++;
  }

  writeFileSync(path, out);
}

console.log(`stripped: ${stripped}, rewired: ${rewired}, skipped (already wired): ${skipped}, untouched (no marker): ${untouched}`);
