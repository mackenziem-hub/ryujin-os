// Ryujin OS — Detailed Pricing Breakdown PDF
//
// GET /api/breakdown-pdf?share=<share_token>[&download=<filename.pdf>]
//
// Customer-facing line-item breakdown where:
//   - Materials are shown at our supply cost (transparent, itemized)
//   - Labor lines absorb the entire margin (multiplier markup folded in)
// Sums to the locked customer-facing tier price exactly.
//
// Uses puppeteer-core + @sparticuz/chromium (same stack as proposal-pdf).
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { supabaseAdmin } from '../lib/supabase.js';
import { calculateMultiOfferQuote } from '../lib/quoteEngineV3.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const share = String(req.query.share || '').trim();
  if (!share) return res.status(400).json({ error: 'Missing ?share=<token>' });

  const { data: est, error } = await supabaseAdmin
    .from('estimates')
    .select(`
      id, tenant_id, estimate_number, share_token,
      roof_area_sqft, roof_pitch, complexity, distance_km, planes,
      eaves_lf, rakes_lf, ridges_lf, valleys_lf, hips_lf, walls_lf,
      pipes, vents, chimneys, chimney_size, extra_layers, stories,
      calculated_packages, customer_id,
      customer:customers(full_name, address, city, province)
    `)
    .eq('share_token', share)
    .maybeSingle();
  if (error || !est) return res.status(404).json({ error: 'Proposal not found' });

  // Re-run engine to get line items (some locked estimates have empty lineItems)
  const measurements = {
    squareFeet: est.roof_area_sqft || 0,
    pitch: est.roof_pitch || '5/12',
    complexity: est.complexity || 'medium',
    distanceKM: est.distance_km || 0,
    extraLayers: est.extra_layers || 0,
    eavesLF: est.eaves_lf || 0,
    rakesLF: est.rakes_lf || 0,
    ridgesLF: est.ridges_lf || 0,
    valleysLF: est.valleys_lf || 0,
    hipsLF: est.hips_lf || 0,
    wallsLF: est.walls_lf || 0,
    pipes: est.pipes || 0,
    vents: est.vents || 0,
    chimneys: est.chimneys || 0,
    chimneySize: est.chimney_size || 'small',
    stories: est.stories || 1
  };
  if (Array.isArray(est.planes) && est.planes.length > 0) measurements.planes = est.planes;

  const { data: offers } = await supabaseAdmin
    .from('offers').select('id, slug').eq('tenant_id', est.tenant_id)
    .in('slug', ['gold', 'platinum', 'diamond']);
  const engineQuote = await calculateMultiOfferQuote(supabaseAdmin, {
    tenantId: est.tenant_id, offerIds: offers.map(o => o.id), measurements
  });

  // ─── Build per-tier breakdown ────────────────────────────────
  const tiers = [];
  for (const slug of ['gold', 'platinum', 'diamond']) {
    const lockedTier = est.calculated_packages?.[slug];
    const engineTier = engineQuote.offers?.[slug];
    if (!lockedTier || !engineTier) continue;

    const items = (engineTier.lineItems || []).filter(li => li.included && li.total_cost > 0);
    const materials = items.filter(li => li.category === 'materials');
    const matSubtotal = materials.reduce((s, l) => s + l.total_cost, 0);

    // calculated_packages comes in two shapes: older rows store the pre-tax
    // selling price at lockedTier.total; newer engine output nests it under
    // lockedTier.summary.sellingPrice (top-level total absent). Read both, else
    // `sell` is undefined and every $ in the tier renders as $NaN (live on
    // accepted estimate #30 / draft #29). Skip a tier we genuinely can't price
    // rather than print a $NaN row.
    const sell = Number(lockedTier.total ?? lockedTier.summary?.sellingPrice ?? 0);
    if (!(sell > 0)) continue;
    const laborBudget = Math.max(0, sell - matSubtotal);

    // Site supervision + project management + workmanship-warranty backing are
    // folded into the install line (was a separate 8% allocation). Customers
    // shouldn't see a $700 line item labeled "supervisor" — it reads like a
    // line item they could remove. It's part of doing the work, not an add-on.
    const allocations = [
      { label: 'Tear-off, deck inspection & disposal', share: 0.15 },
      { label: 'Roofing system installation (skilled crew, multi-day)', share: 0.73 },
      { label: 'Flashing, ventilation & detail work', share: 0.12 }
    ];
    let allocated = 0;
    for (let i = 0; i < allocations.length - 1; i++) {
      allocations[i].amount = Math.round(laborBudget * allocations[i].share);
      allocated += allocations[i].amount;
    }
    allocations[allocations.length - 1].amount = laborBudget - allocated;

    const tax = Math.round(sell * 0.15 * 100) / 100;
    const total = Math.round((sell + tax) * 100) / 100;
    const warrantyYears = slug === 'gold' ? 15 : slug === 'platinum' ? 20 : 25;

    tiers.push({
      slug, sell, tax, total, matSubtotal, materials, laborLines: allocations, laborBudget, warrantyYears
    });
  }

  const $ = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const $w = n => '$' + Math.round(n).toLocaleString();
  const customerName = est.customer?.full_name || 'Valued Customer';
  const customerAddress = [est.customer?.address, est.customer?.city, est.customer?.province].filter(Boolean).join(', ');
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const downloadName = String(req.query.download || '').trim()
    || `PU-Breakdown-${est.estimate_number || 'estimate'}-${(customerName).replace(/[^\w\-]+/g, '_').slice(0, 30)}.pdf`;

  // ─── HTML template ───────────────────────────────────────────
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Detailed Breakdown · ${customerName}</title>
<style>
  @page { size: Letter; margin: 0.5in 0.5in 0.6in 0.5in; }
  *{box-sizing:border-box}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1d1d1d;line-height:1.45;font-size:10.5pt;margin:0;background:#f4f1ec}
  .page{background:#fff;max-width:8.5in;margin:0 auto}

  /* Desktop screen — give the document some breathing room and a card-like frame */
  @media screen and (min-width: 721px){
    body{padding:36px 24px}
    .page{padding:48px 56px;border-radius:10px;box-shadow:0 6px 28px rgba(60,40,20,0.10);border:1px solid #e6e0d6}
  }
  /* Print/PDF — flat, no card, full bleed within @page margins */
  @media print{
    body{padding:0;background:#fff}
    .page{padding:0;border:none;box-shadow:none;border-radius:0;max-width:none}
  }
  h1,h2,h3{font-family:'Helvetica Neue',Arial,sans-serif;font-weight:800;color:#0f1622;margin:0;line-height:1.15}
  h1{font-size:22pt;letter-spacing:-0.01em}
  h2{font-size:13pt;letter-spacing:0.01em;text-transform:uppercase;color:#c44a17}
  h3{font-size:11pt;color:#1d1d1d;margin-top:10px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #c44a17;padding-bottom:14px;margin-bottom:18px}
  .brand{font-size:14pt;font-weight:800;color:#0f1622;letter-spacing:0.04em}
  .brand-tag{font-size:8.5pt;color:#666;margin-top:3px;font-weight:500}
  .meta{text-align:right;font-size:9pt;color:#444;line-height:1.5}
  .meta strong{color:#0f1622;font-weight:700}
  .intro{background:#f7f3ee;border-left:3px solid #c44a17;padding:11px 14px;margin:0 0 22px;border-radius:0 6px 6px 0;font-size:9.5pt;color:#3a3a3a}
  .tier{margin-bottom:26px;page-break-inside:avoid}
  .tier-header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0f1622;padding-bottom:8px;margin-bottom:10px}
  .tier-warranty{font-size:9pt;color:#666;font-weight:500}
  table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:9.5pt}
  thead th{text-align:left;font-weight:700;font-size:8.5pt;letter-spacing:0.06em;text-transform:uppercase;color:#666;border-bottom:1px solid #ddd;padding:7px 8px;background:#fafafa}
  thead th.right,td.right{text-align:right}
  thead th.center,td.center{text-align:center}
  tbody td{padding:6px 8px;border-bottom:1px solid #f0f0f0;vertical-align:top}
  tbody tr:last-child td{border-bottom:none}
  tr.subtotal td{padding-top:8px;border-top:1px solid #ddd;font-weight:700;color:#0f1622;background:#fafafa}
  tr.grand td{padding:11px 8px;border-top:2px solid #0f1622;border-bottom:none;font-weight:800;color:#0f1622;font-size:11pt;background:#fff}
  tr.tax td{color:#666;font-weight:500}
  tr.final td{padding:13px 8px;border-top:2px solid #c44a17;border-bottom:3px solid #c44a17;font-weight:800;color:#c44a17;font-size:13pt;background:#fdf6ee}
  .section-label{font-size:9pt;font-weight:700;color:#666;letter-spacing:0.08em;text-transform:uppercase;margin:14px 0 4px}
  footer{margin-top:32px;padding-top:14px;border-top:1px solid #ddd;font-size:8pt;color:#666;line-height:1.6}
  footer strong{color:#0f1622}
  .disclaimer{margin-top:8px;font-style:italic;color:#888;font-size:7.5pt}

  /* Mobile-first overrides — only apply on actual screens, not PDF render. */
  @media screen and (max-width: 720px){
    body{font-size:15px;padding:14px;line-height:1.5}
    h1{font-size:24px}
    h2{font-size:17px}
    h3{font-size:16px}
    .header{flex-direction:column;align-items:stretch;gap:10px;padding-bottom:12px;margin-bottom:14px}
    .brand{font-size:18px}
    .meta{text-align:left;font-size:14px}
    .intro{font-size:14px;padding:12px 14px;margin-bottom:18px}
    .tier{margin-bottom:24px}
    .tier-header{flex-direction:column;align-items:flex-start;gap:4px}
    .tier-warranty{font-size:13px}
    .section-label{font-size:13px;margin:14px 0 6px}
    /* Make tables stack readably on phones */
    table{font-size:14px;display:block;width:100%}
    thead{display:none}
    tbody{display:block;width:100%}
    tbody tr{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;padding:10px 0;border-bottom:1px solid #eee}
    tbody tr:last-child{border-bottom:none}
    tbody td{display:block;padding:0;border:none;flex:1 1 auto}
    tbody td:first-child{flex:1 1 100%;font-weight:500;color:#0f1622;margin-bottom:2px}
    tbody td.center,tbody td.right{flex:0 0 auto;font-weight:600;color:#0f1622}
    tr.subtotal{background:#fafafa;border-radius:6px;padding:10px 12px !important;margin:6px 0;border:1px solid #e8e8e8}
    tr.subtotal td{font-size:14px}
    tr.subtotal td:first-child{flex:1 1 auto}
    tr.grand,tr.tax,tr.final{padding:10px 12px !important;border-radius:6px;margin:4px 0}
    tr.grand{background:#fafafa;border:1px solid #ddd}
    tr.tax{background:transparent;border:none;padding:6px 12px !important}
    tr.final{background:#fdf6ee;border:2px solid #c44a17}
    tr.final td{font-size:18px;color:#c44a17}
    footer{font-size:11px;padding-top:12px}
    .disclaimer{font-size:10.5px}
  }
</style>
</head>
<body>
<div class="page">

<div class="header">
  <div>
    <div class="brand">PLUS ULTRA ROOFING</div>
    <div class="brand-tag">Detailed Pricing Breakdown</div>
  </div>
  <div class="meta">
    <strong>${customerName}</strong><br>
    ${customerAddress}<br>
    Estimate #${est.estimate_number || ''} &middot; ${today}
  </div>
</div>

<div class="intro">
  <strong>How to read this:</strong> Materials are shown at our supplier cost, line by line, exactly what's going on your roof. The Labor &amp; Installation section reflects the full cost of skilled crew, site management, and our workmanship warranty backing every project. The total at the bottom of each package is the price you've been quoted.
</div>

${tiers.map(t => `
<div class="tier">
  <div class="tier-header">
    <h2>${t.slug.toUpperCase()} Package</h2>
    <span class="tier-warranty">${t.warrantyYears}-year workmanship warranty</span>
  </div>

  <div class="section-label">Materials (at our supplier cost)</div>
  <table>
    <thead><tr>
      <th>Item</th>
      <th class="center" style="width:90px">Quantity</th>
      <th class="right" style="width:100px">Subtotal</th>
    </tr></thead>
    <tbody>
      ${t.materials.map(m => `
      <tr>
        <td>${(m.label || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</td>
        <td class="center">${m.quantity} ${m.unit || ''}</td>
        <td class="right">${$w(m.total_cost)}</td>
      </tr>`).join('')}
      <tr class="subtotal">
        <td colspan="2">Materials subtotal</td>
        <td class="right">${$w(t.matSubtotal)}</td>
      </tr>
    </tbody>
  </table>

  <div class="section-label">Labor &amp; Installation</div>
  <table>
    <thead><tr>
      <th>Service</th>
      <th class="right" style="width:100px">Subtotal</th>
    </tr></thead>
    <tbody>
      ${t.laborLines.map(l => `
      <tr>
        <td>${l.label}</td>
        <td class="right">${$w(l.amount)}</td>
      </tr>`).join('')}
      <tr class="subtotal">
        <td>Labor subtotal</td>
        <td class="right">${$w(t.laborBudget)}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-top:6px">
    <tbody>
      <tr class="grand">
        <td>Pre-tax total</td>
        <td class="right">${$w(t.sell)}</td>
      </tr>
      <tr class="tax">
        <td>HST (15%)</td>
        <td class="right">${$w(t.tax)}</td>
      </tr>
      <tr class="final">
        <td>${t.slug.toUpperCase()} package · final price</td>
        <td class="right">${$w(t.total)}</td>
      </tr>
    </tbody>
  </table>
</div>
`).join('')}

<footer>
  <strong>Plus Ultra Roofing</strong> &middot; (506) 540-1052 &middot; plusultraroofing@gmail.com &middot; plusultraroofing.com<br>
  CertainTeed Certified &middot; Licensed in NB &middot; 50–100 install photos via CompanyCam<br>
  <div class="disclaimer">
    Material quantities are calculated using EagleView measurements and our standard waste factors. Final material draw on the project may vary slightly based on site conditions; any unused material is credited back. Labor prices reflect skilled-trade rates including site setup, safety equipment, daily cleanup, project management, and the workmanship warranty for the chosen package tier. Quote valid for 30 days from issue date.
  </div>
</footer>

</div><!-- /.page -->
</body>
</html>`;

  // ─── HTML mode — skip puppeteer, return raw HTML ─────────────
  if (String(req.query.format || '').toLowerCase() === 'html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).send(html);
  }

  // ─── Render to PDF ────────────────────────────────────────────
  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: { width: 1024, height: 1400, deviceScaleFactor: 1 }
    });
    const page = await browser.newPage();
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-family:Helvetica,Arial,sans-serif;font-size:7pt;color:#888;width:100%;padding:0 0.5in;display:flex;justify-content:space-between">
          <span>Plus Ultra Roofing &middot; Detailed Pricing Breakdown</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>`,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.6in', left: '0.5in' }
    });
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    if (browser) { try { await browser.close(); } catch (_) {} }
    console.error('[breakdown-pdf] render failed', err?.message);
    return res.status(500).json({ error: 'PDF render failed', detail: err?.message || String(err) });
  }
}

export const config = { api: { bodyParser: false } };
