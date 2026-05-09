// Bulk sync EA + Sub SOPs (and 2 sales v3 reconciles) to Ryujin admin Documents tab.
// One-shot: 2026-05-03 EA/Sub SOP build-out (23 docs).

import { readFileSync } from 'node:fs';

const BASE = 'https://ryujin-os.vercel.app';
const TENANT = 'plus-ultra';
const DIR = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/_brain/_sop_drafts_2026-05-03';

const docs = [
  // EA SOPs
  { slug: 'ea-ghl-notification-fix', title: 'GHL Notification Fix Procedure', file: 'ea-ghl-notification-fix.md', summary: "Cat's Day-1 build: Darcy task-creation auto-notif + cross-pipeline customer-reply notif (rep + office). Two GHL workflows, test step, edge cases." },
  { slug: 'ea-ie-custom-fields-reroute', title: 'Instant Estimator Custom Fields and Reroute', file: 'ea-ie-custom-fields-reroute.md', summary: '5 IE custom fields in GHL + Sheet→GHL sync rerouting. Maps from IE 2.0 submissions sheet. Drives the 14-day nurture.' },
  { slug: 'ea-ie-14-day-nurture', title: 'Instant Estimator 14-Day Nurture Sequence', file: 'ea-ie-14-day-nurture.md', summary: "7-touch nurture (3 SMS + 4 email + soft exit) over 14 days. Mac's voice, Free Platinum offer, engagement + booking branches." },
  { slug: 'ea-daily-inbox-triage', title: 'Daily Inbox Triage', file: 'ea-daily-inbox-triage.md', summary: "Cat's morning inbox flow. Gmail delegate handling, label rules, escalation triggers, response templates. Phishing protocol embedded." },
  { slug: 'ea-daily-pipeline-sweep', title: 'Daily Pipeline Sweep', file: 'ea-daily-pipeline-sweep.md', summary: "GHL stale-deal scan, stage-by-stage SLA enforcement, follow-up cadence. Cat's afternoon block." },
  { slug: 'ea-speed-to-lead-execution', title: 'Speed-to-Lead Execution', file: 'ea-speed-to-lead-execution.md', summary: 'Cat-side companion to speed-to-lead-sla. 15-min Cat-B / 60-min Cat-C playbook with exact scripts.' },
  { slug: 'ea-quote-builder-walkthrough', title: 'Quote Builder Walkthrough', file: 'ea-quote-builder-walkthrough.md', summary: 'Ryujin Quote Builder click-by-click for Cat support work on Darcy/Mac quotes.' },
  { slug: 'ea-approvals-queue-triage', title: 'Approvals Queue Triage', file: 'ea-approvals-queue-triage.md', summary: 'Daily /approvals.html review. Three-question judgment framework. Cat full authority, no rigid gates. Logging + escalation paths.' },
  { slug: 'ea-calendar-scheduling', title: 'Calendar and Scheduling', file: 'ea-calendar-scheduling.md', summary: "Booking inspections, install scheduling, conflict resolution, Mac's calendar etiquette. Cat is Editor on Mac's calendar." },
  { slug: 'ea-document-filing-knowledge-hygiene', title: 'Document Filing and Knowledge Hygiene', file: 'ea-document-filing-knowledge-hygiene.md', summary: 'Drive folder hierarchy, Ryujin doc updates, filename conventions, downloads filing protocol.' },
  { slug: 'ea-weekly-reporting-cadence', title: 'Weekly Reporting Cadence', file: 'ea-weekly-reporting-cadence.md', summary: '7-KPI Monday 8 AM report. CAC/CPL/Closing/Leads/New Leads/Cost-per-lead/Approvals. Red flag triggers with min-volume guards.' },
  { slug: 'ea-vendor-supplier-communication', title: 'Vendor and Supplier Communication', file: 'ea-vendor-supplier-communication.md', summary: 'Coastal/IKO/CertainTeed PO flow. Never Kent rule. Payment terms tracking, supplier escalation.' },

  // Sub SOPs
  { slug: 'sub-jobsite-arrival-setup', title: 'Jobsite Arrival and Setup Protocol', file: 'sub-jobsite-arrival-setup.md', summary: 'Mobilization, signage, customer intro, dump trailer placement, neighbor courtesy. First-impression discipline.' },
  { slug: 'sub-portal-photo-cadence', title: 'Sub Portal Photo Cadence', file: 'sub-portal-photo-cadence.md', summary: '9 photo-stage chips (Before/During/After/Damage/Material/Safety/Inspect/Cleanup/General). What each photo proves. Lot numbers for warranty.' },
  { slug: 'sub-daily-progress-checkin', title: 'Daily Progress Check-In', file: 'sub-daily-progress-checkin.md', summary: 'EOD report format: completion %, blockers, weather, next-day plan. Sub Portal v3 Job Log discipline.' },
  { slug: 'sub-material-onsite-verification', title: 'Material On-Site Verification', file: 'sub-material-onsite-verification.md', summary: 'Bundle count, color match, defect gate-check before install. CertainTeed not GAF, never Kent.' },
  { slug: 'sub-punchlist-completion-gate', title: 'Punch-List and Completion Gate', file: 'sub-punchlist-completion-gate.md', summary: "Sub-side QC, AJ sign-off, customer walkthrough trigger. Final invoice doesn't fire until gate passes." },
  { slug: 'sub-callback-warranty-handling', title: 'Callback and Warranty Handling', file: 'sub-callback-warranty-handling.md', summary: '12-month workmanship free fix (sub eats labor). Storm/wear/customer = chargeable. 48-hr inspection SLA. CertainTeed warranty filing path.' },
  { slug: 'sub-scope-change-protocol', title: 'Scope Change Protocol', file: 'sub-scope-change-protocol.md', summary: '$250 threshold, hard-gate via Sub Portal v3, written customer-signed change order required over $250. Zero verbal commitments rule.' },
  { slug: 'sub-payment-process-2-3-day-pay', title: 'Subcontractor Payment Process and 2 to 3 Day Pay', file: 'sub-payment-process-2-3-day-pay.md', summary: '2-to-3-day pay SLA (vs Net 30 industry). Submission → AJ 24h → Mac e-transfer. Dispute protocol, customer-delayed 70% advance, T5018.' },
  { slug: 'sub-safety-wcb-compliance', title: 'Safety, WCB Compliance, and Insurance', file: 'sub-safety-wcb-compliance.md', summary: 'NB OHS 6-ft fall protection, WCB clearance verification, $2M GL with PU additional insured. Incident response, weekly toolbox talk.' },

  // Sales v3 reconciles (UPDATE existing slugs)
  { slug: 'repair-pricing-module', title: 'Repair Pricing Module', file: 'sales-repair-pricing-module-v3.md', summary: 'v3 reconcile: Mode A (listed table) vs Mode B (custom-build formula) inconsistency surfaced. Year-1 warranty carve-out. Drip edge v2.2 sensitivity quantified.' },
  { slug: 'two-tier-proposal-playbook', title: 'Two-Tier Proposal Playbook', file: 'sales-two-tier-proposal-playbook-v3.md', summary: 'v3 lock: Match Tier multiplier 1.333 (math fix). Portfolio rationale. Walk-script de-trashed. Special exception cap 2/quarter. v3.1 engine guard.' }
];

let success = 0;
let failed = 0;

for (const d of docs) {
  const markdown = readFileSync(`${DIR}/${d.file}`, 'utf8');
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
    console.error(`x ${d.slug}: ${r.status} ${text.slice(0, 200)}`);
    failed++;
  } else {
    const data = JSON.parse(text);
    console.log(`ok ${d.slug.padEnd(42)} v${data.version}  ${markdown.length.toString().padStart(6)} chars`);
    success++;
  }
}

console.log(`\n${success} synced, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
