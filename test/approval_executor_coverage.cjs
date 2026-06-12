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
];

// Documented baseline of gated tools with NO executor wired in api/approve.js
// as of 2026-06-11. This is the backlog to burn down: wire an executor, then
// delete it from here. When this array is empty, every gated action Mac
// approves actually executes.
const BASELINE_UNWIRED = [
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
];

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
