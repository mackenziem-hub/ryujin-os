// Unit tests for sentinelChecks in lib/reconcile.js. No env, no network:
//   node tests/reconcileSentinels.test.mjs
import assert from 'node:assert/strict';
import { sentinelChecks } from '../lib/reconcile.js';

const NOW = Date.parse('2026-06-12T19:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

let n = 0;
function t(name, fn) { n++; fn(); console.log(`ok ${n} - ${name}`); }

// ── 1. duplicate estimate rows ───────────────────────────────
t('duplicate customer across sources flags the name once', () => {
  const pool = [
    { id: 68, source: 'estimator-os', fullName: 'Richard Seyeau', address: '10 Edgewater', finalAcceptedTotal: 26000 },
    { id: 'u-1', source: 'ryujin', fullName: 'Richard Seyeau', address: '10 Edgewater', finalAcceptedTotal: 29900 },
    { id: 80, source: 'estimator-os', fullName: 'Mark Lewis', address: '224 Route 530', finalAcceptedTotal: 33264 }
  ];
  const f = sentinelChecks({ pool, now: NOW });
  const dups = f.filter(x => x.kind === 'dup_estimate_rows');
  assert.equal(dups.length, 1);
  assert.equal(dups[0].job, 'richard seyeau');
});

t('no duplicates means no dup findings', () => {
  const pool = [
    { id: 1, source: 'estimator-os', fullName: 'A One', address: '1 St', finalAcceptedTotal: 1 },
    { id: 2, source: 'ryujin', fullName: 'B Two', address: '2 St', finalAcceptedTotal: 2 }
  ];
  assert.equal(sentinelChecks({ pool, now: NOW }).filter(x => x.kind === 'dup_estimate_rows').length, 0);
});

// ── 2. matcher exceptions mapped to findings ─────────────────
t('unmatched_large + duplicate_suspect exceptions become findings', () => {
  const cashflow = {
    arExceptions: [
      { type: 'unmatched_large', customer: 'Bryon Heisler', amount: 11787.5, description: '10406 route 134 St Louis' },
      { type: 'duplicate_suspect', customer: 'Alexandr Rudenko', amount: 517.5 }
    ]
  };
  const f = sentinelChecks({ cashflow, now: NOW });
  assert.equal(f.filter(x => x.kind === 'payment_unmatched').length, 1);
  assert.equal(f.filter(x => x.kind === 'payment_duplicate_suspect').length, 1);
  assert.equal(f.find(x => x.kind === 'payment_unmatched').dollar_impact, 11787.5);
});

// ── 4. contract-vs-collected drift (the Fram class) ──────────
t('over-collected job flags from byJob even without arExceptions', () => {
  const cashflow = {
    byJob: [
      { customer: 'Korey Fram', estimateId: '6885d1fc-56d5-46c8-97c7-894563ce982a', contractValue: 13428.55, totalCollected: 19428.55 },
      { customer: 'Jim Faulkner', estimateId: 69, contractValue: 17503, totalCollected: 17503 }
    ]
  };
  const f = sentinelChecks({ cashflow, now: NOW });
  const over = f.filter(x => x.kind === 'collected_over_contract');
  assert.equal(over.length, 1);
  assert.equal(over[0].dollar_impact, 6000);
  assert.equal(over[0].estimate_id, '6885d1fc-56d5-46c8-97c7-894563ce982a');
});

t('null contract never flags over-collected', () => {
  const cashflow = { byJob: [{ customer: 'X', contractValue: null, totalCollected: 9999 }] };
  assert.equal(sentinelChecks({ cashflow, now: NOW }).filter(x => x.kind === 'collected_over_contract').length, 0);
});

// ── 3. aged unpaid paysheets ─────────────────────────────────
t('unpaid paysheet completed 20d ago flags; 5d ago and paid rows do not', () => {
  const paysheets = [
    { id: 'a', customer_name: 'Old Unpaid', status: 'completed', total: 5000, completed_at: daysAgo(20), paid_at: null },
    { id: 'b', customer_name: 'Fresh', status: 'completed', total: 4000, completed_at: daysAgo(5), paid_at: null },
    { id: 'c', customer_name: 'Settled', status: 'completed', total: 3000, completed_at: daysAgo(30), paid_at: daysAgo(2) },
    { id: 'd', customer_name: 'Still Open Job', status: 'in_progress', total: 2000, completed_at: null, paid_at: null }
  ];
  const f = sentinelChecks({ paysheets, now: NOW });
  const aged = f.filter(x => x.kind === 'unpaid_aged_paysheet');
  assert.equal(aged.length, 1);
  assert.equal(aged[0].job, 'Old Unpaid');
  assert.match(aged[0].proposed_fix, /never auto-close/);
});

t('invoice_final counts as completed work for the aged check', () => {
  const paysheets = [{ id: 'e', customer_name: 'Edge', status: 'invoice_final', total: 8909.17, completed_at: daysAgo(40), paid_at: null }];
  assert.equal(sentinelChecks({ paysheets, now: NOW }).filter(x => x.kind === 'unpaid_aged_paysheet').length, 1);
});

// ── guard rails ──────────────────────────────────────────────
t('empty inputs produce zero findings', () => {
  assert.equal(sentinelChecks({ now: NOW }).length, 0);
  assert.equal(sentinelChecks({ pool: [], cashflow: null, paysheets: [], now: NOW }).length, 0);
});

console.log(`\nall ${n} tests passed`);
