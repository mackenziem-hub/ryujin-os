// Ryujin OS — Document PDF Renderer
//
// GET /api/docs-pdf?slug=<doc-slug>&tenant=<tenant-slug>
//
// Renders /doc.html?slug=X&pdf=1 via headless Chromium and streams a branded PDF.
// Mirrors api/proposal-pdf.js — same Sparticuz Chromium pattern, Letter, branded footer.

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

const RYUJIN_BASE = (process.env.RYUJIN_PUBLIC_URL || 'https://ryujin-os.vercel.app').trim();

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const slug = String(req.query.slug || '').trim().toLowerCase();
  if (!slug) return res.status(400).json({ error: 'Missing ?slug=' });

  const { data: doc, error } = await supabaseAdmin
    .from('docs')
    .select('id, slug, title')
    .eq('tenant_id', req.tenant.id)
    .eq('slug', slug)
    .maybeSingle();
  if (error || !doc) return res.status(404).json({ error: 'Doc not found' });

  const downloadName = `${doc.slug}-${new Date().toISOString().slice(0, 10)}.pdf`;

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: { width: 1280, height: 1800, deviceScaleFactor: 1 }
    });

    const page = await browser.newPage();
    const url = `${RYUJIN_BASE}/doc.html?slug=${encodeURIComponent(slug)}&tenant=${encodeURIComponent(req.tenant.slug)}&pdf=1`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });

    // Wait for the renderer to finish (replaces the loading spinner)
    await page.waitForFunction(() => {
      const app = document.getElementById('app');
      return app && !app.classList.contains('loading');
    }, { timeout: 15000 }).catch(() => {});

    // Force eager image load + wait
    await page.evaluate(() => new Promise(resolve => {
      document.querySelectorAll('img').forEach(i => { i.loading = 'eager'; });
      const imgs = Array.from(document.querySelectorAll('img')).filter(i => !i.complete);
      if (!imgs.length) return resolve();
      let remaining = imgs.length;
      const done = () => { if (--remaining <= 0) resolve(); };
      imgs.forEach(i => { i.addEventListener('load', done); i.addEventListener('error', done); });
      setTimeout(resolve, 6000);
    }));

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.45in', right: '0.4in', bottom: '0.5in', left: '0.4in' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-family:Inter,sans-serif;font-size:8px;color:#666;width:100%;padding:0 0.4in;display:flex;justify-content:space-between">
          <span>Plus Ultra Roofing &middot; ${doc.title.replace(/[<>&]/g, '')}</span>
          <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>
      `
    });

    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    if (browser) { try { await browser.close(); } catch (_) {} }
    console.error('[docs-pdf] render failed', err?.message);
    return res.status(500).json({ error: 'PDF render failed', detail: err?.message || String(err) });
  }
}

export default requireTenant(handler);

export const config = {
  api: { bodyParser: false }
};
