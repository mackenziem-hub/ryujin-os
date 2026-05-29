// Eval the inbox agent's notify gate against the hardened fixture.
//
//   ANTHROPIC_API_KEY=... node scripts/eval_inbox_triage.mjs
//
// Scores api/agents/inbox.js triageMessage() over test/inbox_triage_fixture.json.
// The number that matters is FALSE NEGATIVES on notify: a fixture case whose
// correct_notify is true but the model returned false. Those are missed leaks
// or missed leads, the failure mode the whole agent exists to prevent. The
// run exits non-zero if any false negative occurs so it can gate CI later.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { triageMessage } from '../api/agents/inbox.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(__dirname, '..', 'test', 'inbox_triage_fixture.json'), 'utf8'));
const cases = fixture.cases || [];

const CONCURRENCY = 5;

async function runCase(c, i) {
  try {
    const t = await triageMessage({
      contactName: 'Unknown',
      channel: c.channel,
      messages: [{ direction: 'inbound', body: c.text, dateAdded: new Date().toISOString() }],
    });
    return { i, c, t, ok: true };
  } catch (e) {
    return { i, c, error: e.message, ok: false };
  }
}

async function main() {
  if (!(process.env.ANTHROPIC_API_KEY || '').trim()) {
    console.error('ANTHROPIC_API_KEY required');
    process.exit(2);
  }
  console.log(`Evaluating ${cases.length} cases against triageMessage()...\n`);

  const results = [];
  for (let i = 0; i < cases.length; i += CONCURRENCY) {
    const batch = cases.slice(i, i + CONCURRENCY);
    const out = await Promise.all(batch.map((c, j) => runCase(c, i + j)));
    results.push(...out);
    process.stdout.write('.');
  }
  console.log('\n');

  const falseNeg = [];   // should notify, did not (DANGEROUS)
  const falsePos = [];   // should not notify, did
  const catMiss = [];
  const errored = [];
  let notifyCorrect = 0;

  for (const r of results.sort((a, b) => a.i - b.i)) {
    if (!r.ok) { errored.push(r); continue; }
    const want = r.c.correct_notify;
    const got = r.t.notify;
    if (want === got) notifyCorrect++;
    else if (want && !got) falseNeg.push(r);
    else falsePos.push(r);
    if (r.c.correct_category && r.t.category !== r.c.correct_category) catMiss.push(r);
  }

  const scored = results.length - errored.length;
  console.log(`Notify accuracy: ${notifyCorrect}/${scored} (${scored ? Math.round((notifyCorrect / scored) * 100) : 0}%)`);
  console.log(`Category match:  ${scored - catMiss.length}/${scored}`);
  console.log(`False negatives (MISSED leak/lead): ${falseNeg.length}`);
  console.log(`False positives (over-notify):      ${falsePos.length}`);
  if (errored.length) console.log(`Errored: ${errored.length}`);

  if (falseNeg.length) {
    console.log('\n=== DANGEROUS FALSE NEGATIVES (should have notified) ===');
    for (const r of falseNeg) {
      console.log(`\n[${r.i}] ${r.c.channel}: ${r.c.text.slice(0, 100)}`);
      console.log(`    expected notify=true, got notify=false  | summary: ${r.t.summary}`);
      console.log(`    note: ${r.c.note}`);
    }
  }
  if (falsePos.length) {
    console.log('\n=== FALSE POSITIVES (over-notify) ===');
    for (const r of falsePos) {
      console.log(`[${r.i}] ${r.c.channel}: ${r.c.text.slice(0, 80)} | reason: ${r.t.notify_reason}`);
    }
  }
  if (catMiss.length) {
    console.log('\n=== CATEGORY MISMATCHES (lower stakes) ===');
    for (const r of catMiss) {
      console.log(`[${r.i}] want ${r.c.correct_category}, got ${r.t.category}: ${r.c.text.slice(0, 70)}`);
    }
  }
  if (errored.length) {
    console.log('\n=== ERRORED ===');
    for (const r of errored) console.log(`[${r.i}] ${r.error}`);
  }

  process.exit(falseNeg.length > 0 || errored.length > 0 ? 1 : 0);
}

main();
