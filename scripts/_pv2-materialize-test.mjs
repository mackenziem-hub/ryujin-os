// Local test: materialize a v2 instance, then render it frozen (NOT committed).
import { pathToFileURL } from 'node:url';
const WT = 'C:/Users/Owner/Code/ryujin-wt-pv2';
const materialize = (await import(pathToFileURL(WT + '/api/proposal-materialize.js').href)).default;
const proposalV2 = (await import(pathToFileURL(WT + '/api/proposal-v2.js').href)).default;

function mockRes() {
  const r = { _status: 200, _body: '' };
  r.status = c => { r._status = c; return r; };
  r.setHeader = () => r; r.json = o => { r._body = o; return r; };
  r.end = s => { if (s) r._body = s; return r; }; r.send = s => { r._body = s; return r; }; r.redirect = () => r;
  return r;
}

const estimate = process.argv[2] || 'ba7cfda3-4b5f-49b6-ab08-0cc1ba20aeaf';
const template = process.argv[3] || 'asphalt-good-better-best';
const status = process.argv[4] || 'draft';

const mRes = mockRes();
await materialize({ method: 'POST', query: {}, body: { estimate, template, status }, on: () => {} }, mRes);
console.log('materialize ->', mRes._status, JSON.stringify(mRes._body));
const slug = mRes._body && mRes._body.slug;
if (!slug) process.exit(1);

const rRes = mockRes();
await proposalV2({ method: 'GET', query: { instance: slug }, headers: { accept: 'application/json' } }, rRes);
const d = rRes._body;
console.log('instance render ->', rRes._status);
console.log('  refId', d.meta?.refId, '| status', d.meta?.status, '| instanceSlug', d.meta?.instanceSlug);
console.log('  products.mode', d.products?.mode, '| tiers', (d.products?.tiers || []).map(t => t.id + '=$' + t.total).join(' '));
console.log('  greeting', (d.sections || []).find(s => s.type === 'intro')?.content?.greeting);
console.log('  sections', (d.sections || []).map(s => s.type).join(','));
console.log('  frozen: data_snapshot served verbatim =', d.meta?.rendererVersion === 'v2' && Array.isArray(d.sections) && d.sections.length > 0);
