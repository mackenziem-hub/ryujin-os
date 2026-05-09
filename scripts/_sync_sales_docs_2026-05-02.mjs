// Bulk sync Sales SOPs to Ryujin admin Documents tab.
// One-shot: 2026-05-02 sales doc build-out (14 docs).

import { readFileSync } from 'node:fs';

const BASE = 'https://ryujin-os.vercel.app';
const TENANT = 'plus-ultra';
const SALES_DIR = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Sales';

const docs = [
  // Tier 1 — Cat-enabling
  { slug: 'inbound-call-qualification', title: 'Inbound Call Qualification Script', file: `${SALES_DIR}/Inbound Call Qualification Script.md`, summary: 'Cat + Diego inbound script. 6 questions → A/B/C/D classification. Region check, spam screen, escalation triggers.' },
  { slug: 'ghl-pipeline-stage-definitions', title: 'GHL Pipeline Stage Definitions', file: `${SALES_DIR}/GHL Pipeline Stage Definitions.md`, summary: 'Mack\'s Pipeline 16-stage operating manual. Entry/exit rules, owner per stage, advance authority, SLA audit.' },
  { slug: 'lead-source-taxonomy', title: 'Lead Source Taxonomy', file: `${SALES_DIR}/Lead Source Taxonomy.md`, summary: 'Every lead source → tag → category → routing. Master table for Cat\'s GHL hygiene + auto-assign workflow fix.' },
  { slug: 'speed-to-lead-sla', title: 'Speed-to-Lead SLA', file: `${SALES_DIR}/Speed-to-Lead SLA.md`, summary: '15-min first-touch protocol. Cat-B vs Cat-C cadence. The single highest-leverage operational fix this quarter.' },
  { slug: 'sales-to-production-handoff', title: 'Sales-to-Production Handoff Checklist', file: `${SALES_DIR}/Sales-to-Production Handoff Checklist.md`, summary: '14-item checklist. Fires when deposit clears. Materials + crew + customer comms covered. Cat owns; Mac signs production-side.' },

  // Tier 2 — Darcy-enabling
  { slug: 'objection-handling-playbook', title: 'Objection Handling Playbook', file: `${SALES_DIR}/Objection Handling Playbook.md`, summary: '12 common objections with scripted responses. Two-tier framing, financing pivot, escalation triggers. Built off Plus Ultra rules.' },
  { slug: 'proposal-walkthrough-script', title: 'Proposal Walkthrough Script', file: `${SALES_DIR}/Proposal Walkthrough Script.md`, summary: '7-beat residential walkthrough. 15-25 min target. Anti-stall closes. Customer-type tweaks. Skip for repairs/commercial.' },
  { slug: 'two-tier-proposal-playbook', title: 'Two-Tier Proposal Playbook', file: `${SALES_DIR}/Two-Tier Proposal Playbook.md`, summary: 'When competitor undercuts: build a Match Tier alongside Plus Ultra Standard. APHL pattern formalized. 25% gross floor.' },
  { slug: 'repair-pricing-module', title: 'Repair Pricing Module', file: `${SALES_DIR}/Repair Pricing Module.md`, summary: 'Sub-$2,500 repair rate sheet. AJ + Diego authority. Service call min $300. Repair → full-roof conversion path.' },
  { slug: 'inspection-field-checklist', title: 'Inspection Field Checklist', file: `${SALES_DIR}/Inspection Field Checklist.md`, summary: '5-beat on-site inspection SOP. Residential. Photo standard, measurements, attic check, sit-down recap. 45-60 min.' },

  // Tier 3 — system-completing
  { slug: 'ninety-day-cold-nurture', title: '90-Day Cold Nurture Sequence', file: `${SALES_DIR}/90-Day Cold Nurture Sequence.md`, summary: '7-touch nurture for stalled C leads. Days 7/14/21/35 auto, 50/70/90 Cat-eyeball. Target: 12-18% convert to inspection.' },
  { slug: 'review-ask-sequence', title: 'Review-Ask Sequence', file: `${SALES_DIR}/Review-Ask Sequence.md`, summary: 'Day-7 post-payment Google review ask. Quality gate: don\'t ask if complaints unresolved. Negative-review protocol included.' },
  { slug: 'referral-ask-sequence', title: 'Referral-Ask Sequence', file: `${SALES_DIR}/Referral-Ask Sequence.md`, summary: '4-touch referral ask Day 14/30/60/90. Lineage tagging is load-bearing for 5% override. $200/referral credit.' },
  { slug: 'customer-service-agreement-template', title: 'Customer Service Agreement Template', file: `${SALES_DIR}/Customer Service Agreement Template.md`, summary: 'Residential contract template — 8 sections. Auto-generated via /api/contract-pdf. Mac sole sign-off. NB legal review pending.' },
  { slug: 'warranty-registration-sop', title: 'Warranty Registration SOP', file: `${SALES_DIR}/Warranty Registration SOP.md`, summary: 'CertainTeed (NOT GAF) warranty registration via contractor portal. Within 14 days of paid-in-full. 5-Star/4-Star/Standard tiers.' }
];

let success = 0;
let failed = 0;

for (const d of docs) {
  const markdown = readFileSync(d.file, 'utf8');
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
    console.log(`✓ ${d.slug.padEnd(38)} v${data.version}  ${markdown.length.toString().padStart(6)} chars`);
    success++;
  }
}

console.log(`\n${success} synced, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
