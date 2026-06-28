/*
 * UltraSlide deck verifier — the verification target for /ultraslide build + refresh.
 *
 * Serves ryujin-os/public over http, loads a deck, walks every slide with the
 * arrow keys (hash nav is same-document and won't re-render the engine), captures
 * console + page errors + failed requests, screenshots a few slides, and exits
 * nonzero if anything errored. Charts are static SVG, so a clean walk == they drew.
 *
 * Usage:
 *   node verify-deck.cjs deck-<slug>.html [shotSlide1 shotSlide2 ...]
 *   node verify-deck.cjs deck-ultraslide-kit.html 1 5 6 7 8
 *
 * Requires puppeteer-core (already in ryujin-os/node_modules) + system Chrome.
 * Override paths with RYUJIN_PUBLIC and CHROME_PATH env vars if they move.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUB = process.env.RYUJIN_PUBLIC || 'C:\\Users\\Owner\\Code\\ryujin-os\\public';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const puppeteer = require(path.join(PUB, '..', 'node_modules', 'puppeteer-core'));

const deck = process.argv[2];
if (!deck) { console.error('usage: node verify-deck.cjs deck-<slug>.html [slideNumsToShoot...]'); process.exit(2); }
const shotNums = process.argv.slice(3).map(Number).filter(Boolean);
const PORT = 5599;
const OUT = path.join(PUB, '..', '_ultraslide_verify');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.json':'application/json', '.ico':'image/x-icon', '.woff2':'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(PUB, p);
  if (!fp.startsWith(PUB) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--window-size=1440,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => { const u = r.url(); if (!/fonts\.(googleapis|gstatic)/.test(u)) errors.push('REQFAIL: ' + u); });

  const base = `http://localhost:${PORT}/${deck}`;
  await page.goto(base, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 900));

  const total = await page.evaluate(() => document.querySelectorAll('.slide').length);
  const svgs = await page.evaluate(() => document.querySelectorAll('svg').length);

  // Walk every slide so every inline script path + chart renders at least once.
  const shots = shotNums.length ? shotNums : [1, Math.ceil(total/2), total];
  let cur = 1;
  for (let n = 1; n <= total; n++) {
    if (n > cur) { for (; cur < n; cur++) { await page.keyboard.press('ArrowRight'); await new Promise(r => setTimeout(r, 180)); } }
    if (shots.includes(n)) { await new Promise(r => setTimeout(r, 500)); await page.screenshot({ path: path.join(OUT, `${deck.replace('.html','')}-slide-${n}.png`) }); }
  }

  await browser.close();
  server.close();
  console.log(`slides=${total} svgs=${svgs} shots=[${shots.join(',')}]`);
  if (errors.length) { console.log('FAIL:\n' + errors.join('\n')); process.exit(1); }
  console.log('OK: zero console/page/request errors. Screenshots in _ultraslide_verify/');
})();
