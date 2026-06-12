// ═══════════════════════════════════════════════════════════════
// Approval-executor coverage guard.
//
// chat.js gates write tools behind an approval: the tool registers a
// pending_approval with a { tool: '<name>' } payload, Mac approves, and
// chat.js POSTs /api/approve, which runs executeApproved(tool, payload).
// If a gated tool has no matching `case` in that switch, approving it
// returns { executed: false } and the action silently reverts to pending,
// so NOTHING happens. (Found 2026-06-11: 10 of 12 gated tools were
// unwired - see _brain/qa/RYUJIN_AI_INCREMENT_executor_coverage.md.)
//
// This is a STATIC test: it reads the two source files and compares the
// set of approval-gated tools against the set of wired executor cases. It
// performs NO writes, sends nothing, and never POSTs /api/approve.
//
// Behaviour:
//   - Fails if a gated tool is missing from GATED_TOOLS drifts out of
//     chat.js (list integrity).
//   - Fails if the set of UNWIRED gated tools differs from the documented
//     baseline below. So: wire an executor -> move it out of the baseline;
//     add a new gated tool without an executor -> add it consciously or
//     wire it. The goal is to shrink BASELINE_UNWIRED to zero.
//
// Run: node test/approval_executor_coverage.cjs
// ═══════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const approveSrc = fs.readFileSync(path.join(ROOT, 'api', 'approve.js'), 'utf8');
const chatSrc = fs.readFileSync(path.join(ROOT, 'api', 'chat.js'), 'utf8');

// The write tools chat.js routes through the approval gate (each registers a
// pending_approval carrying { tool: '<name>' }). Keep this list explicit so a
// silent drift in chat.js trips the integrity check below rather than going
// unnoticed.
const GATED_TOOLS = [
  'send_email',
  'create_ticket',
  'update_ticket',
  'create_estimate',
  'update_estimate',
  'add_contact_note',
  'delete_contact_note',
  'create_contact',
  'update_contact',
  'create_opportunity',
  'move_pipeline',
  'delete_opportunity',
  // Batch 3 finding: create_ghl_task routes through routeForApproval too but
  // was missed by the original 12-tool audit. The completeness check below
  // (set equality against chat.js's actual payload literals) prevents a recur.
  'create_ghl_task',
];

// Documented baseline of gated tools with NO executor wired in api/approve.js.
// This is the backlog to burn down: wire an executor, then delete it from here.
// When this array is empty, every gated action Mac approves actually executes.
// 2026-06-12 batch 1 (the create_full_estimate estimate bundle): wired
// create_estimate, update_estimate, add_contact_note -> coverage 2/12 to 5/12.
// 2026-06-12 batch 2 (the CRM/pipeline surface): wired create_contact,
// update_contact, create_opportunity, move_pipeline -> coverage 5/12 to 9/12.
// 2026-06-12 batch 3 (final): wired update_ticket, create_ghl_task (the missed
// 13th gated tool) + the two destructive deletes per Mac's all-executors
// greenlight (the approval row names exactly what gets deleted; his approve
// click is the sign-off) -> coverage 13/13. EMPTY = every gated action Mac
// approves actually executes.
const BASELINE_UNWIRED = [];

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

console.log('approval-executor coverage:');

// 1) List integrity: every GATED tool actually appears as a tool registration
//    in chat.js (matches `tool: 'name'`). Catches the explicit list drifting
//    away from the source.
for (const tool of GATED_TOOLS) {
  const re = new RegExp("tool:\\s*'" + tool + "'");
  ok(re.test(chatSrc), `chat.js registers gated tool '${tool}'`);
}

// 1b) COMPLETENESS (added batch 3 after create_ghl_task was found missing from
//     the original audit): every `tool: '<name>'` payload literal in chat.js is
//     an approval-routed registration, so the extracted set must EQUAL
//     GATED_TOOLS. A new write tool added to chat.js without a conscious entry
//     here (and an executor, or a baseline line) now fails the suite instead of
//     shipping as a silent no-op.
const registered = new Set();
for (const m of chatSrc.matchAll(/tool:\s*'([a-z_]+)'/g)) registered.add(m[1]);
const notListed = [...registered].filter(t => !GATED_TOOLS.includes(t)).sort();
ok(notListed.length === 0,
  notListed.length
    ? `chat.js registers approval payload(s) [${notListed.join(', ')}] missing from GATED_TOOLS - add + wire them`
    : 'every chat.js tool payload literal is accounted for in GATED_TOOLS');

// 2) Extract wired executor cases from api/approve.js. The only switch in that
//    file is executeApproved's `switch (tool)`, so case labels = wired tools.
const wired = new Set();
for (const m of approveSrc.matchAll(/case\s+'([a-z_]+)'\s*:/g)) wired.add(m[1]);
console.log('  (wired executors: ' + [...wired].sort().join(', ') + ')');

// 3) The two known-good executors must stay wired.
ok(wired.has('send_email'), "executor wired for 'send_email'");
ok(wired.has('create_ticket'), "executor wired for 'create_ticket'");

// 4) Compute the unwired gated tools and compare to the documented baseline.
const unwired = GATED_TOOLS.filter(t => !wired.has(t)).sort();
const baseline = [...BASELINE_UNWIRED].sort();

const newlyWired = baseline.filter(t => !unwired.includes(t)); // executor added, update baseline
const newlyUnwired = unwired.filter(t => !baseline.includes(t)); // new gap, wire it or document

ok(newlyWired.length === 0,
  newlyWired.length
    ? `executor now wired for [${newlyWired.join(', ')}] - remove from BASELINE_UNWIRED`
    : 'no executors wired since baseline (baseline still accurate)');

ok(newlyUnwired.length === 0,
  newlyUnwired.length
    ? `gated tool(s) [${newlyUnwired.join(', ')}] have NO executor and are NOT in the baseline - wire or document`
    : 'no undocumented unwired gated tools');

const coverage = GATED_TOOLS.length - unwired.length;
console.log(`\n  coverage: ${coverage}/${GATED_TOOLS.length} gated tools have a wired executor`);
if (unwired.length) console.log(`  still unwired (approving these is a silent no-op): ${unwired.join(', ')}`);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
