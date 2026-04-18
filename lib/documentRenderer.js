// ═══════════════════════════════════════════════════════════════
// RYUJIN OS — Document Renderer
// Turns proposal/contract JSON into styled, printable HTML
//
// Design: Clean, professional, branded. Print-optimized.
// Rules: No internal pricing exposed. Bundled retail only.
// ═══════════════════════════════════════════════════════════════

// ─── Shared styles for all documents ────────────────────────
const BASE_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    color: #1a1a2e; background: #fff;
    line-height: 1.6; font-size: 14px;
  }
  .page { max-width: 800px; margin: 0 auto; padding: 40px; }

  @media print {
    body { background: #fff; }
    .page { padding: 20px; max-width: 100%; }
    .no-print { display: none !important; }
    .page-break { page-break-before: always; }
  }

  /* Header */
  .doc-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 24px; border-bottom: 3px solid var(--accent, #FF6B00);
    margin-bottom: 32px;
  }
  .company-info h1 { font-size: 1.6em; font-weight: 800; color: var(--accent, #FF6B00); }
  .company-info p { font-size: 0.85em; color: #666; margin-top: 2px; }
  .company-logo { width: 80px; height: 80px; border-radius: 12px; object-fit: contain; }
  .doc-title { font-size: 0.7em; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #999; margin-bottom: 4px; }
  .doc-date { font-size: 0.85em; color: #666; }

  /* Info boxes */
  .info-row { display: flex; gap: 24px; margin-bottom: 28px; }
  .info-box { flex: 1; background: #f8f9fb; border-radius: 10px; padding: 16px 20px; }
  .info-box .label { font-size: 0.7em; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 4px; }
  .info-box .value { font-weight: 600; font-size: 0.95em; }

  /* Sections */
  .section { margin-bottom: 28px; }
  .section-title {
    font-size: 0.75em; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1.5px; color: #999; margin-bottom: 12px;
    padding-bottom: 8px; border-bottom: 1px solid #eee;
  }

  /* Line items table */
  .line-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .line-table th {
    text-align: left; padding: 10px 16px; font-size: 0.7em; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.5px; color: #999;
    border-bottom: 2px solid #eee; background: #fafbfc;
  }
  .line-table th:last-child { text-align: right; }
  .line-table td { padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-size: 0.9em; }
  .line-table td:last-child { text-align: right; font-weight: 600; }
  .line-note { font-size: 0.8em; color: #888; font-style: italic; }

  /* Totals */
  .totals { margin-left: auto; width: 280px; }
  .total-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 0.95em; }
  .total-row.grand {
    border-top: 2px solid var(--accent, #FF6B00); padding-top: 12px; margin-top: 8px;
    font-size: 1.3em; font-weight: 800; color: var(--accent, #FF6B00);
  }

  /* Callout boxes */
  .callout {
    background: #f0f7ff; border-left: 4px solid var(--accent, #FF6B00);
    border-radius: 0 8px 8px 0; padding: 16px 20px; margin: 20px 0;
    font-size: 0.9em; line-height: 1.7;
  }
  .callout.green { background: #f0faf0; border-color: #4ade80; }

  /* Scope list */
  .scope-list { list-style: none; padding: 0; }
  .scope-list li { padding: 6px 0 6px 20px; position: relative; font-size: 0.9em; }
  .scope-list li::before { content: '✓'; position: absolute; left: 0; color: var(--accent, #FF6B00); font-weight: 700; }

  /* Badge */
  .badge-inline {
    display: inline-block; padding: 4px 12px; border-radius: 20px;
    font-size: 0.7em; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.5px; background: rgba(255,107,0,0.1); color: var(--accent, #FF6B00);
  }

  /* Warranty box */
  .warranty-box {
    background: #fafbfc; border: 1px solid #eee; border-radius: 10px;
    padding: 20px; text-align: center; margin: 24px 0;
  }
  .warranty-box .years { font-size: 2em; font-weight: 800; color: var(--accent, #FF6B00); }
  .warranty-box .label { font-size: 0.8em; color: #666; margin-top: 4px; }

  /* Signature */
  .sig-row { display: flex; gap: 40px; margin-top: 40px; }
  .sig-block { flex: 1; }
  .sig-block .sig-label { font-size: 0.75em; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 20px; }
  .sig-line { border-bottom: 1px solid #ccc; margin-bottom: 6px; height: 40px; }
  .sig-field { font-size: 0.8em; color: #888; }

  /* Footer */
  .doc-footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; font-size: 0.8em; color: #999; }

  /* Print button */
  .print-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    background: #1a1a2e; padding: 12px 24px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .print-bar span { color: #fff; font-weight: 600; font-size: 0.9em; }
  .print-bar button {
    padding: 8px 20px; border: none; border-radius: 6px;
    font-family: inherit; font-weight: 600; font-size: 0.85em; cursor: pointer;
  }
  .print-bar .btn-print { background: #4a9eff; color: #fff; margin-left: 8px; }
  .print-bar .btn-close { background: rgba(255,255,255,0.1); color: #fff; }
`;

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


// ═══════════════════════════════════════════════════════════════
// PROPOSAL RENDERER
// ═══════════════════════════════════════════════════════════════

export function renderProposalHTML(proposal) {
  const p = proposal;
  const accent = p.company?.accentColor || '#FF6B00';

  let html = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Proposal — ${esc(p.customer?.name || 'Customer')} | ${esc(p.company?.name || 'Ryujin OS')}</title>
    <style>:root{--accent:${accent};}${BASE_STYLES}</style>
  </head><body>

  <div class="print-bar no-print">
    <span>${esc(p.company?.name)} — Proposal</span>
    <div>
      <button class="btn-close" onclick="window.close()">Close</button>
      <button class="btn-print" onclick="window.print()">Print / Save PDF</button>
    </div>
  </div>

  <div class="page" style="margin-top:60px">

  <!-- Header -->
  <div class="doc-header">
    <div class="company-info">
      <h1>${esc(p.company?.name || 'Ryujin OS')}</h1>
      ${p.company?.phone ? `<p>${esc(p.company.phone)}</p>` : ''}
      ${p.company?.email ? `<p>${esc(p.company.email)}</p>` : ''}
      ${p.company?.website ? `<p>${esc(p.company.website)}</p>` : ''}
    </div>
    <div style="text-align:right">
      <div class="doc-title">Proposal</div>
      <div class="doc-date">${esc(p.proposal?.date || new Date().toLocaleDateString())}</div>
      ${p.proposal?.badge ? `<div style="margin-top:8px"><span class="badge-inline">${esc(p.proposal.badge)}</span></div>` : ''}
    </div>
  </div>

  <!-- Customer / Project Info -->
  <div class="info-row">
    <div class="info-box">
      <div class="label">Prepared For</div>
      <div class="value">${esc(p.customer?.name || 'Customer')}</div>
      ${p.customer?.address ? `<div style="font-size:0.85em;color:#666;margin-top:4px">${esc(p.customer.address)}</div>` : ''}
    </div>
    <div class="info-box">
      <div class="label">Package</div>
      <div class="value">${esc(p.proposal?.offerName || 'Custom Quote')}</div>
      ${p.proposal?.preparedBy ? `<div style="font-size:0.85em;color:#666;margin-top:4px">Prepared by: ${esc(p.proposal.preparedBy)}</div>` : ''}
    </div>
  </div>`;

  // Package description & sales copy
  html += `<div class="section">
    <div class="section-title">Your ${esc(p.proposal?.offerName || '')} Package</div>
    <p style="font-size:0.95em;color:#444;line-height:1.7;margin-bottom:16px">${esc(p.proposal?.description || '')}</p>`;

  // Package highlights
  const highlights = {
    'economy': ['IKO Cambridge architectural shingles', 'Standard synthetic underlayment', 'Ice & water shield at eaves and valleys', '10-year workmanship warranty'],
    'gold': ['CertainTeed Landmark architectural shingles', 'Synthetic underlayment (full deck)', 'Standard ice & water shield', 'Ridge vent ventilation', '15-year workmanship warranty'],
    'platinum': ['CertainTeed Landmark PRO shingles', 'Premium synthetic underlayment', 'Grace Ice & Water Shield', 'Metal valleys — no exposed shingle cuts', 'Ridge vent ventilation', '20-year workmanship warranty'],
    'diamond': ['CertainTeed Presidential luxury shingles (4 bundles/SQ)', 'Premium underlayment system', 'Grace Ice & Water Shield — full coverage', 'Metal valleys', 'Premium ridge cap', 'Upgraded pipe flashings & vents', '25-year workmanship warranty'],
    'performance-shell-plus': ['Complete wall strip to sheathing', 'OSB substrate replacement where needed', 'Tyvek housewrap barrier', 'EPS foam insulation board', 'VentiGrid rain screen system', 'Your choice of siding material', 'Remediation allowance included'],
    'hardie-shell': ['James Hardie HardiePlank fiber cement siding', 'Tyvek DrainWrap premium housewrap', 'VentiGrid rain screen system', 'OSB substrate', 'EPS foam insulation', '15-year workmanship warranty'],
  };
  const slug = p.proposal?.slug || p.proposal?.offerName?.toLowerCase().replace(/\s+/g,'-') || '';
  const pkgHighlights = highlights[slug] || highlights[Object.keys(highlights).find(k => slug.includes(k))] || [];

  if (pkgHighlights.length > 0) {
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      ${pkgHighlights.map(h => `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;background:#f8f9fb;border-radius:8px;font-size:0.85em">
        <span style="color:var(--accent,#FF6B00);font-weight:700;font-size:1.1em;line-height:1">✓</span>
        <span>${esc(h)}</span>
      </div>`).join('')}
    </div>`;
  }
  html += '</div>';

  // Photos
  if (p.photos && p.photos.length > 0) {
    html += `<div class="section">
      <div class="section-title">Your Property</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
        ${p.photos.map(url => `<img src="${esc(url)}" style="width:100%;border-radius:8px;object-fit:cover;max-height:200px" alt="Property photo">`).join('')}
      </div>
    </div>`;
  } else {
    // Photo placeholder
    html += `<div class="section">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="background:#f0f3f7;border-radius:10px;padding:40px 20px;text-align:center;border:2px dashed #ddd">
          <div style="font-size:2em;margin-bottom:8px;opacity:0.3">📷</div>
          <div style="font-size:0.8em;color:#999">Property Photo</div>
        </div>
        <div style="background:#f0f3f7;border-radius:10px;padding:40px 20px;text-align:center;border:2px dashed #ddd">
          <div style="font-size:2em;margin-bottom:8px;opacity:0.3">🏠</div>
          <div style="font-size:0.8em;color:#999">Proposed Render</div>
        </div>
      </div>
    </div>`;
  }

  // Scope
  if (p.scope && p.scope.length > 0) {
    html += `<div class="section">
      <div class="section-title">Scope of Work</div>
      <ul class="scope-list">
        ${p.scope.map(s => `<li>${esc(s)}</li>`).join('')}
      </ul>
    </div>`;
  }

  // Line items (bundled retail)
  if (p.lineItems && p.lineItems.length > 0) {
    html += `<div class="section">
      <div class="section-title">Investment Breakdown</div>
      <table class="line-table">
        <thead><tr><th>Item</th><th style="text-align:right">Price</th></tr></thead>
        <tbody>`;
    for (const li of p.lineItems) {
      html += `<tr>
        <td>${esc(li.label)}${li.note ? `<br><span class="line-note">${esc(li.note)}</span>` : ''}</td>
        <td>${esc(li.price)}</td>
      </tr>`;
    }
    html += `</tbody></table>

    <div class="totals">
      <div class="total-row"><span>Subtotal</span><span>${esc(p.pricing?.subtotal)}</span></div>
      <div class="total-row"><span>${esc(p.pricing?.taxLabel || 'HST')}</span><span>${esc(p.pricing?.tax)}</span></div>
      <div class="total-row grand"><span>Total</span><span>${esc(p.pricing?.total)}</span></div>
    </div></div>`;
  }

  // Mobilization discount
  if (p.mobilization) {
    html += `<div class="callout green">
      <strong>${esc(p.mobilization.label)}</strong><br>
      ${esc(p.mobilization.framing)}<br><br>
      <strong>Add-on discount: ${esc(p.mobilization.discountPct)} off — Save ${esc(p.mobilization.discountAmount)}</strong><br>
      Bundled total: <strong>${esc(p.mobilization.bundledTotal)}</strong>
    </div>`;
  }

  // Remediation note
  if (p.remediationNote) {
    html += `<div class="callout">${esc(p.remediationNote)}</div>`;
  }

  // Warranty
  if (p.warranty) {
    const years = p.warranty.match(/(\d+)-year/);
    if (years) {
      html += `<div class="warranty-box">
        <div class="years">${years[1]}</div>
        <div class="label">Year Workmanship Warranty</div>
        <div style="font-size:0.8em;color:#888;margin-top:8px">${esc(p.warranty)}</div>
      </div>`;
    } else {
      html += `<div class="callout">${esc(p.warranty)}</div>`;
    }
  }

  // Financing — prominent CTA
  if (p.financing && p.financing.available) {
    html += `<div style="background:linear-gradient(135deg,#1a1a2e,#2d1b4e);color:#fff;border-radius:12px;padding:24px 28px;margin:24px 0;text-align:center">
      <div style="font-size:1.2em;font-weight:700;margin-bottom:4px">Monthly Payments Available</div>
      <div style="font-size:0.9em;opacity:0.8;margin-bottom:16px">Finance through FinanceIt — apply online, approval in minutes.</div>
      <div style="display:inline-block;padding:10px 32px;background:var(--accent,#FF6B00);color:#fff;border-radius:8px;font-weight:700;font-size:0.9em">Ask About Payment Plans</div>
    </div>`;
  }

  // Notes
  if (p.notes) {
    html += `<div class="section">
      <div class="section-title">Notes</div>
      <p style="font-size:0.9em;color:#555">${esc(p.notes)}</p>
    </div>`;
  }

  // Cleanup & Jobsite
  html += `<div class="callout green">
    <strong>Included With Every Project</strong><br>
    Complete jobsite cleanup &bull; Magnetic nail sweep &bull; All debris removal &bull;
    Final walkthrough with homeowner &bull; Before &amp; after documentation
  </div>`;

  // Testimonial
  html += `<div class="section">
    <div class="section-title">What Our Customers Say</div>
    <div style="background:#f8f9fb;border-radius:10px;padding:20px 24px;font-style:italic;color:#555;line-height:1.7;position:relative">
      <div style="font-size:2em;color:#ddd;position:absolute;top:8px;left:16px">&ldquo;</div>
      <div style="padding-left:24px">Professional crew, clean job site, excellent communication throughout. The whole process was smooth from estimate to final walkthrough. Would highly recommend.</div>
      <div style="text-align:right;margin-top:8px;font-style:normal;font-weight:600;font-size:0.85em;color:#999">&mdash; Recent Customer</div>
    </div>
  </div>`;

  // Estimated warning
  if (p.estimatedWarning) {
    html += `<div style="font-size:0.8em;color:#999;margin-top:20px;font-style:italic">* ${esc(p.estimatedWarning)}</div>`;
  }

  // Footer
  html += `<div class="doc-footer">
    ${esc(p.company?.name || '')} ${p.company?.phone ? '| ' + esc(p.company.phone) : ''} ${p.company?.email ? '| ' + esc(p.company.email) : ''}
  </div>

  </div></body></html>`;

  return html;
}


// ═══════════════════════════════════════════════════════════════
// CONTRACT RENDERER
// ═══════════════════════════════════════════════════════════════

export function renderContractHTML(contract) {
  const c = contract;
  const accent = c.contractor?.accentColor || '#FF6B00';

  let html = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contract — ${esc(c.customer?.name || 'Customer')} | ${esc(c.contractor?.name || 'Ryujin OS')}</title>
    <style>:root{--accent:${accent};}${BASE_STYLES}
      .terms-list { list-style: decimal; padding-left: 20px; }
      .terms-list li { padding: 6px 0; font-size: 0.9em; color: #444; }
    </style>
  </head><body>

  <div class="print-bar no-print">
    <span>${esc(c.contractor?.name)} — Contract</span>
    <div>
      <button class="btn-close" onclick="window.close()">Close</button>
      <button class="btn-print" onclick="window.print()">Print / Save PDF</button>
    </div>
  </div>

  <div class="page" style="margin-top:60px">

  <!-- Header -->
  <div class="doc-header">
    <div class="company-info">
      <h1>${esc(c.contractor?.name || 'Ryujin OS')}</h1>
      ${c.contractor?.phone ? `<p>${esc(c.contractor.phone)}</p>` : ''}
      ${c.contractor?.email ? `<p>${esc(c.contractor.email)}</p>` : ''}
    </div>
    <div style="text-align:right">
      <div class="doc-title">Service Agreement</div>
      <div class="doc-date">${esc(c.details?.date || new Date().toLocaleDateString())}</div>
    </div>
  </div>

  <!-- Parties -->
  <div class="info-row">
    <div class="info-box">
      <div class="label">Contractor</div>
      <div class="value">${esc(c.contractor?.name)}</div>
      ${c.contractor?.phone ? `<div style="font-size:0.85em;color:#666">${esc(c.contractor.phone)}</div>` : ''}
      ${c.contractor?.email ? `<div style="font-size:0.85em;color:#666">${esc(c.contractor.email)}</div>` : ''}
    </div>
    <div class="info-box">
      <div class="label">Customer</div>
      <div class="value">${esc(c.customer?.name || 'Customer')}</div>
      ${c.customer?.address ? `<div style="font-size:0.85em;color:#666">${esc(c.customer.address)}</div>` : ''}
    </div>
  </div>

  <div class="info-row">
    <div class="info-box">
      <div class="label">Project</div>
      <div class="value">${esc(c.details?.offerName || 'Roofing & Exterior')}</div>
    </div>
    <div class="info-box">
      <div class="label">Valid Until</div>
      <div class="value">${esc(c.details?.validUntil || '—')}</div>
      <div style="font-size:0.8em;color:#999">This quote is valid for ${c.details?.validDays || 30} days</div>
    </div>
  </div>`;

  // Scope of Work
  if (c.scope && c.scope.length > 0) {
    html += `<div class="section">
      <div class="section-title">Scope of Work</div>`;
    for (const section of c.scope) {
      html += `<div style="margin-bottom:16px">
        <div style="font-weight:600;font-size:0.9em;margin-bottom:6px">${esc(section.category)}</div>
        <ul class="scope-list">
          ${section.items.map(item => `<li>${esc(item)}</li>`).join('')}
        </ul>
      </div>`;
    }
    html += `</div>`;
  }

  // Pricing
  html += `<div class="section">
    <div class="section-title">Contract Price</div>
    <div class="totals" style="width:100%;max-width:350px">
      <div class="total-row"><span>Contract Price</span><span>${esc(c.pricing?.priceFormatted)}</span></div>
      <div class="total-row"><span>${esc(c.pricing?.taxLabel || 'HST')}</span><span>${esc(c.pricing?.taxFormatted)}</span></div>
      <div class="total-row grand"><span>Total</span><span>${esc(c.pricing?.totalFormatted)}</span></div>
    </div>
  </div>`;

  // Payment Schedule
  if (c.payment && c.payment.schedule) {
    html += `<div class="section">
      <div class="section-title">Payment Schedule</div>
      <table class="line-table">
        <thead><tr><th>Milestone</th><th style="text-align:right">Amount</th><th style="text-align:right">%</th></tr></thead>
        <tbody>`;
    for (const p of c.payment.schedule) {
      html += `<tr>
        <td>${esc(p.milestone)}</td>
        <td style="text-align:right;font-weight:600">${esc(p.amountFormatted)}</td>
        <td style="text-align:right;color:#888">${esc(p.percentFormatted)}</td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // Warranty
  if (c.warranty) {
    html += `<div class="section">
      <div class="section-title">Warranty</div>
      <p style="font-size:0.9em;color:#444">${esc(c.warranty.text)}</p>
      ${c.warranty.remediationNote ? `<div class="callout" style="margin-top:12px">${esc(c.warranty.remediationNote)}</div>` : ''}
    </div>`;
  }

  // Terms & Conditions
  if (c.terms && c.terms.length > 0) {
    html += `<div class="section">
      <div class="section-title">Terms & Conditions</div>
      <ol class="terms-list">
        ${c.terms.map(t => `<li>${esc(t)}</li>`).join('')}
      </ol>
    </div>`;
  }

  // Signatures
  html += `<div class="section page-break">
    <div class="section-title">Signatures</div>
    <p style="font-size:0.85em;color:#666;margin-bottom:24px">
      By signing below, both parties agree to the scope of work, pricing, and terms outlined in this agreement.
    </p>
    <div class="sig-row">
      <div class="sig-block">
        <div class="sig-label">${esc(c.signatures?.contractor?.label || 'Contractor')}</div>
        <div class="sig-line"></div>
        <div class="sig-field">Signature</div>
        <div class="sig-line" style="margin-top:16px"></div>
        <div class="sig-field">Printed Name</div>
        <div class="sig-line" style="margin-top:16px"></div>
        <div class="sig-field">Date</div>
      </div>
      <div class="sig-block">
        <div class="sig-label">${esc(c.signatures?.customer?.label || 'Customer')}</div>
        <div class="sig-line"></div>
        <div class="sig-field">Signature</div>
        <div class="sig-line" style="margin-top:16px"></div>
        <div class="sig-field">Printed Name</div>
        <div class="sig-line" style="margin-top:16px"></div>
        <div class="sig-field">Date</div>
      </div>
    </div>
  </div>`;

  // Footer
  html += `<div class="doc-footer">
    ${esc(c.contractor?.name || '')} ${c.contractor?.phone ? '| ' + esc(c.contractor.phone) : ''} ${c.contractor?.email ? '| ' + esc(c.contractor.email) : ''}
  </div>

  </div></body></html>`;

  return html;
}
