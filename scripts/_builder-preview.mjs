// Local harness: serve the block-builder + route its APIs to the real handlers,
// screenshot it headless (NOT committed).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const WT = 'C:/Users/Owner/Code/ryujin-wt-pv2';
const PORT = 5188;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROD = 'https://ryujin-os.vercel.app';
const imp = p => import(pathToFileURL(WT + p).href).then(m => m.default);

const handlers = {
  '/api/proposal-blocks': await imp('/api/proposal-blocks.js'),
  '/api/proposal-templates': await imp('/api/proposal-templates.js'),
  '/api/estimates': await imp('/api/estimates.js'),
  '/api/proposal-v2': await imp('/api/proposal-v2.js')
};

function captureRes() {
  const r = { _s: 200, _b: '', _h: { 'Content-Type': 'application/json' } };
  r.status = c => { r._s = c; return r; };
  r.setHeader = (k, v) => { r._h[k] = v; return r; };
  r.json = o => { r._b = JSON.stringify(o); return r; };
  r.send = s => { r._b = typeof s === 'string' ? s : JSON.stringify(s); return r; };
  r.end = s => { if (s != null) r._b = s; return r; };
  r.redirect = (c, l) => { r._s = c; r._h.Location = l; return r; };
  return r;
}
function readBody(req) {
  return new Promise(resolve => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } }); });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  try {
    if (p === '/api/estimates') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ estimates: [
        { id: 'ba7cfda3-4b5f-49b6-ab08-0cc1ba20aeaf', estimate_number: 76, status: 'draft', customer: { full_name: 'Guy Langis', address: '141 Maplehurst Dr', city: 'Moncton' } },
        { id: '4f6c5130-ad34-4b38-8b87-87a20baa8caa', estimate_number: 77, status: 'draft', customer: { full_name: 'Catherine Ablak', address: '62 Charlotte', city: 'Moncton' } }
      ] }));
      return;
    }
    if (handlers[p]) {
      const query = Object.fromEntries(u.searchParams.entries());
      const body = req.method === 'POST' ? await readBody(req) : {};
      const cr = captureRes();
      await handlers[p]({ method: req.method, headers: { 'x-tenant-id': 'plus-ultra', accept: 'application/json' }, query, body }, cr);
      res.writeHead(cr._s, cr._h); res.end(cr._b || '{}'); return;
    }
    if (p === '/admin-proposal-builder.html' || p === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(readFileSync(WT + '/public/admin-proposal-builder.html', 'utf8')); return; }
    if (p === '/proposal-v2.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(readFileSync(WT + '/public/proposal-v2.html', 'utf8')); return; }
    if (p === '/proposal-v2.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end(readFileSync(WT + '/public/proposal-v2.css', 'utf8')); return; }
    if (p.startsWith('/brand') || p.startsWith('/proposal-assets') || p.startsWith('/assets')) {
      const r = await fetch(PROD + p); const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream' }); res.end(buf); return;
    }
    res.writeHead(404); res.end('not found');
  } catch (e) { res.writeHead(500); res.end(String((e && e.stack) || e)); }
});

await new Promise(r => server.listen(PORT, r));
const out = process.argv[2] || (WT + '/docs/proposal-v2/builder.png');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto(`http://localhost:${PORT}/admin-proposal-builder.html`, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 1200));
// Pick the first estimate in the list (if the page exposes a global helper), else just shoot initial state.
const injected = await page.evaluate(async () => {
  // 1. Select the asphalt template so the left composition rail populates.
  const sel = document.getElementById('templateSelect');
  if (sel) {
    const opt = Array.from(sel.options).find(o => /asphalt/i.test(o.value) || /asphalt/i.test(o.textContent));
    if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  await new Promise(r => setTimeout(r, 800));
  // 2. Reveal the preview + inject real ProposalData (simulating an estimate pick).
  const ov = document.getElementById('previewOverlay'); if (ov) ov.classList.add('hidden');
  const r = await fetch('/api/proposal-v2?tenant=plus-ultra', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estimate: 'ba7cfda3-4b5f-49b6-ab08-0cc1ba20aeaf', template: { slug: 'asphalt-good-better-best', name: 'Asphalt', sections: ['hero', 'intro', 'scope', 'products', 'proof', 'reviews', 'why_us', 'guarantee', 'comparison', 'accept'], product_plan: { mode: 'good_better_best', offer_slugs: ['gold', 'platinum', 'diamond'], recommended: 'platinum' } } })
  });
  const data = await r.json();
  const iframe = document.getElementById('previewFrame');
  if (iframe && iframe.contentWindow && data && data.sections) {
    iframe.contentWindow.postMessage({ type: 'pv2-preview', data }, '*');
    return 'rail=' + document.querySelectorAll('.sec-row').length + ' previewSections=' + data.sections.length;
  }
  return 'fail';
});
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: out, fullPage: false });
console.log('preview inject:', injected);
console.log('shot ->', out);
console.log('console errors:', errors.length ? JSON.stringify(errors.slice(0, 10), null, 1) : 'NONE');
await browser.close(); server.close();
