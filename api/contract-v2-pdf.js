// Ryujin OS - Contract v2 PDF Renderer
//
// GET /api/contract-v2-pdf?instance=<slug>&tier=<tierId>[&panel=<key>][&download=<filename.pdf>]
//
// Renders contract-v2.html for a given proposal instance via headless Chromium
// (Sparticuz build - Vercel-compatible) and streams back a branded PDF. The
// page is rendered in pdf=1 mode: radios, buttons, and the signature pad chrome
// are hidden, the requested tier is pinned, and a sentinel flag flips once the
// contract body has rendered and images have loaded.
//
// Public endpoint (the instance slug / share token is the auth). Cold start
// ~6-8s; warm ~2-3s. Function config in vercel.json bumps memory + timeout.

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { supabaseAdmin } from '../lib/supabase.js';

const RYUJIN_BASE = (process.env.RYUJIN_PUBLIC_URL || 'https://ryujin-os.vercel.app').trim();

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // The instance can be addressed as ?instance= (canonical) or ?slug= (alias).
  const slug = String(req.query.instance || req.query.slug || '').trim();
  if (!slug) return res.status(400).json({ error: 'Missing ?instance=<slug>' });

  // Resolve the proposal_instances row by slug then share_token (mirror the
  // proposal-v2 renderInstance lookup) before spinning up Chromium.
  let inst = null;
  const { data: bySlug } = await supabaseAdmin
    .from('proposal_instances')
    .select('id, tenant_id, slug, estimate_id')
    .eq('slug', slug)
    .maybeSingle();
  inst = bySlug || null;
  if (!inst) {
    const { data: byToken } = await supabaseAdmin
      .from('proposal_instances')
      .select('id, tenant_id, slug, estimate_id')
      .eq('share_token', slug)
      .maybeSingle();
    inst = byToken || null;
  }
  if (!inst) return res.status(404).json({ error: 'Contract not found' });

  const tier = String(req.query.tier || '').trim();
  const panel = String(req.query.panel || '').trim();

  const downloadName = String(req.query.download || '').trim()
    || `PU-contract-${(inst.slug || 'proposal').replace(/[^\w\-]+/g, '_').slice(0, 40)}.pdf`;

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: { width: 1280, height: 1800, deviceScaleFactor: 1 }
    });

    const page = await browser.newPage();

    const enc = encodeURIComponent;
    const url = `${RYUJIN_BASE}/contract-v2.html?instance=${enc(inst.slug)}`
      + `&tier=${enc(tier)}${panel ? ('&panel=' + enc(panel)) : ''}&pdf=1`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });

    // Wait for the page to signal that the contract body has rendered, the tier
    // is pinned, and the first paint is settled. The flag flips even on a render
    // error (finally-style path) so a broken render still produces a PDF.
    await page.waitForFunction(() => window.__CONTRACT_READY === true, { timeout: 15000 }).catch(() => {});

    // Force any lazy images to eager + wait for them so nothing renders blank.
    await page.evaluate(() => new Promise(resolve => {
      document.querySelectorAll('img').forEach(i => { i.loading = 'eager'; });
      const imgs = Array.from(document.querySelectorAll('img')).filter(i => !i.complete);
      if (!imgs.length) return resolve();
      let remaining = imgs.length;
      const done = () => { if (--remaining <= 0) resolve(); };
      imgs.forEach(i => { i.addEventListener('load', done); i.addEventListener('error', done); });
      setTimeout(resolve, 6000); // hard cap
    }));

    // Print hardening: hide the interactive controls (radios, buttons, signature
    // pad chrome), keep each contract section whole across page breaks, and force
    // a white canvas so the PDF reads like a clean printed contract.
    await page.addStyleTag({ content: `
      input[type="radio"], button, .cv2-sig__clear, .cv2-sig__row,
      [data-hide-in-pdf]{ display:none !important; }
      .cv2-section, .cv2-block{ break-inside:avoid; page-break-inside:avoid; }
      .pv2{ background:#fff !important; }
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

    // Audit trail: a contract PDF was rendered for this instance (fire-and-forget).
    supabaseAdmin.from('activity_log').insert({
      tenant_id: inst.tenant_id,
      entity_type: 'contract_event',
      entity_id: inst.id,
      action: 'contract_pdf_rendered',
      details: { instance: inst.slug, tier: tier || null, at: new Date().toISOString() }
    }).then(() => {}, () => {});

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    if (browser) { try { await browser.close(); } catch (_) {} }
    console.error('[contract-v2-pdf] render failed', err?.message);
    return res.status(500).json({ error: 'PDF render failed', detail: err?.message || String(err) });
  }
}

export const config = {
  api: { bodyParser: false }
};
