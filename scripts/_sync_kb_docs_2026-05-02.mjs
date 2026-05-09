// Phase 4: Migrate Plus Ultra _brain/knowledge/ files into Ryujin docs system.
// Skipped: LOOM_SOPS.md (1MB transcript dump), STATE.md (auto-generated snapshot), README.md.
// Re-runnable. PUTs to /api/docs upserts with version bump.

import { readFileSync } from 'node:fs';

const BASE = 'https://ryujin-os.vercel.app';
const TENANT = 'plus-ultra';
const KB_DIR = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/_brain/knowledge';

// `internal` flag prepends a banner. Once Phase 5 role gating ships, these become visibility:owner+ or admin+.
const docs = [
  { slug: 'kb-core', title: 'Plus Ultra — Core Profile', file: `${KB_DIR}/CORE.md`, summary: 'Who Mackenzie is, the three domains (Plus Ultra Roofing / Aetheria / Ryujin OS), team roster, connected tools, active machines.' },
  { slug: 'kb-rules', title: 'Plus Ultra — Operating Rules', file: `${KB_DIR}/RULES.md`, summary: 'Writing style, sales rules (bundled retail, insurance settlement, surface vs structural, mobilization, remediation), UI standards, technical rules, agent rules.' },
  { slug: 'kb-sales', title: 'Plus Ultra — Sales Knowledge Index', file: `${KB_DIR}/SALES.md`, summary: 'Lead-to-close workflow + proposal system. Org map, lifecycle, Mack\'s Pipeline 16 stages, Quote Engine v3.1, comp snapshot, hard rules. Index for the 15 sales SOPs.' },
  { slug: 'kb-pricing', title: 'Plus Ultra — Pricing Engine', file: `${KB_DIR}/PRICING.md`, summary: 'Pricing engine details, multipliers, cost stack, target margins.', internal: true },
  { slug: 'kb-systems', title: 'Plus Ultra — Systems Map', file: `${KB_DIR}/SYSTEMS.md`, summary: 'APIs, endpoints, deployments, agent roster, data flow across Estimator OS / Action Board / Instant Estimator / GHL / Ryujin.', internal: true },
  { slug: 'kb-mentors', title: 'Plus Ultra — Mentor Frameworks', file: `${KB_DIR}/MENTORS.md`, summary: 'Hormozi + Martell condensed actionable frameworks. Distilled for application to Plus Ultra decisions.' },
  { slug: 'kb-mentors-transcripts', title: 'Plus Ultra — Mentor Transcripts Index', file: `${KB_DIR}/MENTORS_TRANSCRIPTS.md`, summary: 'Distilled mentor advice from 28 Fathom calls Jan-Apr 2026. Searchable index.' },
  { slug: 'kb-fathom-workshops', title: 'Plus Ultra — Fathom Workshop Index', file: `${KB_DIR}/FATHOM_WORKSHOPS.md`, summary: 'Indexed Fathom workshop transcripts from sales / business strategy / coaching calls.' },
  { slug: 'kb-team-transcripts', title: 'Plus Ultra — Team Meeting Transcripts', file: `${KB_DIR}/TEAM_TRANSCRIPTS.md`, summary: 'Internal team meeting digests (Cat onboarding call May 1, etc.). Sensitive — internal only.', internal: true },
  { slug: 'kb-dual-funnel-blueprint', title: 'Plus Ultra — Dual Funnel Blueprint', file: `${KB_DIR}/DUAL_FUNNEL_BLUEPRINT.md`, summary: 'Strategic funnel architecture spanning marketing → sales → operations.', internal: true }
];

const INTERNAL_BANNER = '> **INTERNAL ONLY.** This document contains operating-side detail (cost stack, system internals, sensitive strategy, or unredacted meeting digests). Do NOT share with customers, subs, or third parties. Once Phase 5 role gating ships, this doc is visibility-restricted to owner / admin roles.\n\n';

let success = 0, failed = 0;

for (const d of docs) {
  let markdown = readFileSync(d.file, 'utf8');
  if (d.internal && !markdown.includes('INTERNAL ONLY')) {
    markdown = INTERNAL_BANNER + markdown;
  }
  const r = await fetch(`${BASE}/api/docs?slug=${encodeURIComponent(d.slug)}&tenant=${TENANT}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: d.title,
      summary: d.summary,
      markdown,
      status: 'draft'
    })
  });
  const text = await r.text();
  if (!r.ok) {
    console.error(`✗ ${d.slug}: ${r.status} ${text.slice(0, 200)}`);
    failed++;
  } else {
    const data = JSON.parse(text);
    const flag = d.internal ? '[INTERNAL]' : '';
    console.log(`✓ ${d.slug.padEnd(28)} v${data.version}  ${markdown.length.toString().padStart(7)} chars  ${flag}`);
    success++;
  }
}

console.log(`\n${success} synced, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
