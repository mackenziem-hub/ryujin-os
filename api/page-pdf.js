// Ryujin OS — Static Page PDF Renderer
//
// GET /api/page-pdf?slug=<page>[&download=<filename.pdf>]
//
// Renders a whitelisted public proposal page (e.g. /ranch-road-rejuvenation.html)
// via headless Chromium and streams back a branded PDF. Whitelist-only so this
// endpoint cannot be abused to render arbitrary pages from the domain.
//
// Public endpoint. Cold start ~6-8s; warm ~2-3s.

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const RYUJIN_BASE = (process.env.RYUJIN_PUBLIC_URL || 'https://ryujin-os.vercel.app').trim();

// Whitelist of allowed page slugs (basename of file under /public/).
// Add entries here as new static rejuvenation / custom proposal pages are created.
const ALLOWED_SLUGS = new Set([
  'ranch-road-rejuvenation',
  'rejuvenation-template',
  'tara-court-proposal',
  'tara-court-aphl',
  'proposal-715-rt-11',
  'lefurgey-gutter-proposal',
  'nanoseal-partnership',
  'handbook-outside-sales',
  'proposals/catherine-ablak-62-charlotte-metal',
  'proposals/desiree-whirl-67-charlotte-metal'
]);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const slug = String(req.query.slug || '').trim();
  if (!slug || !ALLOWED_SLUGS.has(slug)) {
    return res.status(404).json({ error: 'Unknown page slug' });
  }

  // Sanitize download filename to block header injection / path traversal
  const downloadRaw = String(req.query.download || '').trim();
  const downloadName = (downloadRaw && /^[\w\-. ]{1,120}\.pdf$/i.test(downloadRaw))
    ? downloadRaw
    : `${slug}.pdf`;

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: { width: 1280, height: 1800, deviceScaleFactor: 1 }
    });

    const page = await browser.newPage();
    const url = `${RYUJIN_BASE}/${slug}.html?pdf=1`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });

    // Force lazy images eager + wait for completion (hero cover, gallery)
    await page.evaluate(() => new Promise(resolve => {
      document.querySelectorAll('img').forEach(i => { i.loading = 'eager'; });
      const imgs = Array.from(document.querySelectorAll('img')).filter(i => !i.complete);
      if (!imgs.length) return resolve();
      let remaining = imgs.length;
      const done = () => { if (--remaining <= 0) resolve(); };
      imgs.forEach(i => { i.addEventListener('load', done); i.addEventListener('error', done); });
      setTimeout(resolve, 6000);
    }));

    // Hide the print button itself + any other interactive-only UI
    await page.addStyleTag({ content: `
      .pu-print-btn, [data-hide-in-pdf]{ display:none !important; }
      body{ background:#fff !important; }
    `});

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '0.4in', right: '0.4in', bottom: '0.5in', left: '0.4in' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-family:Inter,sans-serif;font-size:8px;color:#666;width:100%;padding:0 0.4in;display:flex;justify-content:space-between">
          <span>Plus Ultra Roofing &middot; plusultraroofing.com &middot; (506) 540-1052</span>
          <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>
      `
    });

    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    if (browser) { try { await browser.close(); } catch (_) { /* ignore */ } }
    console.error('[page-pdf] render failed', err?.message);
    return res.status(500).json({ error: 'PDF render failed', detail: err?.message || String(err) });
  }
}

export const config = {
  api: { bodyParser: false }
};
