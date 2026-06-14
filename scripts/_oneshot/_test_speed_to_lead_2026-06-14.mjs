// Stubbed test for the speed-to-lead pre-draft leg. No DB, no email, no SMS,
// no real lead. Exercises the two pure functions the build added:
//   buildLeadReplyDraft  (lib/leadReplyDraft.js)  - composes the first-touch text
//   buildLeadEventRow    (lib/leadEventRow.js)    - builds the inbox row + draft wiring
// Both are pure (no deps beyond node crypto): they return data only and cannot
// send, so this proves the draft logic with zero outbound and no node_modules.
// Run: node scripts/_oneshot/_test_speed_to_lead_2026-06-14.mjs

const { buildLeadReplyDraft } = await import('../../lib/leadReplyDraft.js');
const { buildLeadEventRow } = await import('../../lib/leadEventRow.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  FAIL:', msg); } };
const noEmDash = (s) => !/[—–]/.test(s);

console.log('== buildLeadReplyDraft: full lead ==');
{
  const r = buildLeadReplyDraft({
    name: 'Jordan Maple', address: '27 Maple Dr', city: 'Riverview',
    estimator: { material: 'Gold', low: 14200, high: 18600, size: '24 SQ' },
  });
  ok(r.sms.startsWith('Hey Jordan,'), 'sms greets first name');
  ok(r.sms.includes('Mac here from Plus Ultra Roofing'), 'sms has Mac-here opener');
  ok(r.sms.includes('27 Maple Dr'), 'sms references the address');
  ok(r.sms.includes('-Mackenzie'), 'sms signs -Mackenzie');
  ok(noEmDash(r.sms), 'sms has no em/en dash');
  ok(r.email.subject === 'Your Plus Ultra roof estimate', 'email subject set');
  ok(r.email.body.includes('Gold'), 'email names the package');
  ok(r.email.body.includes('$14,200') && r.email.body.includes('$18,600'), 'email shows the CAD range');
  ok(r.email.body.includes('(506) 616-4607'), 'email shows the business line, not the cell');
  ok(noEmDash(r.email.body), 'email has no em/en dash');
  ok(!/circle back|deeply sorry|happy to|hope this email/i.test(r.email.body), 'no corporate/AI tells');
}

console.log('== buildLeadReplyDraft: no name, no estimator ==');
{
  const r = buildLeadReplyDraft({ address: '', estimator: null });
  ok(r.sms.startsWith('Hey there,'), 'sms falls back to Hey there');
  ok(!r.email.body.includes('came back around'), 'no price line when estimator absent');
  ok(noEmDash(r.sms) && noEmDash(r.email.body), 'still no dashes');
}

console.log('== buildLeadReplyDraft: returning customer ==');
{
  const r = buildLeadReplyDraft({ name: 'Pat', deduped: true });
  ok(/Good to hear from you again/.test(r.sms), 'returning customer gets the again opener');
}

console.log('== buildLeadEventRow: with a draft ==');
{
  const sms = 'Hey Sam, Mac here. -Mackenzie';
  const row = buildLeadEventRow({
    tenantId: 't-1', event: 'lead', key: 'contact-abc', subject: 'New lead', body: 'detail',
    contactName: 'Sam', ghlContactId: 'abc', urgency: 'normal', draftReply: sms,
  });
  ok(row.draft_reply === sms, 'draft_reply carries the SMS verbatim');
  ok(row.needs_reply === true, 'needs_reply flips true when a draft is present');
  ok(row.notify === true, 'still a notify ping');
  ok(row.ghl_conversation_id === 'lead-event:lead:contact-abc', 'idempotency convo key intact');
  ok(typeof row.state_hash === 'string' && row.state_hash.length === 32, 'state_hash present');
  ok(row.category === 'lead', 'category mapped');
}

console.log('== buildLeadEventRow: no draft (backward compatible) ==');
{
  const row = buildLeadEventRow({ tenantId: 't-1', event: 'lead', key: 'k', subject: 'New lead' });
  ok(row.draft_reply === '', 'no draft = empty draft_reply (prior behaviour)');
  ok(row.needs_reply === false, 'no draft = quiet ping (prior behaviour)');
}

console.log('== idempotency keys are deterministic ==');
{
  const a = buildLeadEventRow({ tenantId: 't', event: 'lead', key: 'x', subject: 's' });
  const b = buildLeadEventRow({ tenantId: 't', event: 'lead', key: 'x', subject: 's' });
  ok(a.state_hash === b.state_hash && a.ghl_conversation_id === b.ghl_conversation_id, 'same (event,key) -> same dedup keys');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
