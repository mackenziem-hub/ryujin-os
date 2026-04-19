// Ryujin OS — Output Generator API
// POST /api/outputs?type=proposal    — Generate client-facing proposal
// POST /api/outputs?type=contract    — Generate contract with scope + signature
// POST /api/outputs?type=sales_page  — Generate sales page data (for Vercel deploy)
// POST /api/outputs?type=all         — Generate all three at once
//
// All endpoints take a quote result (or re-calculate from offer + measurements)
// and return structured output ready for rendering.
import { calculateQuoteV3, calculateMultiOfferQuote } from '../lib/quoteEngineV3.js';
import { generateProposal, generateContract, generateSalesPageData } from '../lib/outputGenerators.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const tenantId = req.tenant.id;
  const outputType = req.query.type || 'proposal';
  const body = req.body || {};

  // ── Get or calculate quote ──
  let quoteResult = body.quote_result;

  if (!quoteResult) {
    // Calculate fresh from offer + measurements
    const { offer_id, offer_slug, measurements, overrides, choices } = body;

    let offerId = offer_id;
    if (!offerId && offer_slug) {
      const { data: offer } = await supabaseAdmin
        .from('offers').select('id')
        .eq('tenant_id', tenantId).eq('slug', offer_slug).single();
      if (!offer) return res.status(404).json({ error: `Offer "${offer_slug}" not found` });
      offerId = offer.id;
    }

    if (!offerId) {
      return res.status(400).json({
        error: 'Provide quote_result object or offer_id/offer_slug + measurements to calculate.'
      });
    }

    quoteResult = await calculateQuoteV3(supabaseAdmin, {
      tenantId, offerId,
      measurements: measurements || {},
      overrides: overrides || {},
      choices: choices || {},
      mode: 'advanced'
    });

    if (quoteResult.error) return res.status(400).json(quoteResult);
  }

  // ── Load tenant branding (single query, cached if already in quote context) ──
  let branding = {};
  let mobilizationRules = null;
  try {
    const { data: settings } = await supabaseAdmin
      .from('tenant_settings')
      .select('company_name, company_phone, company_email, company_website, logo_url, accent_color, tagline, mobilization_rules')
      .eq('tenant_id', tenantId)
      .single();

    if (settings) {
      branding = {
        companyName: settings.company_name,
        phone: settings.company_phone,
        email: settings.company_email,
        website: settings.company_website,
        logoUrl: settings.logo_url,
        accentColor: settings.accent_color,
        tagline: settings.tagline
      };
      mobilizationRules = settings.mobilization_rules;
    }
  } catch (e) {
    // Continue with empty branding
  }

  // ── Common options ──
  const commonOpts = {
    customerName: body.customer_name || '',
    propertyAddress: body.property_address || '',
    branding,
    photos: body.photos || [],
    notes: body.notes || ''
  };

  // ── Multi-offer comparison (for sales page) ──
  let multiOfferResults = null;
  if (body.compare_offer_ids && Array.isArray(body.compare_offer_ids)) {
    multiOfferResults = await calculateMultiOfferQuote(supabaseAdmin, {
      tenantId,
      offerIds: body.compare_offer_ids,
      measurements: body.measurements || quoteResult.measurements || {},
      overrides: body.overrides || {},
      choices: body.choices || {}
    });
  }

  // ── Generate requested outputs ──
  const outputs = {};

  if (outputType === 'proposal' || outputType === 'all') {
    outputs.proposal = generateProposal(quoteResult, {
      ...commonOpts,
      preparedBy: body.prepared_by || '',
      date: body.date,
      financingAvailable: body.financing !== false,
      mobilizationSettings: mobilizationRules,
      addOnQuote: body.add_on_quote || null,
      multiOfferResults,
      salesRep: body.sales_rep || null,
      template: body.template || null,
      templateKey: body.template_key || '',
      inlineComparison: body._comparison || null
    });
  }

  if (outputType === 'contract' || outputType === 'all') {
    outputs.contract = generateContract(quoteResult, {
      ...commonOpts,
      date: body.date,
      depositPercent: body.deposit_percent || 33,
      paymentTerms: body.payment_terms || 'net_completion',
      customTerms: body.custom_terms || '',
      validDays: body.valid_days || 30
    });
  }

  if (outputType === 'sales_page' || outputType === 'all') {
    try {
      outputs.salesPage = generateSalesPageData(quoteResult, {
        ...commonOpts,
        aiRenders: body.ai_renders || [],
        testimonials: body.testimonials || [],
        multiOfferResults,
        callToAction: body.cta_label || 'View Your Proposal',
        acceptUrl: body.accept_url || null,
        declineUrl: body.decline_url || null
      });
      // Pass through template, salesperson, and media
      if (body.sales_rep) outputs.salesPage.salesRep = body.sales_rep;
      if (body.template) outputs.salesPage.template = body.template;
      if (body.cover_photo) outputs.salesPage.coverPhoto = body.cover_photo;
      if (body.intro_video) outputs.salesPage.introVideo = body.intro_video;
    } catch (e) {
      if (outputType === 'sales_page') return res.status(500).json({ error: 'Sales page generation failed: ' + e.message, stack: e.stack?.split('\n').slice(0,3) });
      // For 'all', continue without sales page
    }
  }

  // Return single output or all
  if (outputType === 'all') {
    return res.json({ outputs, tenant: req.tenant.slug });
  }

  // Map query type to output key (sales_page → salesPage)
  const typeToKey = { proposal: 'proposal', contract: 'contract', sales_page: 'salesPage' };
  const result = outputs[typeToKey[outputType] || outputType];
  return res.json({ ...(result || {}), tenant: req.tenant.slug });
}

export default requireTenant(handler);
