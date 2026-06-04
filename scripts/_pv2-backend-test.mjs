// Local test of the Phase B backend (NOT committed). Run with --env-file.
import { pathToFileURL } from 'node:url';
const WT = 'C:/Users/Owner/Code/ryujin-wt-pv2';
const blocks = (await import(pathToFileURL(WT + '/api/proposal-blocks.js').href)).default;
const templates = (await import(pathToFileURL(WT + '/api/proposal-templates.js').href)).default;
const pv2 = (await import(pathToFileURL(WT + '/api/proposal-v2.js').href)).default;

function mockRes() {
  const r = { _s: 200, _b: null };
  r.status = c => { r._s = c; return r; }; r.setHeader = () => r;
  r.json = o => { r._b = o; return r; }; r.end = s => { if (s != null) r._b = s; return r; };
  r.send = s => { r._b = s; return r; }; r.redirect = () => r;
  return r;
}
const H = { 'x-tenant-id': 'plus-ultra' };

let res = mockRes();
await templates({ method: 'GET', headers: H, query: {} }, res);
console.log('GET /api/proposal-templates ->', res._s, '| count', (res._b?.templates || []).length, '|', (res._b?.templates || []).map(t => t.slug).join(', '));

res = mockRes();
await blocks({ method: 'GET', headers: H, query: {} }, res);
console.log('GET /api/proposal-blocks ->', res._s, '| count', (res._b?.blocks || []).length, '| types', (res._b?.blocks || []).map(b => b.block_type).join(','));

res = mockRes();
const tpl = { slug: '_test', name: 'Test', sections: ['hero', 'intro', 'products', 'accept'], product_plan: { mode: 'good_better_best', offer_slugs: ['gold', 'platinum', 'diamond'], recommended: 'platinum' } };
await pv2({ method: 'POST', headers: H, query: {}, body: { estimate: 'ba7cfda3-4b5f-49b6-ab08-0cc1ba20aeaf', template: tpl } }, res);
console.log('POST /api/proposal-v2 (preview, ad-hoc 4-section template) ->', res._s);
console.log('  sections:', (res._b?.sections || []).map(s => s.type).join(','), '(expect hero,intro,products,accept)');
console.log('  tiers:', (res._b?.products?.tiers || []).map(t => t.id + '=$' + t.total).join(' '));
