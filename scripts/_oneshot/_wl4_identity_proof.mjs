// White-label PR4 identity proof: every element marked data-tenant="K" must
// carry hardcoded text EXACTLY equal to RyujinTenant DEFAULT[K], so the
// hydrator's textContent swap is a no-op for plus-ultra (tenant #1 output
// unchanged by construction). Run: node scripts/_oneshot/_wl4_identity_proof.mjs
import { readFileSync } from 'node:fs';

// DEFAULT mirror (assets/ryujin-tenant.js); the assertion below re-verifies
// the two values used here against the source file so this mirror cannot drift.
const DEFAULT = { name: 'Plus Ultra Roofing', nameShort: 'Plus Ultra' };
const src = readFileSync('public/assets/ryujin-tenant.js', 'utf8');
if (!src.includes("name: 'Plus Ultra Roofing'") || !src.includes("nameShort: 'Plus Ultra'")) {
  console.error('DEFAULT mirror drifted from ryujin-tenant.js'); process.exit(2);
}

const FILES = ['public/paysheet.html', 'public/sub-portal.html', 'public/sub-media.html', 'public/sub-login.html'];
let checked = 0, fail = 0;
for (const f of FILES) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/<([a-z]+)[^>]*data-tenant="([a-zA-Z]+)"[^>]*>([^<]*)</g)) {
    const [, , key, text] = m;
    const want = DEFAULT[key];
    checked++;
    const ok = want !== undefined && text.trim() === want;
    if (!ok) fail++;
    console.log(`${f} [data-tenant=${key}] "${text.trim()}" ${ok ? '== DEFAULT (no-op for PU)' : '*** MISMATCH vs "' + want + '" ***'}`);
  }
}
console.log(`\n${checked} marked elements checked, ${fail} mismatches`);
process.exit(fail ? 1 : 0);
