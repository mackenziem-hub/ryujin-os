// Unit tests for lib/proposalsDedupe.js + lib/manualProposals.js. No env vars,
// no network, no framework:  node tests/proposalsIndexDedupe.test.mjs
// Exit 0 = all pass. Models the real same-address-different-name pairs that the
// old name-first dedupe left split in production (Boosamra, Pineau, McCardle vs
// McArdle) plus the 200 Lonsdale manual fold this order adds.
import assert from 'node:assert/strict';
import { addrKey, dedupe } from '../lib/proposalsDedupe.js';
import { getManualProposals } from '../lib/manualProposals.js';

let n = 0;
function t(name, fn) { n++; fn(); console.log(`ok ${n} - ${name}`); }

// helper: build a normalized index row the way the loaders do
function row(store, customer, address, bucket = 'sent', extra = {}) {
  return {
    store, customer, address, bucket,
    status: bucket, fromPrice: extra.fromPrice ?? null,
    lastUpdated: extra.lastUpdated ?? null, openUrl: extra.openUrl ?? null,
    ref: extra.ref ?? (store + '-' + customer),
    _nameKey: String(customer || '').trim().toLowerCase(),
    _addrKey: addrKey(address)
  };
}

// ── addrKey: synonymous formattings collapse ─────────────────────────────────
t('addrKey folds street-type spelling (Dr vs Drive)', () => {
  assert.equal(addrKey('200 Lonsdale Dr, Riverview'), addrKey('200 Lonsdale Drive, Riverview'));
  assert.equal(addrKey('95 Cornhill St, Moncton'), addrKey('95 Cornhill Street, Moncton'));
  assert.equal(addrKey('715 Rt 11, Miramichi'), addrKey('715 Route 11, Miramichi'));
  assert.equal(addrKey('21 Simpson Court, Riverview'), addrKey('21 Simpson Crt, Riverview'));
});
t('addrKey strips unit / apt / suite suffixes', () => {
  assert.equal(addrKey('200 Lonsdale Dr, Riverview'), addrKey('200 Lonsdale Dr unit 2, Riverview'));
  assert.equal(addrKey('57 Bolton St, Moncton'), addrKey('57 Bolton St Apt 3, Moncton'));
  assert.equal(addrKey('10 King Ave'), addrKey('10 King Ave Suite 200'));
});
t('addrKey strips hash-style unit (#2) the same as word units', () => {
  assert.equal(addrKey('200 Lonsdale Dr #2, Riverview'), addrKey('200 Lonsdale Dr, Riverview'));
  assert.equal(addrKey('200 Lonsdale Dr #2'), addrKey('200 Lonsdale Dr unit 2'));
  assert.equal(addrKey('57 Bolton St # 3, Moncton'), addrKey('57 Bolton St, Moncton'));
  assert.equal(addrKey('10 King Ave #12B'), addrKey('10 King Ave'));
});
t('addrKey ignores punctuation + case + whitespace', () => {
  assert.equal(addrKey('57 Bolton st, Moncton'), addrKey('57 BOLTON ST  Moncton'));
});
t('addrKey does NOT collapse genuinely different addresses', () => {
  assert.notEqual(addrKey('200 Lonsdale Dr, Riverview'), addrKey('202 Lonsdale Dr, Riverview'));
  assert.notEqual(addrKey('95 Cornhill St, Moncton'), addrKey('95 Cornhill Ave, Moncton'));
  assert.notEqual(addrKey('715 Ammon Rd, Moncton'), addrKey('715 Rt 11, Miramichi'));
  // empty stays empty so addressless rows never accidentally group
  assert.equal(addrKey(''), '');
  assert.equal(addrKey(null), '');
});

// ── dedupe: address-first collapses same-address name-drift pairs ─────────────
t('same address + different name spelling collapses to ONE row', () => {
  const rows = [
    row('Estimator OS', 'Donna Jean Boosamra', '95 Cornhill St, Moncton'),
    row('Ryujin-native', 'Donna Boosamra', '95 Cornhill Street, Moncton')
  ];
  const out = dedupe(rows);
  assert.equal(out.length, 1, 'two stores, same roof = one row');
  assert.deepEqual([...out[0].stores].sort(), ['Estimator OS', 'Ryujin-native']);
  // most-complete name wins
  assert.equal(out[0].customer, 'Donna Jean Boosamra');
});
t('McCardle vs McArdle (real prod pair) collapses on address', () => {
  const rows = [
    row('Ryujin-native', 'Stephanie McCardle', '21 Simpson Court, Riverview'),
    row('Estimator OS', 'Stephanie McArdle', '21 Simpson Court, Riverview'),
    row('GHL', 'Stephanie McCardle', '21 Simpson Court, Riverview')
  ];
  const out = dedupe(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].stores.length, 3);
});
t('distinct addresses for the same person stay separate', () => {
  const rows = [
    row('GHL', 'John Smith', '10 King Ave, Moncton'),
    row('GHL', 'John Smith', '99 Queen St, Moncton')
  ];
  const out = dedupe(rows);
  assert.equal(out.length, 2, 'two different roofs = two rows');
});
t('addressless row folds into its single addressed twin, not across ambiguous', () => {
  const rows = [
    row('Estimator OS', 'Mike Pineau', '57 Bolton St, Moncton'),
    row('GHL', 'Mike Pineau', '')   // no address on the GHL opp
  ];
  const out = dedupe(rows);
  assert.equal(out.length, 1, 'addressless GHL opp folds into the addressed deal');

  // but if the name maps to TWO addresses, the addressless row stays standalone
  const ambiguous = [
    row('Estimator OS', 'Pat Lee', '10 King Ave'),
    row('Ryujin-native', 'Pat Lee', '99 Queen St'),
    row('GHL', 'Pat Lee', '')
  ];
  const out2 = dedupe(ambiguous);
  assert.equal(out2.length, 3, 'ambiguous addressless row is not force-folded');
});

// ── manual source + 200 Lonsdale fold ────────────────────────────────────────
t('200 Lonsdale is seeded as a manual signed entry for plus-ultra', () => {
  const man = getManualProposals('plus-ultra');
  const lons = man.find(m => /lonsdale/i.test(m.address));
  assert.ok(lons, '200 Lonsdale present in manual source');
  assert.match(String(lons.status), /sign|accept/i);
  assert.match(addrKey(lons.address), /200 lonsdale dr/);
});
t('manual source is tenant-isolated', () => {
  assert.equal(getManualProposals('some-other-tenant').length, 0);
  assert.equal(getManualProposals('').length, 0);
  assert.equal(getManualProposals(null).length, 0);
  // case-insensitive slug match
  assert.ok(getManualProposals('PLUS-ULTRA').length > 0);
});
t('manual 200 Lonsdale folds onto the native sent row and elevates to accepted', () => {
  const man = getManualProposals('plus-ultra').map(m => ({
    store: 'manual', customer: m.customer, address: m.address, bucket: 'accepted',
    status: m.status, fromPrice: null, lastUpdated: m.lastUpdated, openUrl: m.openUrl,
    ref: m.ref, _nameKey: String(m.customer).trim().toLowerCase(), _addrKey: addrKey(m.address)
  }));
  const native = [ row('Ryujin-native', 'Concepcion Omega', '200 Lonsdale Dr, Riverview', 'sent') ];
  const out = dedupe([...native, ...man]);
  const lons = out.filter(p => /lonsdale/i.test(p.address || ''));
  assert.equal(lons.length, 1, '200 Lonsdale appears exactly once');
  assert.equal(lons[0].bucket, 'accepted', 'manual signed bucket wins the merge');
  assert.deepEqual([...lons[0].stores].sort(), ['Ryujin-native', 'manual']);
});

console.log(`\n${n} tests passed`);
