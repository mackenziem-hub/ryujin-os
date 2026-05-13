// Fires a Manus product audit at the deployed mobile portal, focused on
// the agent chat overlay (.ry-agent-shell from agent-mode-shell.js).
//
// Run: $env:MANUS_API_KEY="<key>"; node scripts/_oneshot/_manus_audit_mobile_chat_2026-05-11.mjs
// Bash: MANUS_API_KEY=<key> node scripts/_oneshot/_manus_audit_mobile_chat_2026-05-11.mjs
//
// Cost: ~$1-2.50 on manus-1.6-max. Wall time: 4-8 min.
// Output: pretty-printed verdict + raw JSON saved next to this script.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditUrl } from '../../lib/manus_audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Auto-load Manus creds from _brain/.env so the script is self-contained.
for (const p of [
  'C:\\Users\\Owner\\OneDrive\\Desktop\\Plus Ultra\\_brain\\.env',
  'C:\\Users\\Owner\\OneDrive\\Desktop\\Plus Ultra\\_brain-HAL\\.env',
]) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
    }
  } catch {}
}

// Optional: set MANUS_PROJECT_ID env if the project has a saved persistent
// instruction worth prepending (per memory: pass projectId, not lite tier).
const PROJECT_ID = process.env.MANUS_PROJECT_ID || undefined;

const TARGET = 'https://ryujin-os.vercel.app/portal-mobile.html';

const FOCUS = [
  'RE-AUDIT of mobile chat agent overlay (.ry-agent-shell) after shipping 5 polish fixes you flagged in the prior audit (task 7rQpFLx2Cy9YsGGpVYi2yq, verdict "minor-polish").',
  'Confirm each of the 5 fixes landed correctly, and surface anything still off.',
  'Test viewports: iPhone SE 375x667, iPhone 14 Pro 393x852, Android 360x800, plus landscape and keyboard-open.',
].join(' ');

const CONTEXT = `
RE-AUDIT after shipping 5 polish fixes from your prior verdict (commit 6a3f353).

The 5 fixes shipped, expected behavior:

1. INPUT ROW BUTTONS — voice and Send buttons should now stretch to match
   the textarea height (48px on tablet, 44px on mobile). Was 13–16px tall,
   should now feel balanced. Check on iPhone SE 375x667.

2. EMPTY TRANSCRIPT — scenario chips moved INSIDE the transcript container,
   appearing right below the greeting message. Workspace should feel
   populated on first load instead of "dead app." Tapping a chip should
   still fill the textarea. Sending any message should auto-hide the chips.

3. AVATAR DOMINANCE — avatar + name folded into a horizontal
   .ry-agent-identity row (was stacked vertical block). Mobile avatar
   dropped from 96px → 56px. Should feel like compact header, not the
   page's hero element.

4. CHIP CLIPPING — chips changed from overflow-x:auto (which clipped
   "Anything I haven't responded to?" mid-word) to flex-wrap:wrap inside
   the transcript. Should reflow cleanly on 360-393px phones — no more
   mid-word truncation. If chips still clip, that's a regression.

5. HEADER UNIFIED BAR — was three floating elements (don't-auto-show pill
   at top-left, mute + close circles at top-right). Now a single utility
   bar at top:0/left:0/right:0 with gradient backdrop and safe-area-inset
   padding. Should read as cohesive header, not floating chrome.

YOUR JOB: open portal-mobile.html, walk through each viewport, and confirm
each fix landed. For each: PASS / PARTIAL / FAIL with evidence. If
PARTIAL or FAIL, give a follow-up fix. Also surface any new issues the
changes introduced (regressions). Be honest — if it now looks worse in
some way, say so.

Bias: if everything looks clean and you'd ship it to a paying B2B
customer, return "ship-ready". The previous audit said "minor-polish" so
expectations are calibrated — we're not aiming for theoretical perfection.

Auth note: page may show empty/placeholder data without login. That's
fine — grade chrome and layout, not data state.
`.trim();

console.log('[manus] Firing audit...');
console.log('  target:', TARGET);
console.log('  profile: manus-1.6-max');
console.log('  project:', PROJECT_ID || '(none)');
console.log('  focus:', FOCUS.slice(0, 120) + '...');
console.log();

const result = await auditUrl({
  url: TARGET,
  focus: FOCUS,
  context: CONTEXT,
  profile: 'manus-1.6-max',
  projectId: PROJECT_ID,
  pollIntervalMs: 12000,
  maxWaitMs: 12 * 60 * 1000, // 12 min ceiling
});

console.log('\n========================================');
console.log('MANUS AUDIT RESULT');
console.log('========================================\n');

if (!result.ok) {
  console.error('FAILED:', result.error);
  console.error('Task URL:', result.taskUrl);
  console.error('Elapsed:', result.elapsedMs + 'ms');
  process.exit(1);
}

console.log(`ASSESSMENT: ${result.assessment}`);
console.log(`Elapsed: ${(result.elapsedMs / 1000).toFixed(1)}s`);
console.log(`Task: ${result.taskUrl}`);
console.log();
console.log('SUMMARY:');
console.log('  ' + (result.summary || '(none)').replace(/\n/g, '\n  '));
console.log();

if (result.blockers?.length) {
  console.log(`BLOCKERS (${result.blockers.length}):`);
  for (const b of result.blockers) {
    console.log(`\n  [${b.severity?.toUpperCase()}] [${b.category}] ${b.location}`);
    console.log(`    What:  ${b.description}`);
    console.log(`    Evidence: ${b.evidence}`);
    console.log(`    Fix:   ${b.fix}`);
  }
}

if (result.polish?.length) {
  console.log(`\nPOLISH (${result.polish.length}):`);
  for (const p of result.polish) {
    console.log(`\n  ${p.location}`);
    console.log(`    What: ${p.description}`);
    console.log(`    Fix:  ${p.fix}`);
  }
}

if (result.strengths?.length) {
  console.log(`\nSTRENGTHS (${result.strengths.length}):`);
  for (const s of result.strengths) console.log(`  + ${s}`);
}

// Save raw JSON for diffing / referencing later
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outPath = path.join(__dirname, `_manus_audit_mobile_chat_${stamp}.json`);
await fs.writeFile(outPath, JSON.stringify(result, null, 2), 'utf8');
console.log(`\nRaw JSON saved: ${outPath}`);
