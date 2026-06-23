// Ryujin OS — Invoice PDF Renderer
//
// GET /api/invoice-pdf?token=<shareToken>[&download=<filename.pdf>]
//
// Renders the public invoice page (/invoice-view.html?token=...) via headless
// Chromium and streams back a clean PDF. The invoice page is token-driven and
// fetches its own data, so this just drives it. Light document (no heavy images),
// so no sharp optimization step is needed. Mirrors api/page-pdf.js.
//
// Public endpoint — the share token is the auth (same posture as the page).

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const RYUJIN_BASE = (process.env.RYUJIN_PUBLIC_URL || 'https://ryujin-os.vercel.app').trim();

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const token = String(req.query.token || '').trim();
  if (!token || !/^[a-f0-9]{8,64}$/i.test(token)) {
    return res.status(400).json({ error: 'valid token required' });
  }

  // Sanitize download filename to block header injection / path traversal
  const downloadRaw = String(req.query.download || '').trim();
  const downloadName = (downloadRaw && /^[\w\-. ]{1,120}\.pdf$/i.test(downloadRaw))
    ? downloadRaw
    : 'invoice.pdf';

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: { width: 1100, height: 1500, deviceScaleFactor: 1 }
    });

    const page = await browser.newPage();
    // pdf=1 so the page can suppress the open beacon during a render if it wants.
    const url = `${RYUJIN_BASE}/invoice-view.html?token=${encodeURIComponent(token)}&pdf=1`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });

    // The page fetches its own data; give the render a beat to populate.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 600)));

    await page.addStyleTag({ content: `
      .no-print, [data-hide-in-pdf]{ display:none !important; }
      body{ background:#fff !important; padding:0 !important; }
    `});

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '0.45in', right: '0.45in', bottom: '0.5in', left: '0.45in' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-family:Inter,sans-serif;font-size:8px;color:#666;width:100%;padding:0 0.45in;display:flex;justify-content:space-between">
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
    console.error('[invoice-pdf] render failed', err?.message);
    return res.status(500).json({ error: 'PDF render failed', detail: err?.message || String(err) });
  }
}

export const config = { api: { bodyParser: false } };
