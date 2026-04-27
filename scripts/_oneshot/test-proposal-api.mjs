// Simulate what /api/proposal returns for share=plus-ultra-26 (public vs internal)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch {}

const handler = (await import('../../api/proposal.js')).default;

function makeReqRes(share, internal) {
  return [
    { method: 'GET', query: { share, ...(internal ? { internal: '1' } : {}) } },
    {
      _data: null, _status: 200, _headers: {},
      status(s) { this._status = s; return this; },
      json(o) { this._data = o; return this; },
      end() { return this; },
      setHeader(k, v) { this._headers[k] = v; }
    }
  ];
}

for (const share of ['plus-ultra-26','plus-ultra-27','plus-ultra-28']) {
  for (const internal of [false, true]) {
    const [req, res] = makeReqRes(share, internal);
    await handler(req, res);
    const tiers = res._data?.tiers?.asphalt || [];
    console.log(`\n=== ${share} ${internal ? 'INTERNAL' : 'PUBLIC'} ===`);
    console.log(`tiers returned: ${tiers.length}`);
    for (const t of tiers) {
      console.log(`  ${t.id}: $${t.total} (sopProfit:$${t.sopProfit || '?'} realCashNet:$${t.realCashNet || '?'} belowBE:${t.belowBreakeven})`);
    }
    if (res._data?.sopAudit) console.log('  sopAudit:', res._data.sopAudit);
  }
}
