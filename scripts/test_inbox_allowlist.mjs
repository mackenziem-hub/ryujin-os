// Unit test for the inbox NOTIFY allow-list matcher (migration 084 / inbox_config).
// Run: node --env-file=<path>/.env.local scripts/test_inbox_allowlist.mjs
// Pure-logic test; the --env-file is only so importing api/agents/inbox.js
// (which pulls in lib/supabase.js) does not blow up on missing env.
import { matchAllowlist } from '../api/agents/inbox.js';

let pass = 0, fail = 0;
function check(name, got, wantTruthy, wantNote) {
  const okTruthy = wantTruthy ? !!got : got === null;
  const okNote = wantNote === undefined ? true : (got && got.note === wantNote);
  if (okTruthy && okNote) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} -> ${JSON.stringify(got)} (wantTruthy=${wantTruthy}, wantNote=${wantNote})`); }
}

const list = [{ match: 'jessica', note: 'pricing' }, { match: 'ben', note: 'pricing' }];

// Matches
check('full name w/ first-name token', matchAllowlist('Jessica Martin', list), true, 'pricing');
check('case-insensitive', matchAllowlist('BEN CARTER', ['ben']), true);
check('bare-string entry', matchAllowlist('Ben Carter', ['ben']), true);
check('apostrophe is a word boundary', matchAllowlist("Ben's Plumbing", ['ben']), true);
check('exact single-word name', matchAllowlist('Jessica', [{ match: 'jessica' }]), true);

// Non-matches (the whole-word guard is the point)
check('substring inside a longer word does NOT match', matchAllowlist('Bensen Roofing Supply', ['ben']), false);
check('different person', matchAllowlist('Sarah Lee', list), false);
check('empty allow-list', matchAllowlist('Jessica Martin', []), false);
check('empty name', matchAllowlist('', ['ben']), false);
check('null name', matchAllowlist(null, ['ben']), false);
check('non-array allow-list', matchAllowlist('Jessica', null), false);
check('blank match token is skipped', matchAllowlist('Jessica', [{ match: '   ' }]), false);

// Regex-special token must not throw and is treated literally
check('regex-special token treated literally (no match)', matchAllowlist('Jessica', [{ match: '(' }]), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
