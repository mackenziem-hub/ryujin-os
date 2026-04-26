// Ryujin OS — Proposal PDF Renderer
//
// GET /api/proposal-pdf?share=<share_token>[&download=<filename.pdf>]
//
// Renders proposal-client.html for a given share token via headless Chromium
// (Sparticuz build — Vercel-compatible) and streams back a branded PDF.
//
// Public endpoint (share token is auth). Cold start ~6-8s; warm ~2-3s.
// Function config in vercel.json bumps memory + timeout for Chromium.

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { supabaseAdmin } from '../lib/supabase.js';

const RYUJIN_BASE = (process.env.RYUJIN_PUBLIC_URL || 'https://ryujin-os.vercel.app').trim();

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const share = String(req.query.share || '').trim();
  if (!share) return res.status(400).json({ error: 'Missing ?share=<token>' });

  // Verify the share token exists before spinning up Chromium
  const { data: est, error } = await supabaseAdmin
    .from('estimates')
    .select('id, tenant_id, estimate_number, customer:customers(full_name)')
    .eq('share_token', share)
    .maybeSingle();
  if (error || !est) return res.status(404).json({ error: 'Proposal not found' });

  const downloadName = String(req.query.download || '').trim()
    || `PU-${est.estimate_number || 'proposal'}-${(est.customer?.full_name || 'customer').replace(/[^\w\-]+/g, '_').slice(0, 30)}.pdf`;

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: { width: 1280, height: 1800, deviceScaleFactor: 1 }
    });

    const page = await browser.newPage();

    // Log the proposal view as a pdf_render event (fire-and-forget)
    supabaseAdmin.from('activity_log').insert({
      tenant_id: est.tenant_id,
      entity_type: 'proposal_event',
      entity_id: est.id,
      action: 'pdf_rendered',
      details: { share_token: share, at: new Date().toISOString() }
    }).then(() => {}, () => {});

    const url = `${RYUJIN_BASE}/proposal-client.html?share=${encodeURIComponent(share)}&pdf=1`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });

    // Give rendering helpers a beat to finish (gallery lazy-load, hero fade-in, etc.)
    await page.waitForSelector('#heroPhoto', { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => new Promise(resolve => {
      // Force any lazy images to eager + wait for them
      document.querySelectorAll('img').forEach(i => { i.loading = 'eager'; });
      const imgs = Array.from(document.querySelectorAll('img')).filter(i => !i.complete);
      if (!imgs.length) return resolve();
      let remaining = imgs.length;
      const done = () => { if (--remaining <= 0) resolve(); };
      imgs.forEach(i => { i.addEventListener('load', done); i.addEventListener('error', done); });
      setTimeout(resolve, 6000); // hard cap
    }));

    // Hide the accept form + video controls + interactive-only UI for PDF output
    await page.addStyleTag({ content: `
      .accept-section, .accept-sticky, #linkModal, .vid-wrap video, video,
      .ba-hint, .ba-handle, [data-hide-in-pdf]{ display:none !important; }
      body{ background:#fff !important; }
      .hero-photo::before{ animation:none !important; opacity:0 !important; }
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
    res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    if (browser) { try { await browser.close(); } catch (_) {} }
    console.error('[proposal-pdf] render failed', err?.message);
    return res.status(500).json({ error: 'PDF render failed', detail: err?.message || String(err) });
  }
}

export const config = {
  api: { bodyParser: false }
};
