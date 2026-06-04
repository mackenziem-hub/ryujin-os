// Dump the v2 ProposalData JSON for an estimate+template (NOT committed).
// Run: node --env-file=<envfile> scripts/_pv2-dump.mjs <estimateId> <templateSlug> <outJson>
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const WT = 'C:/Users/Owner/Code/ryujin-wt-pv2';
const handler = (await import(pathToFileURL(WT + '/api/proposal-v2.js').href)).default;
const query = { estimate: process.argv[2] || 'ba7cfda3-4b5f-49b6-ab08-0cc1ba20aeaf', template: process.argv[3] || 'asphalt-good-better-best' };
const out = process.argv[4] || (WT + '/docs/proposal-v2/pv2-guy.json');
let body = '';
const res = { status: () => res, setHeader: () => res, json: o => { body = JSON.stringify(o, null, 1); return res; }, end: s => { if (s) body = s; return res; }, send: s => { body = s; return res; }, redirect: () => res };
await handler({ method: 'GET', query, headers: { accept: 'application/json' } }, res);
writeFileSync(out, body);
console.log('wrote', out, body.length, 'bytes');
