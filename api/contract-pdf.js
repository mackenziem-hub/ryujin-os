// Ryujin OS — Contract PDF Renderer
//
// GET /api/contract-pdf?share=<share_token>[&tier=gold|platinum|diamond][&download=<filename.pdf>]
//
// Generates a server-side HTML contract for a given share token + tier and
// renders it to PDF via headless Chromium (Sparticuz build, Vercel-compatible).
//
// Default tier resolution (in order): ?tier= → estimate.selected_package →
// estimate's accepted_tier → 'platinum'.
//
// Public endpoint (share token is auth). Cold start ~6-8s.

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { supabaseAdmin } from '../lib/supabase.js';
import { generateContract } from '../lib/outputGenerators.js';
import { DEFAULT_BRAND } from '../lib/brandDefaults.js';

// Sourced from the shared platform default (white-label PR3); the contract
// document keeps its own navy accent, distinct from the sales-page orange.
const BRANDING_DEFAULT = {
  companyName: DEFAULT_BRAND.companyName,
  phone: DEFAULT_BRAND.phone,
  email: DEFAULT_BRAND.email,
  website: DEFAULT_BRAND.website,
  address: DEFAULT_BRAND.address,
  accentColor: DEFAULT_BRAND.contractAccent
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function buildContractHtml(contract, branding) {
  const accent = branding.accentColor || BRANDING_DEFAULT.accentColor;
  const scopeHtml = contract.scope.map(s => `
    <div class="scope-block">
      <h3>${escapeHtml(s.category)}</h3>
      <ul>${s.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
    </div>
  `).join('');

  const paymentRows = contract.payment.schedule.map(p => `
    <tr>
      <td>${escapeHtml(p.milestone)}</td>
      <td class="num">${escapeHtml(p.percentFormatted)}</td>
      <td class="num">${escapeHtml(p.amountFormatted)}</td>
    </tr>
  `).join('');

  const termsHtml = contract.terms.map(t => `<li>${escapeHtml(t)}</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Contract — ${escapeHtml(contract.contractor.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #1a1a1a; font-size: 10.5pt; line-height: 1.45; margin: 0; }
  h1, h2, h3 { color: ${accent}; margin: 0 0 8px; }
  h1 { font-size: 22pt; letter-spacing: -0.5px; }
  h2 { font-size: 13pt; border-bottom: 1.5px solid ${accent}; padding-bottom: 4px; margin-top: 18px; }
  h3 { font-size: 11pt; margin-top: 10px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 12px; border-bottom: 2px solid ${accent}; }
  .brand { font-weight: 800; font-size: 18pt; color: ${accent}; letter-spacing: -0.3px; }
  .brand-meta { font-size: 9pt; color: #555; line-height: 1.5; text-align: right; }
  .doc-meta { display: flex; justify-content: space-between; font-size: 9.5pt; color: #555; margin: 10px 0 14px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 14px 0; }
  .party { background: #f7f8fa; padding: 10px 14px; border-radius: 6px; border-left: 3px solid ${accent}; }
  .party .label { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.5px; color: #777; }
  .party .name { font-weight: 700; font-size: 11pt; margin-top: 2px; }
  .party .detail { font-size: 9.5pt; color: #555; }
  .scope-block { margin-bottom: 8px; }
  .scope-block ul { margin: 4px 0 0 18px; padding: 0; }
  .scope-block li { margin: 2px 0; }
  .price-block { background: #f7f8fa; padding: 12px 16px; border-radius: 6px; margin: 10px 0; }
  .price-row { display: flex; justify-content: space-between; padding: 4px 0; }
  .price-row.total { border-top: 1.5px solid ${accent}; margin-top: 6px; padding-top: 8px; font-weight: 700; font-size: 12pt; color: ${accent}; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; }
  table th, table td { padding: 6px 10px; border-bottom: 1px solid #e0e0e0; text-align: left; font-size: 10pt; }
  table th { background: #f7f8fa; font-weight: 600; }
  table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .terms-list { margin: 6px 0 0 18px; padding: 0; }
  .terms-list li { margin: 4px 0; font-size: 10pt; }
  .warranty-block { background: #fffaeb; border-left: 3px solid #f5a623; padding: 10px 14px; margin: 10px 0; border-radius: 4px; }
  .warranty-block strong { color: ${accent}; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 26px; page-break-inside: avoid; }
  .sig-col { padding: 10px 0; }
  .sig-col .label { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.5px; color: #777; margin-bottom: 4px; }
  .sig-line { border-bottom: 1px solid #1a1a1a; height: 22px; }
  .sig-row { display: flex; gap: 14px; margin-top: 8px; font-size: 9pt; color: #555; }
  .sig-row > div { flex: 1; }
  .footer-note { font-size: 8.5pt; color: #888; text-align: center; margin-top: 16px; padding-top: 8px; border-top: 1px solid #e0e0e0; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${escapeHtml(contract.contractor.name)}</div>
      <div style="font-size:9pt;color:#666;margin-top:2px;">Contract for Roofing Services</div>
    </div>
    <div class="brand-meta">
      ${escapeHtml(contract.contractor.phone)}<br>
      ${escapeHtml(contract.contractor.email)}<br>
      ${escapeHtml(contract.contractor.website)}<br>
      ${escapeHtml(branding.address || '')}
    </div>
  </div>

  <div class="doc-meta">
    <div><strong>Date:</strong> ${escapeHtml(contract.details.date)}</div>
    <div><strong>Package:</strong> ${escapeHtml(contract.details.offerName)}</div>
    <div><strong>Valid Until:</strong> ${escapeHtml(contract.details.validUntil)}</div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="label">Contractor</div>
      <div class="name">${escapeHtml(contract.contractor.name)}</div>
      <div class="detail">${escapeHtml(contract.contractor.phone)}<br>${escapeHtml(contract.contractor.email)}</div>
    </div>
    <div class="party">
      <div class="label">Customer</div>
      <div class="name">${escapeHtml(contract.customer.name || 'TBD')}</div>
      <div class="detail">${escapeHtml(contract.customer.address || '')}</div>
    </div>
  </div>

  <h2>Scope of Work</h2>
  ${scopeHtml}

  <h2>Pricing</h2>
  <div class="price-block">
    <div class="price-row"><span>Subtotal</span><span class="num">${escapeHtml(contract.pricing.priceFormatted)}</span></div>
    <div class="price-row"><span>${escapeHtml(contract.pricing.taxLabel)}${contract.pricing.price > 0 ? ` (${(contract.pricing.tax / contract.pricing.price * 100).toFixed(0)}%)` : ''}</span><span class="num">${escapeHtml(contract.pricing.taxFormatted)}</span></div>
    <div class="price-row total"><span>Total Contract Price</span><span class="num">${escapeHtml(contract.pricing.totalFormatted)}</span></div>
  </div>

  <h2>Payment Schedule</h2>
  <table>
    <thead><tr><th>Milestone</th><th class="num">Percent</th><th class="num">Amount</th></tr></thead>
    <tbody>${paymentRows}</tbody>
  </table>

  <h2>Workmanship Warranty</h2>
  <div class="warranty-block">
    <strong>${contract.warranty.workmanshipYears}-year workmanship warranty.</strong> ${escapeHtml(contract.warranty.text.replace(/^[^.]*\.\s*/, ''))}
    ${contract.warranty.remediationNote ? `<br><br><em>${escapeHtml(contract.warranty.remediationNote)}</em>` : ''}
  </div>

  <h2>Terms & Conditions</h2>
  <ol class="terms-list">${termsHtml}</ol>

  <div class="signatures">
    <div class="sig-col">
      <div class="label">${escapeHtml(contract.signatures.contractor.label)}</div>
      <div class="sig-line"></div>
      <div class="sig-row">
        <div>Signature</div>
        <div>Name (Print)</div>
        <div>Date</div>
      </div>
    </div>
    <div class="sig-col">
      <div class="label">${escapeHtml(contract.signatures.customer.label)}</div>
      <div class="sig-line"></div>
      <div class="sig-row">
        <div>Signature</div>
        <div>Name (Print)</div>
        <div>Date</div>
      </div>
    </div>
  </div>

  <div class="footer-note">This contract is a legally binding agreement upon signature by both parties.</div>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const share = String(req.query.share || '').trim();
  if (!share) return res.status(400).json({ error: 'Missing ?share=<token>' });

  const requestedTier = String(req.query.tier || '').toLowerCase().trim();

  const { data: est, error } = await supabaseAdmin
    .from('estimates')
    .select('*, customer:customers(*)')
    .eq('share_token', share)
    .single();
  if (error || !est) return res.status(404).json({ error: 'Estimate not found' });

  const { data: tenantSettings } = await supabaseAdmin
    .from('tenant_settings')
    .select('company_name, company_phone, company_email, company_website, accent_color')
    .eq('tenant_id', est.tenant_id)
    .single();

  const branding = {
    companyName: tenantSettings?.company_name || BRANDING_DEFAULT.companyName,
    phone: tenantSettings?.company_phone || BRANDING_DEFAULT.phone,
    email: tenantSettings?.company_email || BRANDING_DEFAULT.email,
    website: tenantSettings?.company_website || BRANDING_DEFAULT.website,
    address: BRANDING_DEFAULT.address,
    accentColor: tenantSettings?.accent_color || BRANDING_DEFAULT.accentColor
  };

  const packages = est.calculated_packages || {};
  const tier = requestedTier && packages[requestedTier]
    ? requestedTier
    : (packages[String(est.selected_package || '').toLowerCase()] ? String(est.selected_package).toLowerCase() : null)
      || (packages.platinum ? 'platinum' : Object.keys(packages)[0]);

  if (!tier || !packages[tier]) {
    return res.status(404).json({ error: 'No calculated package found on this estimate' });
  }

  const pkg = packages[tier];
  if (!pkg.summary || !pkg.lineItems) {
    return res.status(409).json({ error: 'Package missing summary or lineItems — re-run quote engine' });
  }

  if (est.final_accepted_total != null && Number(est.final_accepted_total) > 0) {
    const taxRate = pkg.summary.totalWithTax > 0 && pkg.summary.sellingPrice > 0
      ? (pkg.summary.totalWithTax - pkg.summary.sellingPrice) / pkg.summary.sellingPrice
      : 0.15;
    const totalWithTax = Number(est.final_accepted_total);
    const sellingPrice = Math.round(totalWithTax / (1 + taxRate) * 100) / 100;
    const tax = Math.round((totalWithTax - sellingPrice) * 100) / 100;
    pkg.summary = { ...pkg.summary, sellingPrice, totalWithTax, tax };
  }

  const customerAddress = [est.customer?.address, est.customer?.city, est.customer?.province]
    .filter(Boolean).join(', ');

  const contract = generateContract({
    offer: pkg.offer || { name: tier.toUpperCase(), warranty_years: pkg.warranty_years || 0 },
    summary: pkg.summary,
    lineItems: pkg.lineItems
  }, {
    customerName: est.customer?.full_name || '',
    propertyAddress: customerAddress,
    branding,
    depositPercent: 33,
    paymentTerms: 'net_completion',
    validDays: 30
  });

  const html = buildContractHtml(contract, branding);

  const downloadName = String(req.query.download || '').trim()
    || `PU-Contract-${est.estimate_number || 'draft'}-${(est.customer?.full_name || 'customer').replace(/[^\w\-]+/g, '_').slice(0, 30)}.pdf`;

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: { width: 1280, height: 1800, deviceScaleFactor: 1 }
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20000 });

    supabaseAdmin.from('activity_log').insert({
      tenant_id: est.tenant_id,
      entity_type: 'contract_event',
      entity_id: est.id,
      action: 'contract_pdf_rendered',
      details: { share_token: share, tier, at: new Date().toISOString() }
    }).then(() => {}, () => {});

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.4in', right: '0.4in', bottom: '0.5in', left: '0.4in' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-family:Inter,sans-serif;font-size:8px;color:#666;width:100%;padding:0 0.4in;display:flex;justify-content:space-between">
          <span>${escapeHtml(branding.companyName)} &middot; ${escapeHtml(branding.website)} &middot; ${escapeHtml(branding.phone)}</span>
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
    console.error('[contract-pdf] render failed', err?.message);
    return res.status(500).json({ error: 'PDF render failed', detail: err?.message || String(err) });
  }
}

export const config = {
  api: { bodyParser: false }
};
