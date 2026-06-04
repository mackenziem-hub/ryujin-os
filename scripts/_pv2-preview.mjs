// Local verification harness for the v2 proposal renderer (NOT committed).
// Serves public/proposal-v2.html + css, stubs /api/proposal-v2 by invoking the
// REAL handler against prod Supabase, proxies brand assets to prod, then
// screenshots the rendered page headless and reports console errors.
//
// Run: node --env-file=<envfile> scripts/_pv2-preview.mjs "<path+query>" "<outPng>"
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const WT = 'C:/Users/Owner/Code/ryujin-wt-pv2';
const PORT = 5187;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROD = 'https://ryujin-os.vercel.app';

const handler = (await import(pathToFileURL(WT + '/api/proposal-v2.js').href)).default;

function mockRes() {
  const res = { _status: 200, _body: '', _headers: {} };
  res.status = (c) => { res._status = c; return res; };
  res.setHeader = (k, v) => { res._headers[k] = v; return res; };
  res.json = (o) => { res._body = JSON.stringify(o); return res; };
  res.send = (s) => { res._body = typeof s === 'string' ? s : JSON.stringify(s); return res; };
  res.end = (s) => { if (s != null) res._body = s; return res; };
  res.redirect = (code, loc) => { res._status = code; res._headers.Location = loc; return res; };
  return res;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  try {
    if (p === '/api/proposal-v2') {
      const query = Object.fromEntries(u.searchParams.entries());
      const mres = mockRes();
      await handler({ method: 'GET', query, headers: { accept: 'application/json' } }, mres);
      res.writeHead(mres._status, { 'Content-Type': 'application/json' });
      res.end(mres._body || '{}');
      return;
    }
    if (p === '/proposal-v2.html' || p === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(WT + '/public/proposal-v2.html', 'utf8'));
      return;
    }
    if (p === '/proposal-v2.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(readFileSync(WT + '/public/proposal-v2.css', 'utf8'));
      return;
    }
    if (p.startsWith('/brand') || p.startsWith('/proposal-assets') || p.startsWith('/assets')) {
      const r = await fetch(PROD + p);
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream' });
      res.end(buf);
      return;
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    res.writeHead(500); res.end(String((e && e.stack) || e));
  }
});

await new Promise(r => server.listen(PORT, r));

const target = process.argv[2] || '/proposal-v2.html?estimate=ba7cfda3-4b5f-49b6-ab08-0cc1ba20aeaf&template=asphalt-good-better-best';
const outPath = process.argv[3] || (WT + '/docs/proposal-v2/preview-asphalt.png');
const qs = target.split('?')[1] || '';

const apiResp = await fetch(`http://localhost:${PORT}/api/proposal-v2?${qs}`);
const apiJson = await apiResp.text();
console.log('API status', apiResp.status, 'len', apiJson.length);
console.log('API head:', apiJson.slice(0, 1200));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 1000, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto(`http://localhost:${PORT}${target}`, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 1000));
await page.screenshot({ path: outPath, fullPage: true });
console.log('screenshot ->', outPath);
console.log('console errors:', errors.length ? JSON.stringify(errors.slice(0, 12), null, 1) : 'NONE');
await browser.close();
server.close();
