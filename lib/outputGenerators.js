// ═══════════════════════════════════════════════════════════════
// RYUJIN OS — Output Generators
// Transforms calculated quotes into customer-facing outputs
//
// Three outputs:
//   1. Proposal — bundled retail line items, branding, no hard cost
//   2. Contract — scope, price, payment terms, signature block
//   3. Sales Page Data — structured JSON for visual proposal site
//
// Rules:
//   - Customers NEVER see: hard cost, multipliers, margins, material vs labor splits
//   - Line items are bundled retail (materials + labor + margin baked in)
//   - Remediation framed as transparency ("unused portion credited back")
//   - "Surface vs structural" framing for scope upgrades
// ═══════════════════════════════════════════════════════════════

import { calculateMobilizationDiscount } from './quoteEngineV3.js';

// ─── Bundled Retail Price Calculator ────────────────────────
// Takes internal line items → produces client-facing bundled items
// Groups related items into customer-friendly categories
function bundleLineItems(lineItems, sellingPrice, hardCost) {
  const multiplier = hardCost > 0 ? sellingPrice / hardCost : 1;

  // Group internal items into customer-facing bundles
  const bundles = {
    roofing: { label: 'Roofing System', keys: ['shingles', 'underlayment', 'ice_water', 'starter', 'ridge_cap', 'drip_edge', 'valley_metal', 'pipe_flashing', 'step_flashing', 'ridge_vent', 'nails', 'caulking', 'base_labor', 'tearoff_labor', 'extra_layer_labor', 'cedar_tearoff_labor', 'redeck_labor', 'valley_labor', 'ridge_vent_labor', 'pipe_labor', 'chimney_labor', 'cricket_labor', 'vent_labor', 'metal_panels', 'metal_strapping', 'metal_labor', 'flat_membrane', 'flat_insulation', 'flat_adhesive', 'flat_labor'], total: 0 },
    siding: { label: 'Siding System', keys: ['siding', 'j_channel', 'corner_posts_outside', 'corner_posts_inside', 'window_trim', 'undersill_trim', 'starter_strip_siding', 'drip_cap', 'metal_trim', 'strip_existing'], total: 0 },
    substrate: { label: 'Wall Substrate & Insulation', keys: ['osb_substrate', 'housewrap', 'eps_foam', 'ventigrid', 'sheathing_inspection'], total: 0 },
    soffit: { label: 'Soffit', keys: ['soffit'], total: 0 },
    fascia: { label: 'Fascia', keys: ['fascia'], total: 0 },
    gutters: { label: 'Gutters', keys: ['gutters', 'leaf_guard'], total: 0 },
    windows: { label: 'Windows', keys: ['window_capping', 'door_capping', 'window_replacement', 'window_small', 'window_medium', 'window_large'], total: 0 },
    remediation: { label: 'Remediation Allowance', keys: ['remediation'], total: 0, isRemediation: true },
    overhead: { label: 'Project Logistics', keys: ['distance_adder', 'project_overhead', 'disposal', 'warranty'], total: 0 }
  };

  // Sum hard costs per bundle
  for (const li of lineItems) {
    if (!li.included) continue;
    for (const [bundleKey, bundle] of Object.entries(bundles)) {
      if (bundle.keys.includes(li.item_key)) {
        bundle.total += li.total_cost;
        break;
      }
    }
  }

  // Convert to retail (apply multiplier to each bundle)
  const retailItems = [];
  for (const [key, bundle] of Object.entries(bundles)) {
    if (bundle.total <= 0) continue;

    const retailPrice = bundle.isRemediation
      ? bundle.total  // Remediation shown at face value (credited back if unused)
      : Math.round(bundle.total * multiplier);

    retailItems.push({
      key,
      label: bundle.label,
      retailPrice,
      isRemediation: bundle.isRemediation || false
    });
  }

  return retailItems;
}


// ═══════════════════════════════════════════════════════════════
// PROPOSAL GENERATOR
// Client-facing quote document — no internal pricing exposed
// ═══════════════════════════════════════════════════════════════

export function generateProposal(quoteResult, options = {}) {
  const {
    customerName = '',
    propertyAddress = '',
    preparedBy = '',
    date = new Date().toISOString().split('T')[0],
    branding = {},
    addOnQuote = null,       // for mobilization discount
    mobilizationSettings = null,
    notes = '',
    financingAvailable = true,
    photos = []              // property photo URLs
  } = options;

  const { offer, summary, lineItems, measurements } = quoteResult;

  // Bundle line items into client-facing retail
  const retailItems = bundleLineItems(lineItems, summary.sellingPrice, summary.hardCost);

  // Calculate subtotal from retail items (should match selling price)
  const retailSubtotal = retailItems.reduce((sum, ri) => sum + ri.retailPrice, 0);

  // Mobilization discount (if add-on work)
  let mobilization = null;
  if (addOnQuote && mobilizationSettings) {
    mobilization = calculateMobilizationDiscount(
      summary.sellingPrice,
      addOnQuote.summary.sellingPrice,
      { mobilization: mobilizationSettings }
    );
  }

  // Scope description (client-friendly)
  const scopeItems = [];
  for (const li of lineItems) {
    if (!li.included || li.category === 'overhead' || li.category === 'disposal') continue;
    // Clean label for client
    const label = li.label
      .replace(/\s*\*.*$/, '')  // remove asterisk notes
      .replace(/\(.*\)$/, '')   // remove parenthetical details
      .trim();
    if (label && !scopeItems.includes(label)) {
      scopeItems.push(label);
    }
  }

  // Warranty text
  const warrantyText = offer.warranty_years
    ? `${offer.warranty_years}-year workmanship warranty included. Manufacturer material warranties apply separately.`
    : 'Standard workmanship warranty included.';

  // Remediation framing
  const remediationItem = retailItems.find(ri => ri.isRemediation);
  const remediationNote = remediationItem
    ? `Includes a $${remediationItem.retailPrice.toLocaleString()} remediation allowance. If we don't use it, you get the difference back.`
    : null;

  return {
    type: 'proposal',
    version: '3.1',

    // Header
    company: {
      name: branding.companyName || 'Ryujin OS',
      phone: branding.phone || '',
      email: branding.email || '',
      website: branding.website || '',
      logoUrl: branding.logoUrl || '',
      accentColor: branding.accentColor || '#FF6B00'
    },

    // Customer info
    customer: {
      name: customerName,
      address: propertyAddress
    },

    // Proposal details
    proposal: {
      date,
      preparedBy,
      offerName: offer.name,
      badge: offer.badge,
      system: offer.system,
      slug: offer.slug,
      description: offer.description || `${offer.name} package for ${propertyAddress || 'your property'}.`
    },

    // Scope of work (client-friendly list)
    scope: scopeItems,

    // Bundled retail line items (NO internal cost exposed)
    lineItems: retailItems.map(ri => ({
      label: ri.label,
      price: `$${ri.retailPrice.toLocaleString()}`,
      priceRaw: ri.retailPrice,
      note: ri.isRemediation ? 'Unused portion credited back to you' : null
    })),

    // Pricing
    pricing: {
      subtotal: `$${summary.sellingPrice.toLocaleString()}`,
      subtotalRaw: summary.sellingPrice,
      tax: `$${summary.tax.toLocaleString()}`,
      taxLabel: summary.taxLabel || 'HST',
      taxRaw: summary.tax,
      total: `$${summary.totalWithTax.toLocaleString()}`,
      totalRaw: summary.totalWithTax
    },

    // Mobilization discount (if applicable)
    mobilization: mobilization && mobilization.eligible ? {
      label: mobilization.label,
      framing: mobilization.framing,
      discountPct: `${mobilization.discountPct}%`,
      discountAmount: `$${mobilization.discountAmount.toLocaleString()}`,
      discountedAddOnPrice: `$${mobilization.discountedPrice.toLocaleString()}`,
      bundledTotal: `$${mobilization.bundledTotal.toLocaleString()}`,
      note: mobilization.note
    } : null,

    // Warranty
    warranty: warrantyText,

    // Remediation
    remediationNote,

    // Financing
    financing: financingAvailable ? {
      available: true,
      text: 'Financing available through FinanceIt. Apply online — approval in minutes.',
      note: 'Ask us about monthly payment options.'
    } : null,

    // Notes
    notes: notes || null,

    // Photos
    photos,

    // Estimated pricing warning
    estimatedWarning: summary.hasEstimatedPricing
      ? 'Some pricing in this proposal uses estimated regional rates. Final pricing may vary once confirmed with suppliers.'
      : null,

    // Metadata
    generatedAt: new Date().toISOString()
  };
}


// ═══════════════════════════════════════════════════════════════
// CONTRACT GENERATOR
// Scope of work, price, payment terms, warranty, signature block
// ═══════════════════════════════════════════════════════════════

export function generateContract(quoteResult, options = {}) {
  const {
    customerName = '',
    propertyAddress = '',
    date = new Date().toISOString().split('T')[0],
    branding = {},
    depositPercent = 33,
    paymentTerms = 'net_completion',  // 'net_completion', 'progress', 'custom'
    customTerms = '',
    validDays = 30
  } = options;

  const { offer, summary, lineItems } = quoteResult;

  // Scope of work — more detailed than proposal
  const scopeSections = [];
  const categories = ['materials', 'labor', 'disposal', 'overhead', 'warranty'];

  for (const cat of categories) {
    const items = lineItems.filter(li => li.included && li.category === cat);
    if (items.length === 0) continue;

    const catLabel = {
      materials: 'Materials & Installation',
      labor: 'Labor',
      disposal: 'Cleanup & Disposal',
      overhead: 'Project Logistics',
      warranty: 'Warranty'
    }[cat] || cat;

    scopeSections.push({
      category: catLabel,
      items: items.map(li => li.label.replace(/\s*\*.*$/, '').trim()).filter(Boolean)
    });
  }

  // Payment schedule
  const depositAmount = Math.round(summary.totalWithTax * (depositPercent / 100));
  const balanceAmount = summary.totalWithTax - depositAmount;

  let paymentSchedule;
  if (paymentTerms === 'progress') {
    paymentSchedule = [
      { milestone: 'Upon signing', amount: depositAmount, percent: depositPercent },
      { milestone: 'At 50% completion', amount: Math.round(balanceAmount / 2), percent: Math.round((100 - depositPercent) / 2) },
      { milestone: 'Upon completion', amount: balanceAmount - Math.round(balanceAmount / 2), percent: 100 - depositPercent - Math.round((100 - depositPercent) / 2) }
    ];
  } else {
    paymentSchedule = [
      { milestone: 'Upon signing (deposit)', amount: depositAmount, percent: depositPercent },
      { milestone: 'Upon completion (balance)', amount: balanceAmount, percent: 100 - depositPercent }
    ];
  }

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + validDays);

  return {
    type: 'contract',
    version: '3.1',

    // Parties
    contractor: {
      name: branding.companyName || 'Ryujin OS',
      phone: branding.phone || '',
      email: branding.email || '',
      website: branding.website || ''
    },
    customer: {
      name: customerName,
      address: propertyAddress
    },

    // Contract details
    details: {
      date,
      offerName: offer.name,
      validUntil: expiryDate.toISOString().split('T')[0],
      validDays
    },

    // Scope of work
    scope: scopeSections,

    // Price
    pricing: {
      price: summary.sellingPrice,
      priceFormatted: `$${summary.sellingPrice.toLocaleString()}`,
      tax: summary.tax,
      taxFormatted: `$${summary.tax.toLocaleString()}`,
      taxLabel: summary.taxLabel || 'HST',
      total: summary.totalWithTax,
      totalFormatted: `$${summary.totalWithTax.toLocaleString()}`
    },

    // Payment
    payment: {
      terms: paymentTerms,
      schedule: paymentSchedule.map(p => ({
        ...p,
        amountFormatted: `$${p.amount.toLocaleString()}`,
        percentFormatted: `${p.percent}%`
      }))
    },

    // Warranty
    warranty: {
      workmanshipYears: offer.warranty_years || 0,
      text: offer.warranty_years
        ? `Contractor warrants all workmanship for a period of ${offer.warranty_years} years from the date of substantial completion. Manufacturer material warranties are separate and provided upon request.`
        : 'Standard workmanship warranty applies.',
      remediationNote: lineItems.some(li => li.item_key === 'remediation' && li.included)
        ? 'This contract includes a remediation allowance for unforeseen conditions discovered during work. Any unused portion of the remediation allowance will be credited back to the customer.'
        : null
    },

    // Terms & conditions
    terms: [
      'Work will be performed in a professional manner in accordance with industry standards.',
      'Contractor will obtain all necessary permits where required.',
      'Customer shall provide reasonable access to the property during work hours.',
      'Any changes to the scope of work must be agreed to in writing by both parties.',
      'Contractor maintains comprehensive liability insurance and workers compensation coverage.',
      'Weather delays do not constitute breach of contract. Contractor will resume work at the earliest reasonable opportunity.',
      'This agreement is binding upon signing by both parties.',
      ...(customTerms ? [customTerms] : [])
    ],

    // Signature block
    signatures: {
      contractor: {
        label: branding.companyName || 'Contractor',
        nameLine: '________________________',
        dateLine: '________________________',
        signatureLine: '________________________'
      },
      customer: {
        label: 'Customer',
        nameLine: '________________________',
        dateLine: '________________________',
        signatureLine: '________________________'
      }
    },

    generatedAt: new Date().toISOString()
  };
}


// ═══════════════════════════════════════════════════════════════
// SALES PAGE DATA GENERATOR
// Structured JSON for per-client visual proposal site
// Follows existing Vercel deploy pattern
// ═══════════════════════════════════════════════════════════════

export function generateSalesPageData(quoteResult, options = {}) {
  const {
    customerName = '',
    propertyAddress = '',
    branding = {},
    photos = [],               // property photos
    aiRenders = [],            // AI-generated renders of proposed work
    testimonials = [],
    multiOfferResults = null,  // for package comparison
    callToAction = 'Accept Proposal',
    acceptUrl = null,          // URL for accept tracking
    declineUrl = null
  } = options;

  const { offer, summary, lineItems } = quoteResult;

  // Bundled retail for display
  const retailItems = bundleLineItems(lineItems, summary.sellingPrice, summary.hardCost);

  // Package comparison (if multi-offer)
  let packageComparison = null;
  if (multiOfferResults && multiOfferResults.offers) {
    packageComparison = Object.entries(multiOfferResults.offers).map(([slug, q]) => ({
      slug,
      name: q.offer.name,
      badge: q.offer.badge,
      price: `$${q.summary.sellingPrice.toLocaleString()}`,
      priceRaw: q.summary.sellingPrice,
      total: `$${q.summary.totalWithTax.toLocaleString()}`,
      totalRaw: q.summary.totalWithTax,
      warranty: q.offer.warranty_years ? `${q.offer.warranty_years}-year warranty` : null,
      isSelected: q.offer.slug === offer.slug,
      highlights: getPackageHighlights(q.offer.slug, q.offer.system)
    }));
  }

  // Scope breakdown (client-friendly sections)
  const scopeSections = [];
  const hasRoofing = lineItems.some(li => li.included && ['shingles', 'metal_panels', 'flat_membrane'].includes(li.item_key));
  const hasExterior = lineItems.some(li => li.included && ['siding', 'strip_existing', 'ventigrid'].includes(li.item_key));
  const hasWindows = lineItems.some(li => li.included && ['window_replacement', 'window_small', 'window_medium', 'window_large'].includes(li.item_key));

  if (hasRoofing) {
    scopeSections.push({
      title: 'Roofing System',
      icon: 'roof',
      description: getRoofingDescription(offer),
      items: lineItems
        .filter(li => li.included && ['shingles', 'underlayment', 'ice_water', 'ridge_vent'].includes(li.item_key))
        .map(li => li.label.replace(/\s*\*.*$/, '').trim())
    });
  }

  if (hasExterior) {
    scopeSections.push({
      title: 'Exterior System',
      icon: 'exterior',
      description: 'Complete wall assembly — stripped to sheathing, rebuilt with modern materials for maximum protection and energy efficiency.',
      items: lineItems
        .filter(li => li.included && ['osb_substrate', 'housewrap', 'eps_foam', 'ventigrid', 'siding'].includes(li.item_key))
        .map(li => li.label.replace(/\s*\*.*$/, '').trim())
    });
  }

  if (lineItems.some(li => li.included && ['soffit', 'fascia', 'gutters'].includes(li.item_key))) {
    scopeSections.push({
      title: 'Trim & Drainage',
      icon: 'trim',
      description: 'New soffit, fascia, and gutters — the finishing touches that protect your investment.',
      items: lineItems
        .filter(li => li.included && ['soffit', 'fascia', 'gutters', 'leaf_guard'].includes(li.item_key))
        .map(li => li.label.replace(/\s*\*.*$/, '').trim())
    });
  }

  if (hasWindows) {
    scopeSections.push({
      title: 'Windows',
      icon: 'windows',
      description: 'Energy-efficient vinyl replacement windows — supply and professional installation included.',
      items: lineItems
        .filter(li => li.included && ['window_small', 'window_medium', 'window_large', 'window_capping'].includes(li.item_key))
        .map(li => li.label.replace(/\s*\*.*$/, '').trim())
    });
  }

  return {
    type: 'sales_page',
    version: '3.1',

    // Branding
    branding: {
      companyName: branding.companyName || 'Ryujin OS',
      logoUrl: branding.logoUrl || '',
      accentColor: branding.accentColor || '#FF6B00',
      tagline: branding.tagline || ''
    },

    // Hero section
    hero: {
      headline: customerName
        ? `${customerName}, Here's Your Custom ${offer.name} Plan`
        : `Your Custom ${offer.name} Plan`,
      subheadline: propertyAddress || 'Tailored for your property',
      photos: photos.length > 0 ? photos : null,
      aiRenders: aiRenders.length > 0 ? aiRenders : null
    },

    // Package info
    package: {
      name: offer.name,
      badge: offer.badge,
      warranty: offer.warranty_years ? `${offer.warranty_years}-Year Workmanship Warranty` : null,
      system: offer.system
    },

    // Scope sections
    scope: scopeSections,

    // Pricing (bundled retail — no internal cost)
    pricing: {
      lineItems: retailItems.map(ri => ({
        label: ri.label,
        price: `$${ri.retailPrice.toLocaleString()}`,
        note: ri.isRemediation ? 'Unused portion credited back to you' : null
      })),
      subtotal: `$${summary.sellingPrice.toLocaleString()}`,
      tax: `$${summary.tax.toLocaleString()} ${summary.taxLabel || 'HST'}`,
      total: `$${summary.totalWithTax.toLocaleString()}`,
      totalRaw: summary.totalWithTax,
      financing: 'Financing available through FinanceIt — apply online, approval in minutes.'
    },

    // Package comparison (if multi-offer)
    comparison: packageComparison,

    // Social proof
    testimonials: testimonials.length > 0 ? testimonials : [
      { text: 'Professional crew, clean job site, excellent communication throughout.', author: 'Recent Customer', rating: 5 }
    ],

    // Call to action
    cta: {
      label: callToAction,
      acceptUrl,
      declineUrl,
      validDays: 30
    },

    // Estimated pricing note
    estimatedWarning: summary.hasEstimatedPricing
      ? 'Some pricing uses estimated regional rates. Final pricing confirmed upon supplier verification.'
      : null,

    generatedAt: new Date().toISOString()
  };
}


// ─── Helper: Package highlights for comparison ──────────────
function getPackageHighlights(slug, system) {
  const highlights = {
    'economy': ['IKO Cambridge shingles', 'Standard materials', '10-year warranty', 'Best value'],
    'gold': ['CertainTeed Landmark', 'Synthetic underlayment', '15-year warranty', 'Most popular'],
    'platinum': ['CertainTeed Landmark PRO', 'Grace ice shield', 'Metal valleys', '20-year warranty'],
    'diamond': ['CertainTeed Presidential', 'Premium everything', '25-year warranty', 'Luxury finish'],
    'performance-shell-plus': ['Full wall rebuild', 'VentiGrid rain screen', 'OSB + insulation', 'Remediation included'],
    'hardie-shell': ['James Hardie fiber cement', 'DrainWrap premium', 'VentiGrid rain screen', '15-year warranty'],
    'gold-shell': ['Gold roof + full shell', 'Complete exterior', '15-year warranty', 'Bundle savings'],
    'platinum-shell': ['Platinum roof + full shell', 'Premium everything', '20-year warranty', 'Best protection']
  };
  return highlights[slug] || [`${slug} package`];
}

// ─── Helper: Roofing description for sales page ─────────────
function getRoofingDescription(offer) {
  if (offer.system === 'metal') {
    return 'Premium metal roofing — durable, low-maintenance, and built to last a lifetime.';
  }
  if (offer.slug && offer.slug.includes('flat')) {
    return 'Commercial-grade flat roofing system — engineered for performance and longevity.';
  }
  const descs = {
    'economy': 'Quality architectural shingles with reliable performance at a competitive price.',
    'gold': 'CertainTeed Landmark architectural shingles — the gold standard in residential roofing.',
    'platinum': 'CertainTeed Landmark PRO with premium underlayment, Grace ice shield, and metal valleys.',
    'diamond': 'CertainTeed Presidential luxury shingles — the finest residential roofing system available.'
  };
  return descs[offer.slug] || `${offer.name} — professional roofing system.`;
}
