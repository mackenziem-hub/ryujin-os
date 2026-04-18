// ═══════════════════════════════════════════════════════════════
// RYUJIN OS — Document Renderer v2
// Sales-first proposal system built on Jewels Grace buyer psychology,
// Hormozi value equation, and Plus Ultra field-tested methodology.
//
// Design principles (from mentorship):
// - Price AFTER value (never lead with cost)
// - Load-bearing language on its own line
// - Strategic bolding (Installation, Protection, Removal)
// - "So What / So That" framing
// - Sell the vacation, not the process
// - Three trust questions answered before pricing
// - Remediation = transparency, not extra cost
// ═══════════════════════════════════════════════════════════════

const BASE_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, sans-serif; color: #1a1a2e; background: #fff; line-height: 1.65; font-size: 14px; }
  .page { max-width: 800px; margin: 0 auto; padding: 40px; }
  @media print { body { background: #fff; } .page { padding: 20px; max-width: 100%; } .no-print { display: none !important; } .page-break { page-break-before: always; } }

  /* Hero banner */
  .hero { background: linear-gradient(135deg, #1a1a2e 0%, #2d1b4e 100%); color: #fff; border-radius: 16px; padding: 40px 36px; margin-bottom: 32px; position: relative; overflow: hidden; }
  .hero::after { content: ''; position: absolute; top: -50%; right: -20%; width: 300px; height: 300px; background: radial-gradient(circle, rgba(255,107,0,0.15) 0%, transparent 70%); pointer-events: none; }
  .hero-name { font-size: 2.2em; font-weight: 900; line-height: 1.1; margin-bottom: 6px; }
  .hero-addr { font-size: 1em; opacity: 0.7; margin-bottom: 20px; }
  .hero-pkg { display: inline-block; padding: 6px 18px; border-radius: 20px; font-size: 0.75em; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); }

  /* Company header */
  .co-bar { display: flex; justify-content: space-between; align-items: center; padding: 16px 0 24px; border-bottom: 3px solid var(--accent, #FF6B00); margin-bottom: 28px; }
  .co-bar h1 { font-size: 1.5em; font-weight: 800; color: var(--accent, #FF6B00); }
  .co-bar p { font-size: 0.82em; color: #666; }
  .co-bar .cert { font-size: 0.65em; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }

  /* Section */
  .section { margin-bottom: 28px; }
  .sec-title { font-size: 0.72em; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #999; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #eee; }

  /* Warm intro */
  .warm-intro { background: #fafbfc; border-radius: 12px; padding: 24px 28px; margin-bottom: 28px; font-size: 0.95em; line-height: 1.8; color: #444; }
  .warm-intro .sign { margin-top: 16px; font-weight: 700; color: #1a1a2e; }

  /* Why us - trust */
  .trust-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 28px; }
  .trust-card { text-align: center; padding: 20px 16px; background: #fafbfc; border-radius: 12px; }
  .trust-card .icon { font-size: 1.8em; margin-bottom: 8px; }
  .trust-card .title { font-weight: 800; font-size: 0.85em; margin-bottom: 4px; }
  .trust-card .desc { font-size: 0.78em; color: #666; line-height: 1.5; }

  /* Package features - checkmark grid */
  .feat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 16px 0; }
  .feat-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; background: #f8f9fb; border-radius: 10px; font-size: 0.88em; }
  .feat-check { color: #16a34a; font-weight: 800; font-size: 1.1em; line-height: 1; flex-shrink: 0; }

  /* Photo area */
  .photo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 28px; }
  .photo-slot { background: #f0f3f7; border-radius: 12px; padding: 48px 20px; text-align: center; border: 2px dashed #ddd; }
  .photo-slot img { width: 100%; border-radius: 10px; object-fit: cover; max-height: 250px; }

  /* Pricing */
  .price-hero { text-align: center; padding: 32px 20px; margin: 24px 0; }
  .price-label { font-size: 0.7em; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #999; margin-bottom: 4px; }
  .price-total { font-size: 3em; font-weight: 900; color: var(--accent, #FF6B00); line-height: 1; }
  .price-sub { font-size: 0.9em; color: #888; margin-top: 6px; }

  .line-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .line-table th { text-align: left; padding: 10px 16px; font-size: 0.68em; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; border-bottom: 2px solid #eee; background: #fafbfc; }
  .line-table th:last-child { text-align: right; }
  .line-table td { padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-size: 0.9em; }
  .line-table td:last-child { text-align: right; font-weight: 600; }
  .line-note { font-size: 0.78em; color: #16a34a; font-style: italic; }

  .totals { margin-left: auto; width: 280px; }
  .total-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 0.95em; }
  .total-row.grand { border-top: 3px solid var(--accent, #FF6B00); padding-top: 14px; margin-top: 10px; font-size: 1.4em; font-weight: 900; color: var(--accent, #FF6B00); }

  /* Warranty */
  .warranty-box { background: linear-gradient(135deg, #f0faf0, #e8f5e8); border: 1px solid #c6e6c6; border-radius: 14px; padding: 28px; text-align: center; margin: 24px 0; }
  .warranty-box .years { font-size: 2.8em; font-weight: 900; color: #16a34a; line-height: 1; }
  .warranty-box .label { font-size: 0.85em; color: #444; margin-top: 4px; font-weight: 600; }
  .warranty-box .detail { font-size: 0.8em; color: #666; margin-top: 8px; line-height: 1.6; }

  /* Financing CTA */
  .finance-cta { background: linear-gradient(135deg, #1a1a2e 0%, #2d1b4e 100%); color: #fff; border-radius: 14px; padding: 28px 32px; margin: 24px 0; text-align: center; }
  .finance-cta h3 { font-size: 1.3em; font-weight: 800; margin-bottom: 6px; }
  .finance-cta p { font-size: 0.9em; opacity: 0.8; margin-bottom: 18px; line-height: 1.6; }
  .finance-cta .btn { display: inline-block; padding: 12px 36px; background: #FF6B00; color: #fff; border-radius: 8px; font-weight: 700; font-size: 0.95em; text-decoration: none; }

  /* Callout */
  .callout { border-left: 4px solid var(--accent, #FF6B00); border-radius: 0 10px 10px 0; padding: 18px 22px; margin: 20px 0; font-size: 0.9em; line-height: 1.7; }
  .callout.blue { background: #f0f5ff; border-color: #4a9eff; }
  .callout.green { background: #f0faf0; border-color: #16a34a; }
  .callout.orange { background: #fff8f0; border-color: #FF6B00; }

  /* Testimonial */
  .testimonial { background: #fafbfc; border-radius: 14px; padding: 24px 28px; position: relative; margin: 24px 0; }
  .testimonial .quote { font-size: 2.4em; color: #ddd; position: absolute; top: 8px; left: 18px; font-family: Georgia, serif; }
  .testimonial .text { padding-left: 28px; font-style: italic; color: #555; line-height: 1.7; font-size: 0.95em; }
  .testimonial .author { text-align: right; margin-top: 10px; font-style: normal; font-weight: 700; font-size: 0.82em; color: #999; }

  /* Next steps */
  .next-steps { background: linear-gradient(180deg, #fafbfc, #f0f3f7); border-radius: 14px; padding: 28px; margin: 24px 0; }
  .next-steps h3 { font-size: 1.1em; font-weight: 800; margin-bottom: 14px; }
  .step { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
  .step-num { width: 28px; height: 28px; border-radius: 50%; background: var(--accent, #FF6B00); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.8em; flex-shrink: 0; }
  .step-text { font-size: 0.9em; color: #444; padding-top: 3px; }

  /* Footer */
  .doc-footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; font-size: 0.8em; color: #999; }

  /* Print bar */
  .print-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 100; background: #1a1a2e; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; }
  .print-bar span { color: #fff; font-weight: 600; font-size: 0.9em; }
  .print-bar button { padding: 8px 20px; border: none; border-radius: 6px; font-family: inherit; font-weight: 600; font-size: 0.85em; cursor: pointer; }
  .print-bar .btn-print { background: #FF6B00; color: #fff; margin-left: 8px; }
  .print-bar .btn-close { background: rgba(255,255,255,0.1); color: #fff; }

  /* Scope list */
  .scope-list { list-style: none; padding: 0; }
  .scope-list li { padding: 6px 0 6px 22px; position: relative; font-size: 0.9em; }
  .scope-list li::before { content: '\\2713'; position: absolute; left: 0; color: #16a34a; font-weight: 700; }

  /* Sig */
  .sig-row { display: flex; gap: 40px; margin-top: 40px; }
  .sig-block { flex: 1; }
  .sig-block .sig-label { font-size: 0.75em; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 20px; }
  .sig-line { border-bottom: 1px solid #ccc; margin-bottom: 6px; height: 40px; }
  .sig-field { font-size: 0.8em; color: #888; }
  .terms-list { list-style: decimal; padding-left: 20px; }
  .terms-list li { padding: 6px 0; font-size: 0.9em; color: #444; }
`;

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Package highlights (what the customer gets — sell the outcome) ───
const PKG_FEATURES = {
  'economy': [
    'Complete tear-off & disposal',
    'IKO Cambridge architectural shingles',
    'Synthetic underlayment',
    'Ice & water shield protection',
    'New drip edge & starter strip',
    'Ridge vent ventilation',
    'Full cleanup & magnetic nail sweep',
    '10-year workmanship warranty'
  ],
  'gold': [
    'Complete tear-off & disposal',
    'CertainTeed Landmark architectural shingles',
    'Synthetic underlayment — full deck coverage',
    'Ice & water shield at eaves & valleys',
    'New drip edge, starter & ridge cap',
    'Ridge vent ventilation',
    'Full cleanup & magnetic nail sweep',
    '15-year workmanship warranty'
  ],
  'platinum': [
    'Complete tear-off & disposal',
    'CertainTeed Landmark PRO shingles',
    'Premium synthetic underlayment',
    'Grace Ice & Water Shield — superior protection',
    'Metal valleys — no exposed shingle cuts',
    'Upgraded ridge cap & ventilation',
    'Full cleanup & magnetic nail sweep',
    '20-year workmanship warranty'
  ],
  'diamond': [
    'Complete tear-off & disposal',
    'CertainTeed Presidential luxury shingles',
    'Premium underlayment system — full coverage',
    'Grace Ice & Water Shield — maximum protection',
    'Metal valleys throughout',
    'Premium ridge cap & upgraded flashings',
    'Full cleanup & magnetic nail sweep',
    '25-year workmanship warranty'
  ],
  'performance-shell-plus': [
    'Complete exterior strip to sheathing',
    'Structural inspection & assessment',
    'OSB substrate replacement where needed',
    'Tyvek housewrap moisture barrier',
    'EPS foam insulation board',
    'VentiGrid rain screen system',
    'Your choice of siding material',
    'Remediation allowance — unused credited back'
  ],
  'hardie-shell': [
    'Complete exterior strip to sheathing',
    'James Hardie HardiePlank fiber cement siding',
    'Tyvek DrainWrap premium housewrap',
    'VentiGrid rain screen system',
    'OSB substrate & EPS insulation',
    'Window & door trim capping',
    'Full cleanup & debris removal',
    '15-year workmanship warranty'
  ]
};


// ═══════════════════════════════════════════════════════════════
// PROPOSAL RENDERER — Sales-First Design
// Flow: Trust → Value → Scope → Price → Close
// ═══════════════════════════════════════════════════════════════

export function renderProposalHTML(proposal) {
  const p = proposal;
  const accent = p.company?.accentColor || '#FF6B00';
  const companyName = p.company?.name || 'Plus Ultra Roofing';
  const customerFirst = (p.customer?.name || 'Homeowner').split(' ')[0];
  const slug = p.proposal?.slug || '';

  let html = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Proposal — ${esc(p.customer?.name || 'Customer')} | ${esc(companyName)}</title>
    <style>:root{--accent:${accent};}${BASE_STYLES}</style>
  </head><body>

  <div class="print-bar no-print">
    <span>${esc(companyName)} — Proposal for ${esc(p.customer?.name || 'Customer')}</span>
    <div>
      <button class="btn-close" onclick="window.close()">Close</button>
      <button class="btn-print" onclick="window.print()">Print / Save PDF</button>
    </div>
  </div>

  <div class="page" style="margin-top:60px">

  <!-- ═══ COMPANY HEADER ═══ -->
  <div class="co-bar">
    <div>
      <h1>${esc(companyName)}</h1>
      ${p.company?.phone ? `<p>${esc(p.company.phone)}</p>` : ''}
      ${p.company?.email ? `<p>${esc(p.company.email)}</p>` : ''}
      <div class="cert">CertainTeed Certified Installer</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:0.65em;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#999">Proposal</div>
      <div style="font-size:0.85em;color:#666">${esc(p.proposal?.date || new Date().toLocaleDateString())}</div>
      ${p.proposal?.badge ? `<div style="margin-top:8px"><span style="display:inline-block;padding:4px 14px;border-radius:20px;font-size:0.7em;font-weight:700;background:rgba(255,107,0,0.1);color:var(--accent)">${esc(p.proposal.badge)}</span></div>` : ''}
    </div>
  </div>

  <!-- ═══ HERO BANNER — Personal & warm ═══ -->
  <div class="hero">
    <div class="hero-name">${esc(customerFirst)}, here's your<br>custom roofing plan.</div>
    <div class="hero-addr">${esc(p.customer?.address || 'Your property')}</div>
    <span class="hero-pkg">${esc(p.proposal?.offerName || 'Custom Package')}</span>
  </div>

  <!-- ═══ WARM INTRO — Build connection first (Jewels: Connect before Convert) ═══ -->
  <div class="warm-intro">
    Hey ${esc(customerFirst)},<br><br>
    Thanks for having us out to take a look at your property. We've put together a custom plan based on what we found during the inspection. Everything below is tailored to your home — the materials, the scope, the pricing.<br><br>
    If you have any questions, don't hesitate to reach out. We're happy to walk through the numbers or adjust anything to fit your needs.
    <div class="sign">— ${esc(p.proposal?.preparedBy || companyName)}</div>
  </div>

  <!-- ═══ WHY US — Answer the 3 trust questions before showing price ═══ -->
  <!-- Why YOU? Why YOUR BUYER? Why NOW? -->
  <div class="trust-grid">
    <div class="trust-card">
      <div class="icon">🛡️</div>
      <div class="title">Certified & Insured</div>
      <div class="desc">CertainTeed certified installer with full liability coverage & workers comp. Your home is protected.</div>
    </div>
    <div class="trust-card">
      <div class="icon">⭐</div>
      <div class="title">Local & Trusted</div>
      <div class="desc">Locally owned, serving your community. Your neighbors trust us with their homes — you can too.</div>
    </div>
    <div class="trust-card">
      <div class="icon">✅</div>
      <div class="title">Warranty-Backed</div>
      <div class="desc">Every project backed by our workmanship warranty plus manufacturer material warranties.</div>
    </div>
  </div>`;

  // ═══ PHOTOS — Property & proposed (or placeholders) ═══
  if (p.photos && p.photos.length > 0) {
    html += `<div class="photo-grid">
      ${p.photos.map(url => `<div class="photo-slot" style="padding:0;border:none"><img src="${esc(url)}" alt="Property"></div>`).join('')}
    </div>`;
  } else {
    html += `<div class="photo-grid">
      <div class="photo-slot"><div style="font-size:2.5em;margin-bottom:10px;opacity:0.25">📷</div><div style="font-size:0.82em;color:#999">Property Photo</div><div style="font-size:0.7em;color:#bbb;margin-top:4px">Added before presentation</div></div>
      <div class="photo-slot"><div style="font-size:2.5em;margin-bottom:10px;opacity:0.25">🏠</div><div style="font-size:0.82em;color:#999">Completed Project Vision</div><div style="font-size:0.7em;color:#bbb;margin-top:4px">AI render or reference photo</div></div>
    </div>`;
  }

  // ═══ PACKAGE — What's included (sell the outcome, not the process) ═══
  html += `<div class="section">
    <div class="sec-title">Your ${esc(p.proposal?.offerName || '')} Package — What's Included</div>
    <p style="font-size:0.92em;color:#444;line-height:1.7;margin-bottom:14px">${esc(p.proposal?.description || '')}</p>`;

  const features = PKG_FEATURES[slug] || PKG_FEATURES[Object.keys(PKG_FEATURES).find(k => slug.includes(k))] || [];
  if (features.length > 0) {
    html += '<div class="feat-grid">';
    for (const f of features) {
      html += `<div class="feat-item"><span class="feat-check">✓</span><span>${esc(f)}</span></div>`;
    }
    html += '</div>';
  }
  html += '</div>';

  // ═══ WHAT EVERY PROJECT INCLUDES — Standard value stack ═══
  html += `<div class="callout green">
    <strong>Included With Every Project</strong><br>
    <strong>Removal</strong> — Complete tear-off of existing materials<br>
    <strong>Protection</strong> — Ice & water shield, underlayment, drip edge<br>
    <strong>Installation</strong> — Professional crew, manufacturer specs<br>
    <strong>Cleanup</strong> — Full jobsite cleanup, magnetic nail sweep, debris hauled<br>
    <strong>Walkthrough</strong> — Final inspection with you, before & after photos
  </div>`;

  // ═══ SCOPE OF WORK ═══
  if (p.scope && p.scope.length > 0) {
    html += `<div class="section">
      <div class="sec-title">Full Scope of Work</div>
      <ul class="scope-list">${p.scope.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    </div>`;
  }

  // ═══ REMEDIATION — Frame as transparency (Jewels: build trust) ═══
  if (p.remediationNote) {
    html += `<div class="callout orange">
      <strong>Transparency Note</strong><br>
      ${esc(p.remediationNote)}<br>
      <em>This is how we protect you from surprises. If we don't use it, you get the difference back.</em>
    </div>`;
  }

  // ═══ PRICING — AFTER all value is established (Jewels: price too early kills conversions) ═══
  if (p.lineItems && p.lineItems.length > 0) {
    html += `<div class="section">
      <div class="sec-title">Your Investment</div>
      <table class="line-table">
        <thead><tr><th>Scope</th><th style="text-align:right">Included</th></tr></thead>
        <tbody>`;
    for (const li of p.lineItems) {
      html += `<tr>
        <td><strong>${esc(li.label)}</strong>${li.note ? `<br><span class="line-note">${esc(li.note)}</span>` : ''}</td>
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

  // ═══ WARRANTY — Visual & prominent ═══
  if (p.warranty) {
    const years = p.warranty.match(/(\d+)-year/);
    if (years) {
      html += `<div class="warranty-box">
        <div class="years">${years[1]}</div>
        <div class="label">Year Workmanship Warranty</div>
        <div class="detail">${esc(p.warranty)}</div>
      </div>`;
    }
  }

  // ═══ FINANCING CTA — Prominent, removes price objection (Hormozi: reduce sacrifice) ═══
  if (p.financing && p.financing.available) {
    html += `<div class="finance-cta">
      <h3>Monthly Payments Available</h3>
      <p>Protect your home now, pay over time. Finance through FinanceIt — apply online, get approved in minutes. No obligation to check your rate.</p>
      <span class="btn">Ask About Monthly Payments</span>
    </div>`;
  }

  // ═══ MOBILIZATION — "While we're already here" framing ═══
  if (p.mobilization && p.mobilization.eligible) {
    html += `<div class="callout blue">
      <strong>${esc(p.mobilization.label || 'Bundle & Save')}</strong><br>
      ${esc(p.mobilization.framing || 'Add exterior work while our crew is already on site.')}<br><br>
      <strong>Save ${esc(p.mobilization.discountAmount)}</strong> (${esc(p.mobilization.discountPct)} off add-on scope)<br>
      Bundled total: <strong>${esc(p.mobilization.bundledTotal)}</strong>
      ${p.mobilization.note ? `<br><em>${esc(p.mobilization.note)}</em>` : ''}
    </div>`;
  }

  // ═══ TESTIMONIAL — Social proof (Jewels: "what your neighbors are choosing") ═══
  html += `<div class="testimonial">
    <div class="quote">&ldquo;</div>
    <div class="text">Professional crew, clean job site, excellent communication throughout. The whole process was smooth from the first estimate to the final walkthrough. Would definitely recommend to anyone in the area.</div>
    <div class="author">— Recent Customer, ${new Date().getFullYear()}</div>
  </div>`;

  // ═══ NEXT STEPS — Clear behavioral CTA (Jewels: call to behaviors, not actions) ═══
  html += `<div class="next-steps">
    <h3>Ready to Move Forward?</h3>
    <div class="step"><div class="step-num">1</div><div class="step-text"><strong>Review this proposal</strong> — take your time, ask us anything</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-text"><strong>Give us the green light</strong> — a quick call or text to confirm</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-text"><strong>We handle everything</strong> — permits, scheduling, materials, crew, cleanup</div></div>
    <div style="margin-top:16px;font-size:0.85em;color:#666">
      Questions? Call or text <strong>${esc(p.company?.phone || '')}</strong> or email <strong>${esc(p.company?.email || '')}</strong>
    </div>
  </div>`;

  // ═══ NOTES ═══
  if (p.notes) {
    html += `<div class="section"><div class="sec-title">Notes</div><p style="font-size:0.9em;color:#555">${esc(p.notes)}</p></div>`;
  }

  // ═══ ESTIMATED PRICING WARNING ═══
  if (p.estimatedWarning) {
    html += `<div style="font-size:0.78em;color:#999;margin-top:20px;font-style:italic">* ${esc(p.estimatedWarning)}</div>`;
  }

  // ═══ FOOTER ═══
  html += `<div class="doc-footer">
    ${esc(companyName)} ${p.company?.phone ? '| ' + esc(p.company.phone) : ''} ${p.company?.email ? '| ' + esc(p.company.email) : ''} ${p.company?.website ? '| ' + esc(p.company.website) : ''}
  </div>

  </div></body></html>`;

  return html;
}


// ═══════════════════════════════════════════════════════════════
// CONTRACT RENDERER (kept clean — this is legal, not sales)
// ═══════════════════════════════════════════════════════════════

export function renderContractHTML(contract) {
  const c = contract;
  const accent = c.contractor?.accentColor || '#FF6B00';

  let html = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contract — ${esc(c.customer?.name || 'Customer')} | ${esc(c.contractor?.name || 'Ryujin OS')}</title>
    <style>:root{--accent:${accent};}${BASE_STYLES}</style>
  </head><body>

  <div class="print-bar no-print">
    <span>${esc(c.contractor?.name)} — Service Agreement</span>
    <div>
      <button class="btn-close" onclick="window.close()">Close</button>
      <button class="btn-print" onclick="window.print()">Print / Save PDF</button>
    </div>
  </div>

  <div class="page" style="margin-top:60px">

  <div class="co-bar">
    <div>
      <h1>${esc(c.contractor?.name || 'Ryujin OS')}</h1>
      ${c.contractor?.phone ? `<p>${esc(c.contractor.phone)}</p>` : ''}
      ${c.contractor?.email ? `<p>${esc(c.contractor.email)}</p>` : ''}
    </div>
    <div style="text-align:right">
      <div style="font-size:0.65em;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#999">Service Agreement</div>
      <div style="font-size:0.85em;color:#666">${esc(c.details?.date || new Date().toLocaleDateString())}</div>
    </div>
  </div>

  <div style="display:flex;gap:24px;margin-bottom:28px">
    <div style="flex:1;background:#fafbfc;border-radius:10px;padding:16px 20px">
      <div style="font-size:0.7em;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:4px">Contractor</div>
      <div style="font-weight:600">${esc(c.contractor?.name)}</div>
      ${c.contractor?.phone ? `<div style="font-size:0.85em;color:#666">${esc(c.contractor.phone)}</div>` : ''}
    </div>
    <div style="flex:1;background:#fafbfc;border-radius:10px;padding:16px 20px">
      <div style="font-size:0.7em;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:4px">Customer</div>
      <div style="font-weight:600">${esc(c.customer?.name || 'Customer')}</div>
      ${c.customer?.address ? `<div style="font-size:0.85em;color:#666">${esc(c.customer.address)}</div>` : ''}
    </div>
  </div>

  <div style="display:flex;gap:24px;margin-bottom:28px">
    <div style="flex:1;background:#fafbfc;border-radius:10px;padding:16px 20px">
      <div style="font-size:0.7em;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:4px">Project</div>
      <div style="font-weight:600">${esc(c.details?.offerName || 'Roofing & Exterior')}</div>
    </div>
    <div style="flex:1;background:#fafbfc;border-radius:10px;padding:16px 20px">
      <div style="font-size:0.7em;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:4px">Valid Until</div>
      <div style="font-weight:600">${esc(c.details?.validUntil || '—')}</div>
      <div style="font-size:0.78em;color:#999">Valid for ${c.details?.validDays || 30} days</div>
    </div>
  </div>`;

  if (c.scope && c.scope.length > 0) {
    html += `<div class="section"><div class="sec-title">Scope of Work</div>`;
    for (const section of c.scope) {
      html += `<div style="margin-bottom:16px"><div style="font-weight:700;font-size:0.9em;margin-bottom:6px">${esc(section.category)}</div><ul class="scope-list">${section.items.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>`;
    }
    html += '</div>';
  }

  html += `<div class="section"><div class="sec-title">Contract Price</div>
    <div class="totals" style="width:100%;max-width:350px">
      <div class="total-row"><span>Contract Price</span><span>${esc(c.pricing?.priceFormatted)}</span></div>
      <div class="total-row"><span>${esc(c.pricing?.taxLabel || 'HST')}</span><span>${esc(c.pricing?.taxFormatted)}</span></div>
      <div class="total-row grand"><span>Total</span><span>${esc(c.pricing?.totalFormatted)}</span></div>
    </div></div>`;

  if (c.payment && c.payment.schedule) {
    html += `<div class="section"><div class="sec-title">Payment Schedule</div><table class="line-table"><thead><tr><th>Milestone</th><th style="text-align:right">Amount</th><th style="text-align:right">%</th></tr></thead><tbody>`;
    for (const pay of c.payment.schedule) {
      html += `<tr><td>${esc(pay.milestone)}</td><td style="text-align:right;font-weight:600">${esc(pay.amountFormatted)}</td><td style="text-align:right;color:#888">${esc(pay.percentFormatted)}</td></tr>`;
    }
    html += '</tbody></table></div>';
  }

  if (c.warranty) {
    html += `<div class="section"><div class="sec-title">Warranty</div><p style="font-size:0.9em;color:#444">${esc(c.warranty.text)}</p>
      ${c.warranty.remediationNote ? `<div class="callout orange" style="margin-top:12px">${esc(c.warranty.remediationNote)}</div>` : ''}</div>`;
  }

  if (c.terms && c.terms.length > 0) {
    html += `<div class="section"><div class="sec-title">Terms & Conditions</div><ol class="terms-list">${c.terms.map(t => `<li>${esc(t)}</li>`).join('')}</ol></div>`;
  }

  html += `<div class="section page-break"><div class="sec-title">Signatures</div>
    <p style="font-size:0.85em;color:#666;margin-bottom:24px">By signing below, both parties agree to the scope of work, pricing, and terms outlined in this agreement.</p>
    <div class="sig-row">
      <div class="sig-block"><div class="sig-label">${esc(c.signatures?.contractor?.label || 'Contractor')}</div><div class="sig-line"></div><div class="sig-field">Signature</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Printed Name</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Date</div></div>
      <div class="sig-block"><div class="sig-label">${esc(c.signatures?.customer?.label || 'Customer')}</div><div class="sig-line"></div><div class="sig-field">Signature</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Printed Name</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Date</div></div>
    </div></div>`;

  html += `<div class="doc-footer">${esc(c.contractor?.name || '')} ${c.contractor?.phone ? '| ' + esc(c.contractor.phone) : ''} ${c.contractor?.email ? '| ' + esc(c.contractor.email) : ''}</div>
  </div></body></html>`;

  return html;
}
