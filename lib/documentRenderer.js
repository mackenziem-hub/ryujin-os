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
  const rep = p.salesRep || { name: 'Mackenzie Mazerolle', phone: '(506) 540-1052', title: 'Owner', bio: '' };
  const tmpl = p.template || { headline: 'Your System. Your Timeline. Your Decision.', tagline: 'Same professional standard. Different performance levels.', introMessage: '', tierExplanation: '', scopeIntro: '' };
  const contactPhone = rep.phone || p.company?.phone || '(506) 540-1052';
  const contactEmail = rep.email || p.company?.email || '';
  const monthlyEst = p.pricing?.totalRaw ? Math.round(p.pricing.totalRaw / 120) : null;

  // ═══════════════════════════════════════════════════════════════
  // DARK VISUAL PROPOSAL — Slide-based sales presentation WITH pricing
  // This is the document the client sees. It must sell, not just inform.
  // Flow: Hero → Trust → Package → What's Included → Scope → Price → Warranty → Finance → Close
  // ═══════════════════════════════════════════════════════════════

  let html = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>${esc(customerFirst)}'s Proposal — ${esc(companyName)}</title>
    <meta name="theme-color" content="#111111">
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
    <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;background:#111;color:#f0f0f0;overflow-x:hidden;-webkit-font-smoothing:antialiased}
    .bg{position:fixed;inset:0;z-index:0;background:radial-gradient(ellipse at 20% 50%,rgba(30,60,90,0.3) 0%,transparent 70%),radial-gradient(ellipse at 80% 20%,rgba(20,50,80,0.2) 0%,transparent 60%)}
    .page{position:relative;z-index:1}
    .section{max-width:800px;margin:0 auto;padding:80px 24px}
    .section-sm{max-width:800px;margin:0 auto;padding:40px 24px}
    h1,h2,h3{font-family:'Montserrat',sans-serif}
    .divider{border:none;border-top:1px solid rgba(255,255,255,0.06);margin:0}

    /* Print bar */
    .print-bar{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(0,0,0,0.95);padding:12px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1)}
    .print-bar span{color:#fff;font-weight:600;font-size:0.9em}
    .print-bar button{padding:8px 20px;border:none;border-radius:6px;font-weight:600;font-size:0.85em;cursor:pointer;font-family:inherit}
    .print-bar .bp{background:${accent};color:#fff;margin-left:8px}
    .print-bar .bc{background:rgba(255,255,255,0.1);color:#fff}
    @media print{.print-bar{display:none!important}.page{margin-top:0!important}body{background:#111}@page{margin:0.5in}}

    /* Hero */
    .prop-hero{padding:120px 24px 80px;text-align:center}
    .prop-hero .label{font-size:0.7em;font-weight:700;text-transform:uppercase;letter-spacing:3px;color:rgba(255,255,255,0.35);margin-bottom:16px}
    .prop-hero h1{font-size:2.8em;font-weight:900;line-height:1.1;margin-bottom:12px;color:#fff}
    .prop-hero .addr{font-size:1em;color:rgba(255,255,255,0.5)}
    .prop-hero .pkg-badge{display:inline-block;margin-top:20px;padding:8px 24px;border-radius:24px;font-size:0.8em;font-weight:700;letter-spacing:1px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.8)}

    /* Trust cards */
    .trust-row{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-bottom:40px}
    .trust-card{text-align:center;padding:24px 20px;flex:1;min-width:200px;max-width:250px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:16px}
    .trust-card .icon{font-size:1.8em;margin-bottom:10px}
    .trust-card h4{font-size:0.9em;font-weight:700;margin-bottom:4px}
    .trust-card p{font-size:0.78em;color:rgba(255,255,255,0.5);line-height:1.5}

    /* Package features */
    .feat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:24px 0}
    .feat-item{display:flex;align-items:flex-start;gap:10px;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px}
    .feat-check{color:#4ade80;font-weight:800;font-size:1.1em;flex-shrink:0}

    /* Price hero */
    .price-slide{text-align:center;padding:80px 24px}
    .price-slide .label{font-size:0.7em;font-weight:700;text-transform:uppercase;letter-spacing:3px;color:rgba(255,255,255,0.35);margin-bottom:12px}
    .price-total{font-family:'Montserrat',sans-serif;font-size:4em;font-weight:900;color:#fff;line-height:1;text-shadow:0 0 60px rgba(255,255,255,0.1)}
    .price-sub{font-size:1em;color:rgba(255,255,255,0.4);margin-top:8px}

    /* Line items */
    .line-items{max-width:600px;margin:30px auto 0}
    .line-row{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:0.95em}
    .line-row .label{color:rgba(255,255,255,0.8)}
    .line-row .price{font-family:'Montserrat',sans-serif;font-weight:600;color:#fff}
    .line-row.total{border-top:2px solid rgba(255,255,255,0.2);border-bottom:none;padding-top:16px;margin-top:8px;font-size:1.2em;font-weight:700}
    .line-note{font-size:0.78em;color:#4ade80;padding:2px 0 8px}

    /* Comparison */
    .comp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;max-width:700px;margin:0 auto}
    .comp-card{padding:20px 16px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px;text-align:center;position:relative;transition:border-color 0.3s}
    .comp-card.selected{border-color:${accent};background:rgba(255,255,255,0.04)}
    .comp-card .name{font-family:'Montserrat',sans-serif;font-size:0.85em;font-weight:700;margin-bottom:8px}
    .comp-card .comp-price{font-family:'Montserrat',sans-serif;font-size:1.5em;font-weight:800;margin-bottom:4px}
    .comp-card .comp-detail{font-size:0.7em;color:rgba(255,255,255,0.4)}
    .comp-card .your-plan{position:absolute;top:-8px;left:50%;transform:translateX(-50%);padding:3px 12px;border-radius:4px;font-size:0.55em;font-weight:700;letter-spacing:1px;background:${accent};color:#fff;white-space:nowrap}

    /* Warranty */
    .warranty-slide{text-align:center;padding:60px 24px}
    .warranty-num{font-family:'Montserrat',sans-serif;font-size:5em;font-weight:900;color:#4ade80;line-height:1}
    .warranty-label{font-size:1.1em;color:rgba(255,255,255,0.6);margin-top:4px;font-weight:500}
    .warranty-detail{font-size:0.85em;color:rgba(255,255,255,0.35);margin-top:12px;max-width:500px;margin-left:auto;margin-right:auto;line-height:1.7}

    /* Finance */
    .finance-slide{text-align:center;padding:60px 24px;background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.06);border-bottom:1px solid rgba(255,255,255,0.06)}
    .finance-monthly{font-family:'Montserrat',sans-serif;font-size:3em;font-weight:900;color:#fff}
    .finance-label{font-size:0.9em;color:rgba(255,255,255,0.5);margin-top:4px}
    .finance-note{font-size:0.82em;color:rgba(255,255,255,0.3);margin-top:16px;max-width:450px;margin-left:auto;margin-right:auto}

    /* Next steps */
    .steps{max-width:600px;margin:0 auto}
    .step{display:flex;gap:16px;margin-bottom:20px;align-items:flex-start}
    .step-num{width:36px;height:36px;border-radius:50%;background:${accent};color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Montserrat',sans-serif;font-weight:800;font-size:0.9em;flex-shrink:0}
    .step-text{padding-top:6px;font-size:0.95em;color:rgba(255,255,255,0.7);line-height:1.6}
    .step-text strong{color:#fff}

    /* CTA */
    .cta-section{text-align:center;padding:80px 24px}
    .cta-btn{display:inline-block;padding:18px 48px;background:#fff;color:#111;text-decoration:none;border-radius:50px;font-family:'Montserrat',sans-serif;font-weight:700;font-size:1.05em;transition:all 0.3s;box-shadow:0 4px 20px rgba(255,255,255,0.15)}
    .cta-btn:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(255,255,255,0.25)}
    .cta-alt{display:block;margin-top:16px;color:rgba(255,255,255,0.4);font-size:0.85em;text-decoration:none}

    /* Footer */
    .footer{text-align:center;padding:40px 24px;border-top:1px solid rgba(255,255,255,0.06);color:rgba(255,255,255,0.25);font-size:0.8em}
    .footer .brand{font-family:'Montserrat',sans-serif;font-weight:800;font-size:1.1em;color:rgba(255,255,255,0.4);letter-spacing:2px;display:block;margin-bottom:8px}
    .footer a{color:rgba(255,255,255,0.35);text-decoration:none}

    @media(max-width:700px){.prop-hero h1{font-size:1.8em}.price-total{font-size:2.8em}.feat-grid{grid-template-columns:1fr}.comp-grid{grid-template-columns:1fr 1fr}.warranty-num{font-size:3.5em}.finance-monthly{font-size:2.2em}.section{padding:60px 20px}}
    </style>
  </head><body>
  <div class="bg"></div>

  <div class="print-bar no-print">
    <span>${esc(companyName)} — Proposal</span>
    <div>
      <button class="bc" onclick="window.close()">Close</button>
      <button class="bp" onclick="window.print()">Print / Save PDF</button>
    </div>
  </div>

  <div class="page" style="margin-top:50px">

  <!-- ═══ SLIDE 1: HERO ═══ -->
  <!-- ═══ SLIDE 1: HERO — Template-driven ═══ -->
  <div class="prop-hero">
    <div class="label">Proposal — ${esc(rep.name)}</div>
    <h1>${esc(tmpl.headline || (customerFirst + ', here\'s your custom plan.'))}</h1>
    <div class="addr">${esc(p.customer?.address || '')} ${tmpl.tagline ? '&mdash; ' + esc(tmpl.tagline) : ''}</div>
    <div class="pkg-badge">${esc(p.proposal?.offerName || 'Custom Package')} ${p.proposal?.badge ? '— ' + esc(p.proposal.badge) : ''}</div>
  </div>
  <hr class="divider">

  <!-- ═══ SLIDE 1.5: YOUR PROPERTY (if photos provided) ═══ -->`;
  if (p.photos && p.photos.length > 0) {
    html += `<div class="section-sm" style="text-align:center">
      <h2 style="font-family:'Montserrat',sans-serif;font-size:1.2em;font-weight:700;margin-bottom:20px;color:rgba(255,255,255,0.8)">Your Property</h2>
      <div style="display:grid;grid-template-columns:${p.photos.length === 1 ? '1fr' : '1fr 1fr'};gap:10px;max-width:700px;margin:0 auto">
        ${p.photos.map(url => `<img src="${esc(url)}" style="width:100%;border-radius:12px;object-fit:cover;max-height:300px" alt="Property">`).join('')}
      </div>
    </div>`;
  } else {
    // Before/After vision placeholders
    html += `<div class="section-sm" style="max-width:700px;margin:0 auto">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="aspect-ratio:4/3;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px">
          <div style="font-size:2em;opacity:0.12">📷</div>
          <div style="font-size:0.8em;color:rgba(255,255,255,0.25)">Current Condition</div>
          <div style="font-size:0.65em;color:rgba(255,255,255,0.12)">Photo added before sending</div>
        </div>
        <div style="aspect-ratio:4/3;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px">
          <div style="font-size:2em;opacity:0.12">🏠</div>
          <div style="font-size:0.8em;color:rgba(255,255,255,0.25)">Completed Vision</div>
          <div style="font-size:0.65em;color:rgba(255,255,255,0.12)">Reference or AI render</div>
        </div>
      </div>
    </div>`;
  }
  html += `
  <!-- ═══ SLIDE 2: TRUST — Why us? ═══ -->
  <div class="section-sm">
    <div class="trust-row">
      <div class="trust-card"><div class="icon">🛡️</div><h4>Certified &amp; Insured</h4><p>CertainTeed certified installer. Full liability &amp; workers comp.</p></div>
      <div class="trust-card"><div class="icon">⭐</div><h4>Local &amp; Trusted</h4><p>Locally owned. Your neighbors trust us with their homes.</p></div>
      <div class="trust-card"><div class="icon">✅</div><h4>Warranty-Backed</h4><p>Workmanship warranty + manufacturer material warranties.</p></div>
    </div>
  </div>

  <!-- ═══ SLIDE 3: PERSONAL INTRO (template-driven) ═══ -->
  <div class="section" style="text-align:center;max-width:650px">
    <h2 style="font-size:1.6em;font-weight:700;margin-bottom:20px">Hey ${esc(customerFirst)},</h2>
    <p style="font-size:1.05em;line-height:1.9;color:rgba(255,255,255,0.7)">${esc(tmpl.introMessage || 'We\'ve put together a custom plan based on what we found during the inspection. Everything below is tailored to your home — the materials, the scope, the pricing.')}</p>
    ${tmpl.tierExplanation ? `<p style="font-size:0.92em;line-height:1.8;color:rgba(255,255,255,0.55);margin-top:16px">${esc(tmpl.tierExplanation)}</p>` : ''}
    <p style="font-size:0.9em;color:rgba(255,255,255,0.4);margin-top:20px;font-style:italic">— ${esc(rep.name)}, ${esc(rep.title || companyName)}</p>
  </div>

  <!-- old trust grid removed — replaced above -->`;

  // ═══ SLIDE 3.5: OUR WORK — Real crew photos ═══
  const PROPOSAL_PHOTOS = [
    { url: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/683df2a1e1360e210d25da2f.jpeg', alt: 'Completed roof — aerial view' },
    { url: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/683df2a18406d6d308cec7a1.jpeg', alt: 'Premium shingle installation' },
    { url: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/6839b129d906870c391d2e00.jpeg', alt: 'Crew and crane — material delivery' },
    { url: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/684214dee142b673f143437d.jpeg', alt: 'Crew installing roof' },
    { url: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/6841dac0598392e117d07add.jpeg', alt: 'Commercial project' },
    { url: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/696b6c244e42b975f6577663.jpg', alt: 'Installing underlayment' }
  ];
  html += `<div class="section-sm">
    <h2 style="font-family:'Montserrat',sans-serif;font-size:1.2em;font-weight:700;text-align:center;margin-bottom:20px;color:rgba(255,255,255,0.9)">Our Work Across Greater Moncton</h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:800px;margin:0 auto">
      ${PROPOSAL_PHOTOS.map(ph => `<img src="${ph.url}" alt="${esc(ph.alt)}" loading="lazy" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;filter:brightness(0.85)">`).join('')}
    </div>
  </div>`;

  // ═══ SLIDE 4: VIDEO PLACEHOLDER ═══
  html += `<div class="section-sm" style="max-width:700px">
    <div style="aspect-ratio:16/9;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:16px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px">
      <div style="font-size:3em;opacity:0.12">▶</div>
      <div style="font-size:0.9em;color:rgba(255,255,255,0.3)">Personal video walkthrough</div>
      <div style="font-size:0.72em;color:rgba(255,255,255,0.15)">Recorded on location for your project</div>
    </div>
  </div>`;

  // ═══ SLIDE 5: YOUR PACKAGE — What's included ═══
  html += `<div class="section" style="text-align:center">
    <h2 style="font-size:1.4em;font-weight:700;margin-bottom:8px">Your ${esc(p.proposal?.offerName || '')} Package</h2>
    <p style="color:rgba(255,255,255,0.45);font-size:0.95em;margin-bottom:24px">${esc(p.proposal?.description || '')}</p>`;

  const features = PKG_FEATURES[slug] || PKG_FEATURES[Object.keys(PKG_FEATURES).find(k => slug.includes(k))] || [];
  if (features.length > 0) {
    html += '<div class="feat-grid">';
    for (const f of features) {
      html += `<div class="feat-item"><span class="feat-check">✓</span><span style="font-size:0.9em;color:rgba(255,255,255,0.8)">${esc(f)}</span></div>`;
    }
    html += '</div>';
  }

  // What every project includes
  html += `<div style="margin-top:30px;padding:30px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:16px;text-align:left">
    <h3 style="font-size:0.85em;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.5);margin-bottom:16px;text-align:center">Included With Every Project</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center">
      <div><div style="font-size:1.4em;margin-bottom:4px">🛡️</div><div style="font-size:0.8em;font-weight:600">Full Tear-Off</div><div style="font-size:0.72em;color:rgba(255,255,255,0.4)">Down to the deck</div></div>
      <div><div style="font-size:1.4em;margin-bottom:4px">🧹</div><div style="font-size:0.8em;font-weight:600">Complete Cleanup</div><div style="font-size:0.72em;color:rgba(255,255,255,0.4)">Nail sweep + debris hauled</div></div>
      <div><div style="font-size:1.4em;margin-bottom:4px">🤝</div><div style="font-size:0.8em;font-weight:600">Final Walkthrough</div><div style="font-size:0.72em;color:rgba(255,255,255,0.4)">We inspect together</div></div>
    </div>
  </div></div>`;

  // ═══ SLIDE 5.5: PACKAGE TIER EXPLANATION — Educate before pricing ═══
  // This is what was missing from SumoQuote — clients didn't understand tier differences
  const tierDetails = {
    'economy': { shingle: 'IKO Cambridge', grade: 'Architectural', underlayment: 'Standard Synthetic', iceShield: 'Eaves & Valleys', valleys: 'Woven', warranty: '10 years', position: 'Reliable protection at the best price. Industry-standard materials with professional installation.' },
    'gold': { shingle: 'CertainTeed Landmark', grade: 'Architectural', underlayment: 'Synthetic — Full Deck', iceShield: 'Standard', valleys: 'Woven', warranty: '15 years', position: 'Our most popular package. The sweet spot between quality, durability, and value. This is what most of your neighbors are choosing.' },
    'platinum': { shingle: 'CertainTeed Landmark PRO', grade: 'Premium Architectural', underlayment: 'Premium Synthetic', iceShield: 'Grace Ice & Water Shield', valleys: 'Metal V-Cut', warranty: '20 years', position: 'Upgraded everything. Premium shingles, superior underlayment, metal valleys for a cleaner look and longer life.' },
    'diamond': { shingle: 'CertainTeed Presidential', grade: 'Luxury / Designer', underlayment: 'Premium System', iceShield: 'Grace — Full Coverage', valleys: 'Metal V-Cut', warranty: '25 years', position: 'The finest residential roofing available. 4 bundles per square for a thick, luxury appearance that lasts a lifetime.' }
  };

  // Show tier explanation if we have comparison data or if it's a residential package
  const showTiers = p.comparison && p.comparison.length > 1;
  if (showTiers) {
    html += `<div class="section" style="text-align:center">
      <h2 style="font-size:1.4em;font-weight:700;margin-bottom:8px">Understanding Your Options</h2>
      <p style="color:rgba(255,255,255,0.45);font-size:0.92em;margin-bottom:30px">${esc(tmpl.tierExplanation || 'Each tier uses the same professional installation. The difference is in the material grade, protection level, and warranty length.')}</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;max-width:800px;margin:0 auto">`;

    // Sort packages by price (lowest first for natural reading)
    const sortedPkgs = [...p.comparison].sort((a,b) => (a.totalRaw||0) - (b.totalRaw||0));

    for (const pkg of sortedPkgs) {
      const tier = tierDetails[pkg.slug] || {};
      const isSel = pkg.isSelected;
      html += `<div style="padding:24px 18px;background:${isSel?'rgba(255,255,255,0.05)':'rgba(255,255,255,0.02)'};border:${isSel?'2px':'1px'} solid ${isSel?accent:'rgba(255,255,255,0.06)'};border-radius:16px;text-align:left;position:relative">
        ${isSel ? `<div style="position:absolute;top:-9px;left:50%;transform:translateX(-50%);padding:3px 14px;border-radius:4px;font-size:0.55em;font-weight:700;letter-spacing:1.5px;background:${accent};color:#fff;white-space:nowrap">YOUR PACKAGE</div>` : ''}
        ${pkg.badge ? `<div style="font-size:0.6em;color:${accent};font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">${esc(pkg.badge)}</div>` : '<div style="height:16px"></div>'}
        <h3 style="font-family:'Montserrat',sans-serif;font-size:1.1em;font-weight:800;color:#fff;margin-bottom:12px">${esc(pkg.name)}</h3>

        ${tier.shingle ? `<div style="margin-bottom:14px">
          <div style="font-size:0.65em;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Shingle</div>
          <div style="font-size:0.88em;color:rgba(255,255,255,0.8);font-weight:600">${esc(tier.shingle)}</div>
          <div style="font-size:0.72em;color:rgba(255,255,255,0.4)">${esc(tier.grade)}</div>
        </div>` : ''}

        ${tier.underlayment ? `<div style="margin-bottom:10px">
          <div style="font-size:0.65em;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">Underlayment</div>
          <div style="font-size:0.82em;color:rgba(255,255,255,0.7)">${esc(tier.underlayment)}</div>
        </div>` : ''}

        ${tier.iceShield ? `<div style="margin-bottom:10px">
          <div style="font-size:0.65em;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">Ice & Water Shield</div>
          <div style="font-size:0.82em;color:rgba(255,255,255,0.7)">${esc(tier.iceShield)}</div>
        </div>` : ''}

        ${tier.valleys ? `<div style="margin-bottom:10px">
          <div style="font-size:0.65em;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">Valleys</div>
          <div style="font-size:0.82em;color:rgba(255,255,255,0.7)">${esc(tier.valleys)}</div>
        </div>` : ''}

        ${pkg.warranty ? `<div style="margin-bottom:14px">
          <div style="font-size:0.65em;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">Warranty</div>
          <div style="font-size:0.92em;color:#4ade80;font-weight:700">${esc(pkg.warranty)}</div>
        </div>` : ''}

        ${tier.position ? `<div style="font-size:0.78em;color:rgba(255,255,255,0.5);line-height:1.6;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06)">${esc(tier.position)}</div>` : ''}
      </div>`;
    }
    html += '</div>';

    // "Why Upgrade?" callout — shows what you gain between tiers
    const upgradePaths = [
      { from: 'Gold', to: 'Platinum', gains: ['CertainTeed Landmark PRO shingles', 'Grace Ice & Water Shield', 'Metal V-cut valleys', '+5 years warranty'] },
      { from: 'Platinum', to: 'Diamond', gains: ['CertainTeed Presidential luxury shingles', '4 bundles/SQ (thicker coverage)', 'Full-coverage ice shield', '+5 years warranty'] }
    ];
    html += `<div style="max-width:600px;margin:30px auto 0">
      <h3 style="font-size:0.8em;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.4);text-align:center;margin-bottom:14px">What You Gain By Upgrading</h3>
      ${upgradePaths.map(u => `<div style="padding:14px 18px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;margin-bottom:8px">
        <div style="font-size:0.82em;font-weight:700;margin-bottom:8px">${u.from} <span style="color:${accent}">→</span> ${u.to}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${u.gains.map(g => `<span style="font-size:0.72em;padding:3px 10px;border-radius:12px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.15);color:#4ade80">+ ${esc(g)}</span>`).join('')}</div>
      </div>`).join('')}
    </div>`;

    html += '</div>';
  }

  // ═══ SLIDE 6: SCOPE OF WORK ═══
  if (p.scope && p.scope.length > 0) {
    html += `<div class="section"><h2 style="font-size:1.2em;font-weight:700;text-align:center;margin-bottom:24px">Full Scope of Work</h2>
      <div style="max-width:500px;margin:0 auto">`;
    for (const s of p.scope) {
      html += `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:0.92em"><span style="color:#4ade80;font-weight:700">✓</span><span style="color:rgba(255,255,255,0.75)">${esc(s)}</span></div>`;
    }
    html += '</div></div>';
  }

  // ═══ SLIDE 6.5: REMEDIATION ═══
  if (p.remediationNote) {
    html += `<div class="section-sm" style="max-width:600px;text-align:center">
      <div style="padding:24px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px">
        <h3 style="font-size:0.8em;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.4);margin-bottom:10px">Transparency Note</h3>
        <p style="font-size:0.92em;color:rgba(255,255,255,0.65);line-height:1.7">${esc(p.remediationNote)}</p>
      </div>
    </div>`;
  }

  // ═══ SLIDE 7: PACKAGE COMPARISON (price anchoring) ═══
  if (p.comparison && p.comparison.length > 1) {
    const sorted = [...p.comparison].sort((a,b) => (b.totalRaw||0) - (a.totalRaw||0));
    html += `<div class="section" style="text-align:center">
      <h2 style="font-size:1.2em;font-weight:700;margin-bottom:8px">Compare Your Options</h2>
      <p style="color:rgba(255,255,255,0.4);font-size:0.88em;margin-bottom:24px">Every package includes tear-off, installation, cleanup &amp; warranty.</p>
      <div class="comp-grid">`;
    for (const pkg of sorted) {
      html += `<div class="comp-card ${pkg.isSelected?'selected':''}">
        ${pkg.isSelected?'<div class="your-plan">YOUR PLAN</div>':''}
        <div class="name">${esc(pkg.name)}</div>
        <div class="comp-price">${esc(pkg.total)}</div>
        <div class="comp-detail">incl. tax</div>
        ${pkg.warranty?`<div style="font-size:0.7em;color:#4ade80;margin-top:8px">${esc(pkg.warranty)}</div>`:''}
      </div>`;
    }
    html += '</div></div>';
  }

  // ═══ SLIDE 8: YOUR INVESTMENT (the big price) ═══
  if (p.lineItems && p.lineItems.length > 0) {
    html += `<div class="price-slide">
      <div class="label">Your Investment</div>
      <div class="price-total">${esc(p.pricing?.total)}</div>
      <div class="price-sub">${esc(p.pricing?.subtotal)} + ${esc(p.pricing?.tax)} ${esc(p.pricing?.taxLabel || 'HST')}</div>

      <div class="line-items">`;
    for (const li of p.lineItems) {
      html += `<div class="line-row"><span class="label">${esc(li.label)}</span><span class="price">${esc(li.price)}</span></div>`;
      if (li.note) html += `<div class="line-note">${esc(li.note)}</div>`;
    }
    html += `<div class="line-row"><span class="label" style="color:rgba(255,255,255,0.5)">Subtotal</span><span class="price" style="color:rgba(255,255,255,0.7)">${esc(p.pricing?.subtotal)}</span></div>
      <div class="line-row"><span class="label" style="color:rgba(255,255,255,0.5)">${esc(p.pricing?.taxLabel || 'HST')}</span><span class="price" style="color:rgba(255,255,255,0.5)">${esc(p.pricing?.tax)}</span></div>
      <div class="line-row total"><span class="label">Total</span><span class="price">${esc(p.pricing?.total)}</span></div>
    </div></div>`;
  }

  // ═══ SLIDE 9: WARRANTY ═══
  if (p.warranty) {
    const years = p.warranty.match(/(\d+)-year/);
    if (years) {
      html += `<div class="warranty-slide">
        <div class="warranty-num">${years[1]}</div>
        <div class="warranty-label">Year Workmanship Warranty</div>
        <div class="warranty-detail">${esc(p.warranty)}</div>
      </div>`;
    }
  }

  // ═══ SLIDE 9.5: GOOGLE REVIEWS — Real 5-star social proof ═══
  const reviews = [
    { text: "Professional crew, clean job site, excellent communication throughout. The whole process was smooth from the first estimate to the final walkthrough. Would definitely recommend to anyone in the area.", author: "Verified Google Review", rating: 5 },
    { text: "Mackenzie and his crew did an outstanding job on our roof. They showed up on time, worked efficiently, and left the property spotless. The quality of work speaks for itself. Highly recommend Plus Ultra!", author: "Google Review", rating: 5 },
    { text: "Best roofing experience we've had. Fair pricing, quality materials, and they actually explain what they're doing and why. No pressure, no upselling — just honest work. Five stars all day.", author: "Google Review", rating: 5 }
  ];
  html += `<div class="section" style="text-align:center">
    <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:6px">
      <span style="font-size:1.3em">⭐⭐⭐⭐⭐</span>
    </div>
    <h2 style="font-size:1.3em;font-weight:700;margin-bottom:4px">What Our Customers Say</h2>
    <div style="font-size:0.82em;color:rgba(255,255,255,0.4);margin-bottom:24px">35+ five-star reviews on Google</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;max-width:750px;margin:0 auto">
      ${reviews.map(r => `<div style="padding:20px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;text-align:left">
        <div style="color:#facc15;font-size:0.85em;margin-bottom:8px">${'⭐'.repeat(r.rating)}</div>
        <p style="font-size:0.85em;line-height:1.7;color:rgba(255,255,255,0.7);font-style:italic;margin-bottom:10px">"${esc(r.text)}"</p>
        <div style="font-size:0.72em;color:rgba(255,255,255,0.4);font-weight:600">— ${esc(r.author)}</div>
      </div>`).join('')}
    </div>
    <a href="https://www.google.com/maps/place/Plus+Ultra+Roofing" target="_blank" style="display:inline-block;margin-top:16px;font-size:0.78em;color:rgba(255,255,255,0.35);text-decoration:none">View all reviews on Google →</a>
  </div>`;

  // ═══ SLIDE 9.7: HOW IT WORKS — Process timeline ═══
  html += `<div class="section" style="text-align:center">
    <h2 style="font-size:1.3em;font-weight:700;margin-bottom:30px">How It Works</h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:650px;margin:0 auto">
      <div style="padding:20px 14px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px">
        <div style="width:36px;height:36px;border-radius:50%;background:${accent};color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Montserrat',sans-serif;font-weight:800;margin:0 auto 10px">1</div>
        <div style="font-weight:700;font-size:0.88em;margin-bottom:4px">Sign & Schedule</div>
        <div style="font-size:0.75em;color:rgba(255,255,255,0.45);line-height:1.5">Approve the proposal. We handle permits & material ordering.</div>
      </div>
      <div style="padding:20px 14px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px">
        <div style="width:36px;height:36px;border-radius:50%;background:${accent};color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Montserrat',sans-serif;font-weight:800;margin:0 auto 10px">2</div>
        <div style="font-weight:700;font-size:0.88em;margin-bottom:4px">Installation</div>
        <div style="font-size:0.75em;color:rgba(255,255,255,0.45);line-height:1.5">Our crew arrives on schedule. Tear-off, install, clean — typically 1-3 days.</div>
      </div>
      <div style="padding:20px 14px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px">
        <div style="width:36px;height:36px;border-radius:50%;background:${accent};color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Montserrat',sans-serif;font-weight:800;margin:0 auto 10px">3</div>
        <div style="font-weight:700;font-size:0.88em;margin-bottom:4px">Walkthrough</div>
        <div style="font-size:0.75em;color:rgba(255,255,255,0.45);line-height:1.5">Final inspection together. Before & after photos. Your warranty begins.</div>
      </div>
    </div>
  </div>`;

  // ═══ SLIDE 10: FINANCING ═══
  if (p.financing && p.financing.available) {
    html += `<div class="finance-slide">
      <h2 style="font-size:1.2em;font-weight:700;margin-bottom:16px;color:rgba(255,255,255,0.8)">Monthly Payments Available</h2>
      ${monthlyEst ? `<div class="finance-monthly">~$${monthlyEst}/mo</div><div class="finance-label">Estimated at 120 months</div>` : ''}
      <div class="finance-note">Finance through FinanceIt — apply online, get approved in minutes. No obligation to check your rate.</div>
    </div>`;
  }

  // ═══ SLIDE 11: NEXT STEPS ═══
  html += `<div class="section">
    <h2 style="font-size:1.4em;font-weight:700;text-align:center;margin-bottom:30px">Next Steps</h2>
    <div class="steps">
      <div class="step"><div class="step-num">1</div><div class="step-text"><strong>Review this proposal</strong> — take your time, ask us anything</div></div>
      <div class="step"><div class="step-num">2</div><div class="step-text"><strong>Give us the green light</strong> — a quick call or text to confirm</div></div>
      <div class="step"><div class="step-num">3</div><div class="step-text"><strong>We handle everything</strong> — permits, scheduling, materials, crew, cleanup</div></div>
    </div>
  </div>`;

  // ═══ SLIDE 11.5: ABOUT YOUR ESTIMATOR ═══
  if (rep.bio) {
    html += `<div class="section" style="text-align:center">
      <h2 style="font-size:1.2em;font-weight:700;color:rgba(255,255,255,0.5);letter-spacing:2px;text-transform:uppercase;margin-bottom:30px">About Your Estimator</h2>
      <div style="max-width:550px;margin:0 auto;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px 30px">
        <h3 style="font-family:'Montserrat',sans-serif;font-size:1.4em;font-weight:700;color:#fff;margin-bottom:6px">${esc(rep.name)}</h3>
        <div style="font-size:0.85em;color:rgba(255,255,255,0.4);margin-bottom:20px;letter-spacing:1px;text-transform:uppercase">${esc(rep.title || '')}</div>
        <p style="font-size:1em;line-height:1.8;color:rgba(255,255,255,0.7);margin-bottom:24px">${esc(rep.bio)}</p>
        <div style="display:flex;justify-content:center;gap:20px;flex-wrap:wrap">
          <a href="tel:${esc((rep.phoneTel||rep.phone||'').replace(/[^0-9]/g,''))}" style="color:rgba(255,255,255,0.6);text-decoration:none;font-size:0.95em">${esc(rep.phone||'')}</a>
          ${p.company?.website ? `<a href="${esc(p.company.website)}" style="color:rgba(255,255,255,0.6);text-decoration:none;font-size:0.95em">${esc(p.company.website.replace('https://',''))}</a>` : ''}
        </div>
      </div>
    </div>`;
  }

  // ═══ SLIDE 12: CTA ═══
  html += `<div class="cta-section">
    <h2 style="font-size:1.8em;font-weight:800;margin-bottom:12px">Ready to go?</h2>
    <p style="color:rgba(255,255,255,0.5);font-size:1em;margin-bottom:30px;max-width:450px;margin-left:auto;margin-right:auto">Give us a call or text. We'll get you on the schedule.</p>
    <a href="tel:${esc(contactPhone.replace(/[^0-9]/g,''))}" class="cta-btn">Call ${esc(rep.name.split(' ')[0])} — ${esc(contactPhone)}</a>
    <a href="mailto:${esc(contactEmail)}" class="cta-alt">Or email ${esc(contactEmail)}</a>
  </div>`;

  // ═══ FOOTER ═══
  html += `<div class="footer">
    <span class="brand">${esc(companyName.toUpperCase())}</span>
    CertainTeed Certified &middot; Fully Insured &middot; Locally Owned<br>
    <a href="tel:${esc(contactPhone.replace(/[^0-9]/g,''))}">${esc(contactPhone)}</a> &middot;
    ${p.company?.email ? `<a href="mailto:${esc(p.company.email)}">${esc(p.company.email)}</a> &middot;` : ''}
    ${p.company?.website ? `<a href="${esc(p.company.website)}">${esc(p.company.website.replace('https://',''))}</a>` : ''}
  </div>

  </div></body></html>`;

  return html;
}

/* Dead code removed — was the old white-themed proposal */
// [170 lines of dead code removed — was old white-themed proposal content]
function __cleanedUp() { return;
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

  // ═══ PACKAGE COMPARISON — Price anchoring (Jewels: all boxes same size, highlight selected) ═══
  if (p.comparison && p.comparison.length > 1) {
    // Sort highest price first for anchoring
    const sorted = [...p.comparison].sort((a,b) => (b.totalRaw||0) - (a.totalRaw||0));
    html += `<div class="section page-break">
      <div class="sec-title">Compare Your Options</div>
      <p style="font-size:0.88em;color:#666;margin-bottom:16px">Every package includes complete tear-off, installation, cleanup & warranty. Here's how they compare:</p>
      <div style="display:grid;grid-template-columns:repeat(${Math.min(sorted.length,4)},1fr);gap:12px">`;
    for (const pkg of sorted) {
      const isSel = pkg.isSelected;
      const hl = pkg.highlights || [];
      html += `<div style="padding:20px 16px;border-radius:12px;border:2px solid ${isSel ? accent : '#eee'};background:${isSel ? 'rgba(255,107,0,0.03)' : '#fafbfc'};text-align:center;position:relative">
        ${isSel ? `<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:${accent};color:#fff;font-size:0.6em;font-weight:700;padding:3px 12px;border-radius:4px;letter-spacing:1px;white-space:nowrap">YOUR PLAN</div>` : ''}
        <div style="font-weight:800;font-size:0.92em;${isSel ? 'color:'+accent : ''}">${esc(pkg.name)}</div>
        ${pkg.badge ? `<div style="font-size:0.65em;color:#888;margin-top:2px">${esc(pkg.badge)}</div>` : ''}
        <div style="font-size:1.6em;font-weight:900;margin:12px 0 4px;${isSel ? 'color:'+accent : 'color:#1a1a2e'}">${esc(pkg.total)}</div>
        <div style="font-size:0.72em;color:#999">incl. tax</div>
        ${pkg.warranty ? `<div style="font-size:0.72em;color:#16a34a;margin-top:8px;font-weight:600">${esc(pkg.warranty)}</div>` : ''}
        <div style="margin-top:10px;text-align:left">
          ${hl.slice(0,3).map(h => `<div style="font-size:0.72em;color:#666;padding:2px 0;display:flex;align-items:flex-start;gap:4px"><span style="color:#16a34a;font-weight:700">✓</span>${esc(h)}</div>`).join('')}
        </div>
      </div>`;
    }
    html += '</div></div>';
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
    const monthlyEst = p.pricing?.totalRaw ? Math.round(p.pricing.totalRaw / 120) : null;
    html += `<div class="finance-cta">
      <h3>Monthly Payments Available</h3>
      ${monthlyEst ? `<div style="font-size:2em;font-weight:900;margin:8px 0">~$${monthlyEst}/month</div><div style="font-size:0.8em;opacity:0.6;margin-bottom:12px">Estimated at 120 months</div>` : ''}
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


// ═══════════════════════════════════════════════════════════════
// MATERIAL PICKUP SHEET
// Print-ready list for crew to take to supplier
// ═══════════════════════════════════════════════════════════════

export function renderMaterialPickupHTML(data) {
  const items = data.items || [];
  const offer = data.offer || '';
  const customer = data.customer || '';
  const address = data.address || '';
  const date = new Date().toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric', year:'numeric'});

  return `<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Material Pickup — ${esc(customer)} | ${esc(offer)}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:'Inter',system-ui,sans-serif;font-size:13px;color:#1a1a2e;padding:20px}
      @media print{body{padding:10px}.no-print{display:none!important}}
      .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:16px}
      .header h1{font-size:1.3em;font-weight:800}
      .header .meta{font-size:0.85em;color:#666}
      table{width:100%;border-collapse:collapse;margin-bottom:16px}
      th{text-align:left;padding:8px 10px;font-size:0.75em;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#666;border-bottom:2px solid #ddd;background:#f8f8f8}
      td{padding:8px 10px;border-bottom:1px solid #eee;font-size:0.9em}
      .check{width:28px;text-align:center}
      .check-box{width:16px;height:16px;border:2px solid #999;border-radius:3px;display:inline-block}
      .qty{font-weight:700;text-align:center;width:60px}
      .source{font-size:0.8em;color:#888;max-width:200px}
      .total-row{font-weight:700;background:#f0f0f0}
      .footer{margin-top:20px;padding-top:12px;border-top:1px solid #ddd;font-size:0.8em;color:#999;display:flex;justify-content:space-between}
      .print-bar{position:fixed;top:0;left:0;right:0;background:#1a1a2e;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;z-index:100}
      .print-bar span{color:#fff;font-weight:600;font-size:0.9em}
      .print-bar button{padding:6px 16px;border:none;border-radius:6px;font-weight:600;cursor:pointer}
      .print-bar .btn-print{background:#4a9eff;color:#fff;margin-left:8px}
      .print-bar .btn-close{background:rgba(255,255,255,0.1);color:#fff}
      .notes-area{margin-top:16px;border:1px solid #ddd;border-radius:6px;padding:12px;min-height:60px}
      .notes-label{font-size:0.75em;font-weight:700;text-transform:uppercase;color:#999;margin-bottom:4px}
    </style>
  </head><body>
    <div class="print-bar no-print">
      <span>Material Pickup Sheet</span>
      <div><button class="btn-close" onclick="window.close()">Close</button><button class="btn-print" onclick="window.print()">Print</button></div>
    </div>
    <div style="margin-top:50px">
      <div class="header">
        <div>
          <h1>Material Pickup List</h1>
          <div class="meta">${esc(offer)} Package</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700">${esc(customer)}</div>
          <div class="meta">${esc(address)}</div>
          <div class="meta">${date}</div>
        </div>
      </div>

      <table>
        <thead><tr><th class="check"></th><th>Item</th><th class="qty">Qty</th><th>Unit</th><th>Source</th></tr></thead>
        <tbody>
          ${items.map(m => `<tr>
            <td class="check"><span class="check-box"></span></td>
            <td>${esc(m.item)}${m.estimated?' <span style="color:#c90">*</span>':''}</td>
            <td class="qty">${m.quantity}</td>
            <td>${esc(m.unit)}</td>
            <td class="source">${esc(m.source)}</td>
          </tr>`).join('')}
          <tr class="total-row"><td></td><td>Total Items</td><td class="qty">${items.length}</td><td></td><td></td></tr>
        </tbody>
      </table>

      <div class="notes-area">
        <div class="notes-label">Pickup Notes</div>
      </div>

      <div class="footer">
        <span>Ryujin OS — Material Pickup Sheet</span>
        <span>Printed: ${date}</span>
      </div>
    </div>
  </body></html>`;
}


// ═══════════════════════════════════════════════════════════════
// SALES PAGE RENDERER
// The warm-up intro page sent to clients via link.
// NO PRICING on this page — builds desire, then CTAs to proposal.
// Structure mirrors the original Estimator OS sales page:
//   Hero → Warm intro → Video → What's Included → Crew → About → CTA
// ═══════════════════════════════════════════════════════════════

export function renderSalesPageHTML(salesData) {
  // ═══════════════════════════════════════════════════════════════
  // VISUAL SALES PRESENTATION — Dark theme, full-viewport slides
  // Ported from the original Estimator OS proposal.js
  // This is what gets sent to clients — NO pricing on this page
  // Structure: Hero → Intro → Video → What's Included → Gallery → About → CTA
  // ═══════════════════════════════════════════════════════════════
  const s = salesData;
  const brand = s.branding || {};
  const accent = brand.accentColor || '#FF6B00';
  const companyName = brand.companyName || 'Plus Ultra Roofing';
  const customerName = s.hero?.headline?.split(',')[0] || 'Homeowner';
  const coverPhoto = (s.hero?.photos && s.hero.photos.length > 0) ? s.hero.photos[0] : '';
  const packageName = s.package?.name || 'Custom Package';
  const rep = s.salesRep || { name: 'Mackenzie Mazerolle', phone: '(506) 540-1052', phoneTel: '5065401052', email: 'plusultraroofing@gmail.com', title: 'Owner', bio: '' };
  const tmpl = s.template || {};
  const contactPhone = rep.phone || brand.phone || '(506) 540-1052';
  const contactEmail = rep.email || brand.email || 'plusultraroofing@gmail.com';
  const customMessage = tmpl.introMessage || "We took a close look at your property and put together a plan that fits your home, your budget, and your timeline. No pressure, no games — just honest options from a local crew that takes pride in every job.";

  // Brand photos — crew/job social proof
  const BRAND_PHOTOS = [
    { url: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/683df2a1e1360e210d25da2f.jpeg', alt: 'Completed roof — aerial drone view' },
    { url: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/683df2a18406d6d308cec7a1.jpeg', alt: 'Premium shingle installation — drone shot' },
    { url: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/6839b129d906870c391d2e00.jpeg', alt: 'Crew and crane — material delivery' },
    { url: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/684214dee142b673f143437d.jpeg', alt: 'Crew installing roof — blue sky' },
    { url: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/6841dac0598392e117d07add.jpeg', alt: 'Commercial roofing project' },
    { url: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/696b6c244e42b975f6577663.jpg', alt: 'Roofer installing underlayment' }
  ];

  const SALES_STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; color: #1a1a2e; background: #fff; }
    .container { max-width: 720px; margin: 0 auto; }

    body{font-family:'Inter',sans-serif;background:#111;color:#f0f0f0;overflow-x:hidden;-webkit-font-smoothing:antialiased}
    .bg{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0}
    .bg::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 20% 50%,rgba(30,60,90,0.4) 0%,transparent 70%),radial-gradient(ellipse at 80% 20%,rgba(20,50,80,0.3) 0%,transparent 60%);animation:bgPulse 20s ease infinite alternate}
    @keyframes bgPulse{0%{opacity:0.6}100%{opacity:1}}
    .page{position:relative;z-index:1}

    /* Hero — full viewport */
    .hero{position:relative;height:100vh;min-height:600px;max-height:900px;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(0.5)}
    .hero-overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0.3) 0%,rgba(0,0,0,0.1) 40%,rgba(0,0,0,0.6) 80%,rgba(17,17,17,1) 100%)}
    .hero-text{position:relative;z-index:2;text-align:center;padding:0 30px;max-width:800px}
    .hero h1{font-family:'Montserrat',sans-serif;font-size:3.2em;font-weight:800;line-height:1.1;letter-spacing:-1px;margin-bottom:16px;color:#fff}
    .hero .tagline{font-size:1.15em;font-weight:300;color:rgba(255,255,255,0.7);letter-spacing:1px}
    .scroll-hint{position:absolute;bottom:30px;left:50%;transform:translateX(-50%);z-index:2;animation:bounce 2s ease infinite}
    .scroll-hint svg{width:28px;height:28px;stroke:rgba(255,255,255,0.4);fill:none;stroke-width:2}
    @keyframes bounce{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(10px)}}

    /* Sections */
    .section{max-width:800px;margin:0 auto;padding:80px 24px}
    .section-sm{max-width:800px;margin:0 auto;padding:40px 24px}

    /* Intro */
    .intro h2{font-family:'Montserrat',sans-serif;font-size:1.8em;font-weight:700;margin-bottom:24px;color:#fff}
    .intro p{font-size:1.1em;line-height:1.9;color:rgba(255,255,255,0.75);margin-bottom:16px}
    .intro .name{color:rgba(255,255,255,0.5);font-size:0.95em;margin-top:24px;font-style:italic}

    /* Video */
    .video-wrap{max-width:800px;margin:0 auto;padding:0 24px 60px}
    .video-card{position:relative;border-radius:16px;overflow:hidden;background:#000;box-shadow:0 20px 60px rgba(0,0,0,0.5)}
    .video-card video{width:100%;display:block}
    .video-placeholder{aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:16px}

    /* What we do */
    .what-section{background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.06);border-bottom:1px solid rgba(255,255,255,0.06)}
    .what-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:30px}
    .what-item{text-align:center;padding:24px 16px}
    .what-item .icon{font-size:2em;margin-bottom:12px}
    .what-item h4{font-family:'Montserrat',sans-serif;font-size:0.95em;font-weight:700;margin-bottom:8px;color:#fff}
    .what-item p{font-size:0.85em;color:rgba(255,255,255,0.5);line-height:1.6}

    /* Gallery */
    .gallery-title{font-family:'Montserrat',sans-serif;font-size:1.4em;font-weight:700;text-align:center;margin-bottom:30px;color:rgba(255,255,255,0.9)}
    .gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:900px;margin:0 auto;padding:0 24px}
    .gallery img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;transition:transform 0.4s ease,filter 0.4s ease;filter:brightness(0.85)}
    .gallery img:hover{transform:scale(1.03);filter:brightness(1)}

    /* Scope sections */
    .scope-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:700px;margin:0 auto}
    .scope-card{padding:24px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:16px}
    .scope-card h4{font-family:'Montserrat',sans-serif;font-size:0.95em;font-weight:700;color:${accent};margin-bottom:8px}
    .scope-card p{font-size:0.85em;color:rgba(255,255,255,0.6);line-height:1.6}
    .scope-card ul{padding-left:16px;font-size:0.82em;color:rgba(255,255,255,0.5);margin-top:8px}
    .scope-card li{padding:2px 0}

    /* CTA */
    .cta-section{text-align:center;padding:100px 24px 80px}
    .cta-section h2{font-family:'Montserrat',sans-serif;font-size:2em;font-weight:800;margin-bottom:12px;color:#fff}
    .cta-section .sub{font-size:1.05em;color:rgba(255,255,255,0.5);margin-bottom:40px;max-width:500px;margin-left:auto;margin-right:auto}
    .cta-btn{display:inline-block;padding:18px 48px;background:#fff;color:#111;text-decoration:none;border-radius:50px;font-family:'Montserrat',sans-serif;font-weight:700;font-size:1.05em;letter-spacing:0.5px;transition:all 0.3s ease;box-shadow:0 4px 20px rgba(255,255,255,0.15)}
    .cta-btn:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(255,255,255,0.25)}
    .cta-alt{display:block;margin-top:20px;color:rgba(255,255,255,0.4);font-size:0.9em;text-decoration:none}
    .cta-alt:hover{color:rgba(255,255,255,0.7)}
    .financing{margin-top:16px;font-size:0.85em;color:rgba(255,255,255,0.35)}

    /* Testimonial */
    .testimonial-section{max-width:700px;margin:0 auto;padding:60px 24px;text-align:center}
    .testimonial-text{font-size:1.15em;line-height:1.8;color:rgba(255,255,255,0.7);font-style:italic;margin-bottom:16px}
    .testimonial-author{font-size:0.85em;color:rgba(255,255,255,0.4);font-weight:600}

    /* About estimator */
    .about-card{max-width:550px;margin:0 auto;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px 30px;text-align:center}
    .about-card h3{font-family:'Montserrat',sans-serif;font-size:1.4em;font-weight:700;color:#fff;margin-bottom:6px}
    .about-card .title{font-size:0.85em;color:rgba(255,255,255,0.4);margin-bottom:20px;letter-spacing:1px;text-transform:uppercase}
    .about-card p{font-size:1em;line-height:1.8;color:rgba(255,255,255,0.7);margin-bottom:24px}
    .about-links{display:flex;justify-content:center;gap:20px;flex-wrap:wrap}
    .about-links a{color:rgba(255,255,255,0.6);text-decoration:none;font-size:0.95em;transition:color 0.2s}
    .about-links a:hover{color:#fff}

    /* Footer */
    .footer{text-align:center;padding:40px 24px;border-top:1px solid rgba(255,255,255,0.06);color:rgba(255,255,255,0.25);font-size:0.8em}
    .footer .brand{font-family:'Montserrat',sans-serif;font-weight:800;font-size:1.1em;color:rgba(255,255,255,0.4);letter-spacing:2px;display:block;margin-bottom:8px}
    .footer a{color:rgba(255,255,255,0.35);text-decoration:none}
    .footer a:hover{color:rgba(255,255,255,0.6)}

    /* Mobile */
    @media(max-width:700px){
      .hero{height:80vh;min-height:500px}
      .hero h1{font-size:2em}
      .hero .tagline{font-size:0.95em}
      .section{padding:60px 20px}
      .what-grid{grid-template-columns:1fr}
      .gallery{grid-template-columns:repeat(2,1fr)}
      .scope-grid{grid-template-columns:1fr}
      .cta-section h2{font-size:1.5em}
      .cta-btn{padding:16px 36px;font-size:0.95em}
    }
    @media(max-width:400px){.hero h1{font-size:1.6em}.gallery{grid-template-columns:1fr 1fr}}
    }
    .hero-cover { width: 100%; height: 320px; object-fit: cover; display: block; }
    .hero-cover-placeholder {
      width: 100%; height: 320px; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #1a1a2e, #3d2b5e);
      flex-direction: column; gap: 12px;
    }
    .hero-content { padding: 40px 32px 48px; text-align: center; }
    .hero-content h1 { font-size: 2em; font-weight: 900; line-height: 1.15; margin-bottom: 8px; }
    .hero-content .sub { font-size: 1em; opacity: 0.7; }
    .hero-badge { display: inline-block; margin-top: 16px; padding: 8px 24px; border-radius: 24px; font-size: 0.8em; font-weight: 700; letter-spacing: 1px; background: ${accent}; color: #fff; }

    /* Warm intro section */
    .intro-section { padding: 48px 32px; background: #fff; }
    .intro-section .letter {
      font-size: 1.05em; line-height: 1.85; color: #444; max-width: 600px; margin: 0 auto;
    }
    .intro-section .sign { margin-top: 20px; font-weight: 700; color: #1a1a2e; font-size: 1.1em; }
    .intro-section .role { font-size: 0.85em; color: #888; }

    /* Video section */
    .video-section { padding: 0 32px 48px; text-align: center; }
    .video-placeholder {
      width: 100%; max-width: 600px; margin: 0 auto; aspect-ratio: 16/9;
      background: #f0f3f7; border-radius: 16px; display: flex; align-items: center;
      justify-content: center; flex-direction: column; gap: 8px; border: 2px dashed #ddd;
    }

    /* Included section */
    .included-section { padding: 48px 32px; background: #fafbfc; }
    .included-section h2 { text-align: center; font-size: 1.4em; font-weight: 800; margin-bottom: 24px; }
    .included-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; max-width: 600px; margin: 0 auto; }
    .included-item { display: flex; align-items: flex-start; gap: 10px; padding: 14px 16px; background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.04); }
    .included-check { color: #16a34a; font-weight: 800; font-size: 1.2em; flex-shrink: 0; }
    .included-label { font-size: 0.9em; font-weight: 600; }
    .included-desc { font-size: 0.78em; color: #888; margin-top: 2px; line-height: 1.4; }

    /* Crew section */
    .crew-section { padding: 48px 32px; text-align: center; }
    .crew-section h2 { font-size: 1.3em; font-weight: 800; margin-bottom: 20px; }
    .crew-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; max-width: 500px; margin: 0 auto; }
    .crew-photo {
      aspect-ratio: 1; background: #f0f3f7; border-radius: 12px; display: flex;
      align-items: center; justify-content: center; overflow: hidden;
    }
    .crew-photo img { width: 100%; height: 100%; object-fit: cover; }

    /* About section */
    .about-section { padding: 48px 32px; background: #fafbfc; }
    .about-section h2 { font-size: 1.3em; font-weight: 800; margin-bottom: 16px; text-align: center; }
    .about-card { display: flex; gap: 20px; align-items: flex-start; max-width: 600px; margin: 0 auto; }
    .about-avatar { width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, ${accent}, #FF8C42); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 900; font-size: 1.5em; flex-shrink: 0; }
    .about-info h3 { font-size: 1.05em; font-weight: 700; }
    .about-info .title { font-size: 0.82em; color: ${accent}; font-weight: 600; margin-bottom: 8px; }
    .about-info p { font-size: 0.88em; color: #555; line-height: 1.7; }
    .about-contact { margin-top: 12px; font-size: 0.85em; }
    .about-contact a { color: ${accent}; text-decoration: none; font-weight: 600; }

    /* CTA section */
    .cta-section { padding: 56px 32px; text-align: center; background: linear-gradient(135deg, #1a1a2e 0%, #2d1b4e 100%); color: #fff; }
    .cta-section h2 { font-size: 1.6em; font-weight: 900; margin-bottom: 8px; }
    .cta-section p { font-size: 0.95em; opacity: 0.7; margin-bottom: 24px; max-width: 500px; margin-left: auto; margin-right: auto; }
    .cta-btn { display: inline-block; padding: 16px 48px; background: ${accent}; color: #fff; border-radius: 10px; font-weight: 800; font-size: 1.05em; text-decoration: none; letter-spacing: 0.5px; transition: transform 0.2s; }
    .cta-btn:hover { transform: scale(1.03); }

    /* Footer */
    .sales-footer { padding: 32px; text-align: center; font-size: 0.82em; color: #999; background: #fafbfc; border-top: 1px solid #eee; }
    .sales-footer a { color: ${accent}; text-decoration: none; }

    @media (max-width: 600px) {
      .hero-content h1 { font-size: 1.5em; }
      .included-grid { grid-template-columns: 1fr; }
      .crew-grid { grid-template-columns: repeat(2, 1fr); }
      .about-card { flex-direction: column; align-items: center; text-align: center; }
      .intro-section, .included-section, .crew-section, .about-section { padding: 32px 20px; }
    }
  `;

  // What every package includes (sell the vacation)
  const standardIncludes = [
    { label: 'Complete Tear-Off', desc: 'Old materials fully removed down to the deck' },
    { label: 'Ice & Water Shield', desc: 'Protection where your roof needs it most' },
    { label: 'Underlayment', desc: 'Full-deck moisture barrier under your shingles' },
    { label: 'Ventilation', desc: 'Ridge vent system for proper attic airflow' },
    { label: 'New Flashing', desc: 'Drip edge, valleys & pipe boots — sealed tight' },
    { label: 'Full Cleanup', desc: 'Magnetic nail sweep, debris hauled, yard restored' },
    { label: 'Final Walkthrough', desc: 'We inspect together before we leave' },
    { label: 'Workmanship Warranty', desc: 'Your investment is protected for years' }
  ];

  let html = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>${esc(customerName)}'s Roofing Options — ${esc(companyName)}</title>
    <meta property="og:title" content="Your System. Your Timeline. Your Decision.">
    <meta property="og:description" content="Same professional standard. Different performance levels.">
    <meta name="theme-color" content="#111111">
    <style>${SALES_STYLES}</style>
  </head><body>
  <div class="bg"></div>
  <div class="page">

  <!-- ═══ SLIDE 1: HERO — Full viewport with cover photo ═══ -->
  <div class="hero">
    ${coverPhoto
      ? `<img class="hero-img" src="${esc(coverPhoto)}" alt="Your property" onerror="this.style.display='none'">`
      : `<div class="hero-img" style="background:linear-gradient(135deg,#1a2a3a,#0d1520)"></div>`
    }
    <div class="hero-overlay"></div>
    <div class="hero-text">
      <h1>${esc(tmpl.headline || 'Your System. Your Timeline. Your Decision.')}</h1>
      <div class="tagline">${esc(tmpl.tagline || 'Same professional standard. Different performance levels.')}</div>
    </div>
    <div class="scroll-hint"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></div>
  </div>

  <!-- ═══ SLIDE 2: PERSONAL INTRO ═══ -->
  <div class="section intro">
    <h2>Hi ${esc(customerName)},</h2>
    <p>${customMessage}</p>
    <p class="name">— ${esc(rep.name)}, ${esc(rep.title || companyName)}</p>
  </div>

  <!-- ═══ SLIDE 3: VIDEO (placeholder if no URL) ═══ -->
  <div class="video-wrap">
    <div class="video-card">
      <div class="video-placeholder">
        <div style="font-size:3em;opacity:0.15">▶</div>
        <div style="font-size:0.9em;color:rgba(255,255,255,0.4)">Personal video intro</div>
        <div style="font-size:0.75em;color:rgba(255,255,255,0.2)">Recorded on location for your project</div>
      </div>
    </div>
  </div>

  <!-- ═══ SLIDE 4: WHAT EVERY PACKAGE INCLUDES ═══ -->
  <div class="what-section">
    <div class="section">
      <h2 style="font-family:'Montserrat',sans-serif;font-size:1.4em;font-weight:700;text-align:center;margin-bottom:8px">What Every Package Includes</h2>
      <p style="text-align:center;color:rgba(255,255,255,0.45);font-size:0.95em;margin-bottom:10px">Three tiers. One standard of excellence.</p>
      <div class="what-grid">
        <div class="what-item"><div class="icon">🛡️</div><h4>Full Tear-Off</h4><p>Old shingles removed down to the deck. No layering, no shortcuts.</p></div>
        <div class="what-item"><div class="icon">🧊</div><h4>Ice &amp; Water Shield</h4><p>Applied at eaves, valleys, and penetrations for leak protection where it matters most.</p></div>
        <div class="what-item"><div class="icon">📋</div><h4>Manufacturer Warranty</h4><p>Every package backed by the manufacturer plus our own workmanship guarantee.</p></div>
      </div>
    </div>
  </div>

  ${s.scope && s.scope.length > 0 ? `
  <!-- ═══ SLIDE 4.5: YOUR PROJECT SCOPE ═══ -->
  <div class="section">
    <h2 style="font-family:'Montserrat',sans-serif;font-size:1.4em;font-weight:700;text-align:center;margin-bottom:30px">Your Project Scope</h2>
    <div class="scope-grid">
      ${s.scope.map(section => `
        <div class="scope-card">
          <h4>${esc(section.title)}</h4>
          <p>${esc(section.description || '')}</p>
          ${section.items ? `<ul>${section.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
        </div>
      `).join('')}
    </div>
  </div>` : ''}

  <!-- ═══ SLIDE 5: OUR WORK — Real project photos ═══ -->
  <div class="section-sm">
    <div class="gallery-title">Our Work Across Greater Moncton</div>
    <div class="gallery">
      ${BRAND_PHOTOS.map(ph => `<img src="${ph.url}" alt="${esc(ph.alt)}" loading="lazy">`).join('\n      ')}
    </div>
  </div>

  <!-- ═══ SLIDE 5.5: GOOGLE REVIEWS ═══ -->
  <div class="section" style="text-align:center">
    <div style="color:#facc15;font-size:1.2em;margin-bottom:8px">⭐⭐⭐⭐⭐</div>
    <h2 style="font-family:'Montserrat',sans-serif;font-size:1.3em;font-weight:700;margin-bottom:4px">What Your Neighbors Are Saying</h2>
    <div style="font-size:0.82em;color:rgba(255,255,255,0.35);margin-bottom:24px">35+ five-star reviews on Google</div>
    <div style="max-width:600px;margin:0 auto">
      <div style="padding:20px 24px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;margin-bottom:10px;text-align:left">
        <div style="color:#facc15;font-size:0.8em;margin-bottom:6px">⭐⭐⭐⭐⭐</div>
        <p style="font-size:0.95em;line-height:1.8;color:rgba(255,255,255,0.7);font-style:italic">"Professional crew, clean job site, excellent communication throughout. The whole process was smooth from the first estimate to the final walkthrough."</p>
        <div style="font-size:0.78em;color:rgba(255,255,255,0.35);font-weight:600;margin-top:8px">— Verified Google Review</div>
      </div>
      <div style="padding:20px 24px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;text-align:left">
        <div style="color:#facc15;font-size:0.8em;margin-bottom:6px">⭐⭐⭐⭐⭐</div>
        <p style="font-size:0.95em;line-height:1.8;color:rgba(255,255,255,0.7);font-style:italic">"Best roofing experience we've had. Fair pricing, quality materials, and they actually explain what they're doing and why. Five stars."</p>
        <div style="font-size:0.78em;color:rgba(255,255,255,0.35);font-weight:600;margin-top:8px">— Google Review</div>
      </div>
    </div>
  </div>

  <!-- ═══ SLIDE 6: ABOUT YOUR ESTIMATOR ═══ -->
  <div class="section" style="text-align:center">
    <h2 style="font-family:'Montserrat',sans-serif;font-size:1.2em;font-weight:700;color:rgba(255,255,255,0.5);letter-spacing:2px;text-transform:uppercase;margin-bottom:30px">About Your Estimator</h2>
    <div class="about-card">
      <h3>${esc(rep.name)}</h3>
      <div class="title">${esc(rep.title || 'Estimator')} &bull; CertainTeed Certified</div>
      <p>${esc(rep.bio || rep.name + ' is part of the ' + companyName + ' team — dedicated to doing every job right.')}</p>
      <div class="about-links">
        <a href="tel:${esc((rep.phoneTel||contactPhone).replace(/[^0-9]/g,''))}">${esc(contactPhone)}</a>
        ${brand.website ? `<a href="${esc(brand.website)}">${esc(brand.website.replace('https://',''))}</a>` : ''}
      </div>
    </div>
  </div>

  <!-- ═══ SLIDE 7: CTA — Ready to see your options? ═══ -->
  <div class="cta-section">
    <h2>Ready to See Your Options?</h2>
    <div class="sub">Your full proposal is ready — with pricing, materials, and warranty details for your ${esc(packageName)} package.</div>
    <a href="${esc(s.cta?.acceptUrl || '#')}" class="cta-btn">${esc(s.cta?.label || 'View Your Proposal')}</a>
    <a href="tel:${esc((rep.phoneTel||contactPhone).replace(/[^0-9]/g,''))}" class="cta-alt">Or call ${esc(rep.name.split(' ')[0])} at ${esc(contactPhone)}</a>
    <div class="financing">Financing available through FinanceIt</div>
  </div>

  <!-- ═══ FOOTER ═══ -->
  <div class="footer">
    <span class="brand">${esc(companyName.toUpperCase())}</span>
    ${esc(brand.tagline || 'Go Beyond.')} &middot; Riverview, NB<br>
    <a href="tel:${esc(contactPhone.replace(/[^0-9]/g,''))}">${esc(contactPhone)}</a> &middot;
    <a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a>
    ${brand.website ? ` &middot; <a href="${esc(brand.website)}">${esc(brand.website.replace('https://',''))}</a>` : ''}
  </div>

  </div>
  </body></html>`;

  return html;
}
