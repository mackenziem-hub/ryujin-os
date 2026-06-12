// Unit tests for lib/paymentMatcher.js. No env vars, no network, no test
// framework needed:  node tests/paymentMatcher.test.mjs
// Exit 0 = all pass. Synthetic descriptors model the real failure cases from
// _brain/finance/AR_EXCEPTIONS_2026-06-12.md (Windy Hill collision class,
// Heisler unmatched class, the 5380-vs-5360 slop the window was built for).
import assert from 'node:assert/strict';
import { matchPaymentToEstimate, addressNameTokens } from '../lib/paymentMatcher.js';

const FRAM   = { id: 32, source: 'estimator-os', fullName: 'Korey Fram',     address: '25 Windy Hill Rd' };
const PEACH  = { id: 71, source: 'estimator-os', fullName: 'Shelagh Peach',  address: '5360 Rte 495' };
const LEWIS  = { id: 80, source: 'estimator-os', fullName: 'Mark Lewis',     address: '224 Route 530' };
const SMITH  = { id: 90, source: 'ryujin',       fullName: 'Pat Smith',      address: '30 Windy Hill Rd' };
const POOL = [FRAM, PEACH, LEWIS];

let n = 0;
function t(name, fn) { n++; fn(); console.log(`ok ${n} - ${name}`); }

// ── tokenizer ────────────────────────────────────────────────
t('tokenizer drops civic number, punctuation, suffix noise', () => {
  assert.deepEqual([...addressNameTokens('5380 Rte. 495')], ['495']);
  assert.deepEqual([...addressNameTokens('25 Windy Hill Rd')], ['windy', 'hill']);
  assert.deepEqual([...addressNameTokens('10406 route 134 St Louis')], ['134', 'louis']);
  assert.deepEqual([...addressNameTokens('')], []);
});

// ── name matching unchanged ──────────────────────────────────
t('exact full-name match still wins regardless of address', () => {
  const pmt = { customer: 'Korey Fram', invoiceDescription: '999 Nowhere Blvd' };
  assert.equal(matchPaymentToEstimate(pmt, POOL), FRAM);
});

t('unique distinctive last-name match still works', () => {
  const pmt = { customer: 'K. Fram', invoiceDescription: null };
  assert.equal(matchPaymentToEstimate(pmt, POOL), FRAM);
});

// ── the Windy Hill collision class (the bug) ─────────────────
t('cross-street numeric collision NO LONGER matches (30 Main St vs 25 Windy Hill)', () => {
  // Old matcher: |30-25| <= 20 and Fram is the only estimate in the band -> wrongly matched.
  const pmt = { customer: 'Somebody Else', invoiceDescription: '30 Main St' };
  assert.equal(matchPaymentToEstimate(pmt, POOL), null);
});

t('same civic number on a different street NO LONGER matches (25 Main St)', () => {
  const pmt = { customer: 'Somebody Else', invoiceDescription: '25 Main St' };
  assert.equal(matchPaymentToEstimate(pmt, POOL), null);
});

// ── the slop case the +-20 window exists for (must keep working) ──
t('civic-number slop with same street still matches (5380 Rte. 495 vs 5360 Rte 495)', () => {
  const pmt = { customer: 'Unknown Payer', invoiceDescription: '5380 Rte. 495' };
  assert.equal(matchPaymentToEstimate(pmt, POOL), PEACH);
});

t('exact address with suffix/punctuation variants matches', () => {
  const pmt = { customer: 'Unknown Payer', invoiceDescription: '25 Windy Hill' };
  assert.equal(matchPaymentToEstimate(pmt, POOL), FRAM);
});

// ── the Heisler class: no estimate exists -> stays unmatched ──
t('Heisler-style payment with no estimate in pool returns null (surfaces as exception)', () => {
  const pmt = { customer: 'Bryon Heisler', invoiceDescription: '10406 route 134 St Louis' };
  assert.equal(matchPaymentToEstimate(pmt, POOL), null);
});

t('Heisler-style payment DOES match when its estimate exists', () => {
  const heisler = { id: 99, source: 'estimator-os', fullName: 'B. H.', address: '10406 Route 134, St Louis' };
  const pmt = { customer: 'Bryon Heisler', invoiceDescription: '10406 route 134 St Louis' };
  assert.equal(matchPaymentToEstimate(pmt, [...POOL, heisler]), heisler);
});

// ── ambiguity handling ───────────────────────────────────────
t('two candidates sharing a token: exact civic number wins', () => {
  const pmt = { customer: 'Unknown Payer', invoiceDescription: '30 Windy Hill Rd' };
  // FRAM (25 Windy Hill) and SMITH (30 Windy Hill) both pass window+token; 30 is exact.
  assert.equal(matchPaymentToEstimate(pmt, [...POOL, SMITH]), SMITH);
});

t('two candidates, neither exact: ambiguous returns null', () => {
  const pmt = { customer: 'Unknown Payer', invoiceDescription: '28 Windy Hill Rd' };
  assert.equal(matchPaymentToEstimate(pmt, [...POOL, SMITH]), null);
});

// ── guard rails ──────────────────────────────────────────────
t('empty customer name returns null', () => {
  assert.equal(matchPaymentToEstimate({ customer: '', invoiceDescription: '25 Windy Hill Rd' }, POOL), null);
});

t('descriptor with number but no street tokens returns null (fails safe)', () => {
  const pmt = { customer: 'Somebody Else', invoiceDescription: 'against 25' };
  assert.equal(matchPaymentToEstimate(pmt, POOL), null);
});

t('estimate with empty address never matches via address path', () => {
  const bare = { id: 77, source: 'ryujin', fullName: 'No Address', address: '' };
  const pmt = { customer: 'Somebody Else', invoiceDescription: '25 Windy Hill Rd' };
  assert.equal(matchPaymentToEstimate(pmt, [bare]), null);
});

console.log(`\nall ${n} tests passed`);
