// Ryujin OS - Proposal v2 PDF Renderer
//
// GET /api/proposal-v2-pdf?slug=<instance slug or share_token>[&download=<file.pdf>]
//
// Renders the customer-facing proposal-v2 page (/p/<slug>) to a real, paginated,
// branded PDF via headless Chromium. Sections never split across a page boundary
// (break-inside avoid per band and card), interactive controls are hidden, and
// the cream + royal + bronze palette is preserved with printBackground.
//
// Public endpoint (the slug or share token is the auth, same model as the page).
// Function config in vercel.json bumps memory + timeout for Chromium.

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { supabaseAdmin } from '../lib/supabase.js';

const RYUJIN_BASE = (process.env.RYUJIN_PUBLIC_URL || 'https://ryujin-os.vercel.app').trim();

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const slug = String(req.query.slug || req.query.instance || '').trim();
  if (!slug) return res.status(400).json({ error: 'Missing ?slug=<instance slug or share token>' });

  // Resolve the instance by slug first, then by share token. Either uniquely
  // identifies the row, mirroring renderInstance in api/proposal-v2.js. Only
  // columns that exist on proposal_instances are selected (no customer_snapshot
  // / ref_id / estimate_number; the name lives in variables, the ref in meta).
  const cols = 'id, tenant_id, slug, share_token, status, variables, data_snapshot';
  let row = null;
  const { data: bySlug } = await supabaseAdmin
    .from('proposal_instances')
    .select(cols)
    .eq('slug', slug)
    .maybeSingle();
  row = bySlug || null;
  if (!row) {
    const { data: byToken } = await supabaseAdmin
      .from('proposal_instances')
      .select(cols)
      .eq('share_token', slug)
      .maybeSingle();
    row = byToken || null;
  }
  if (!row) return res.status(404).json({ error: 'Proposal not found' });

  // Always navigate by the canonical public slug so the /p/:slug rewrite resolves.
  const pageSlug = row.slug || slug;
  const vars = row.variables || {};
  const meta = (row.data_snapshot && row.data_snapshot.meta) || {};
  const custName = (vars.customer && vars.customer.name) || vars.name
    || (row.data_snapshot && row.data_snapshot.customer && row.data_snapshot.customer.name)
    || 'customer';
  const refId = meta.refId || 'proposal';
  const downloadName = String(req.query.download || '').trim()
    || `Plus-Ultra-${refId}-${String(custName).replace(/[^\w\-]+/g, '_').slice(0, 30)}.pdf`;

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: { width: 1100, height: 1600, deviceScaleFactor: 2 }
    });

    const page = await browser.newPage();

    // Log a pdf_rendered event (fire and forget).
    supabaseAdmin.from('activity_log').insert({
      tenant_id: row.tenant_id,
      entity_type: 'proposal_event',
      entity_id: row.id,
      action: 'pdf_rendered',
      details: { slug: pageSlug, at: new Date().toISOString() }
    }).then(() => {}, () => {});

    const url = `${RYUJIN_BASE}/p/${encodeURIComponent(pageSlug)}?pdf=1`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });

    // Give the renderer a beat, then force every lazy image eager and wait for it.
    await page.waitForSelector('.pv2-hero', { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => new Promise(resolve => {
      document.querySelectorAll('img').forEach(i => { i.loading = 'eager'; });
      const imgs = Array.from(document.querySelectorAll('img')).filter(i => !i.complete);
      if (!imgs.length) return resolve();
      let remaining = imgs.length;
      const done = () => { if (--remaining <= 0) resolve(); };
      imgs.forEach(i => { i.addEventListener('load', done); i.addEventListener('error', done); });
      setTimeout(resolve, 6000);
    }));

    // PDF mode: hide every interactive-only control and force clean pagination.
    // break-inside avoid keeps each section and card whole on one page; the
    // stylesheet @media print carries the same rules so the two stay in step.
    await page.addStyleTag({ content: `
      .pv2-pdfbtn, .pv2-modal, .pv2-sig, .pv2-accept__btn, .pv2-total__cta,
      .pv2-tier__pick, .pv2-switch, .pv2-paths, .pv2-panels,
      .pv2-intro-video, .pv2-accept__book, video { display:none !important; }
      .pv2 { background:#fff !important; }
      body, .pv2 { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
      .pv2 .pv2-total { position:static !important; box-shadow:none !important; }
      .pv2 .pv2-tier.best { transform:none !important; }
      .pv2 .pv2-hero { min-height:0 !important; }
      .pv2 .pv2-hero--photo::after { display:none !important; }
      .pv2 h1, .pv2 h2, .pv2 h3, .pv2 .pv2-eyebrow, .pv2 .pv2-accept__eyebrow { break-after:avoid; page-break-after:avoid; }
      .pv2 .pv2-tier, .pv2 .pv2-finding, .pv2 .pv2-review,
      .pv2 .pv2-why__card, .pv2 .pv2-stat, .pv2 .pv2-addon, .pv2 .pv2-team__person,
      .pv2 .pv2-guarantee, .pv2 .pv2-guarantee__item, .pv2 .pv2-letter, .pv2 .pv2-panelimg,
      .pv2 .pv2-scope, .pv2 .pv2-scope__row, .pv2 .pv2-badge,
      .pv2 .pv2-scorecard, .pv2 .pv2-scorecard__row,
      .pv2 .pv2-reveal { break-inside:avoid; page-break-inside:avoid; }
      .pv2 .pv2-compare thead { display:table-header-group; }
      .pv2 .pv2-compare tr { break-inside:avoid; page-break-inside:avoid; }
    `});

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '0.4in', right: '0.4in', bottom: '0.5in', left: '0.4in' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-family:Inter,sans-serif;font-size:8px;color:#5c5a54;width:100%;padding:0 0.4in;display:flex;justify-content:space-between">
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
    console.error('[proposal-v2-pdf] render failed', err?.message);
    return res.status(500).json({ error: 'PDF render failed', detail: err?.message || String(err) });
  }
}

export const config = {
  api: { bodyParser: false }
};
