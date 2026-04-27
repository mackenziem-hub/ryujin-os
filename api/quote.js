// Ryujin OS — Quote Engine API v3.1
// POST /api/quote                 — Calculate quote (single offer)
// POST /api/quote?mode=compare    — Calculate multiple offers for comparison
// POST /api/quote?mode=guided     — Guided mode: answers → auto-fill → quote
// POST /api/quote?mode=v2         — Legacy v2 engine (backward compat)
// POST /api/quote?save=1          — Calculate + persist line items to DB
// GET  /api/quote?offers=1        — List available offers for tenant
// GET  /api/quote?questions=1&system=X — Get guided mode questions
// POST /api/quote?mobilization=1  — Calculate mobilization discount for add-on
import { calculateAsphaltQuote, calculateMetalQuote, calculateExteriorQuote, calculateCombinedQuote } from '../lib/quoteEngine.js';
import {
  calculateQuoteV3, calculateMultiOfferQuote, persistLineItems,
  generateMaterialList, getGuidedQuestions, processGuidedAnswers,
  calculateMobilizationDiscount
} from '../lib/quoteEngineV3.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  // ── GET: List offers ──
  if (req.method === 'GET' && req.query.offers === '1') {
    const { data, error } = await supabaseAdmin
      .from('offers')
      .select('id, name, slug, description, system, badge, warranty_years, pricing_method, sort_order, is_default')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('sort_order');

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ offers: data });
  }

  // ── GET: Guided mode questions ──
  if (req.method === 'GET' && req.query.questions === '1') {
    const system = req.query.system || 'residential';
    return res.json({
      system,
      questions: getGuidedQuestions(system),
      availableSystems: ['residential', 'metal', 'flat', 'exterior', 'combined']
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST or GET only' });

  const body = req.body || {};

  // ── Legacy v2 ──
  if (req.query.mode === 'v2') {
    const { system = 'asphalt', ...spec } = body;
    let result;
    switch (system) {
      case 'asphalt': result = calculateAsphaltQuote(spec); break;
      case 'metal': result = calculateMetalQuote(spec); break;
      case 'exterior': result = calculateExteriorQuote(spec); break;
      case 'combined': result = calculateCombinedQuote(spec); break;
      default: return res.status(400).json({ error: `Unknown system: ${system}` });
    }
    if (result.error) return res.status(400).json(result);
    result.tenant = req.tenant.slug;
    return res.json(result);
  }

  // ── Mobilization discount ──
  if (req.query.mobilization === '1') {
    const { base_job_price, add_on_price } = body;
    if (!base_job_price || !add_on_price) {
      return res.status(400).json({ error: 'Provide base_job_price and add_on_price' });
    }
    const { data: settings } = await supabaseAdmin
      .from('tenant_settings').select('mobilization_rules').eq('tenant_id', tenantId).single();

    const mobilization = settings?.mobilization_rules || null;
    const settingsObj = { mobilization };
    const result = calculateMobilizationDiscount(base_job_price, add_on_price, settingsObj);
    return res.json(result);
  }

  // ── Guided mode ──
  if (req.query.mode === 'guided') {
    const { answers, system, offer_id, offer_slug, estimate_id, extras } = body;

    if (!answers) return res.status(400).json({ error: 'Provide answers object from guided questions' });

    const { measurements, choices, address } = processGuidedAnswers(answers, system || 'residential');

    // Find offer
    let offerId = offer_id;
    if (!offerId && offer_slug) {
      const { data: offer } = await supabaseAdmin
        .from('offers').select('id').eq('tenant_id', tenantId).eq('slug', offer_slug).single();
      if (!offer) return res.status(404).json({ error: `Offer "${offer_slug}" not found` });
      offerId = offer.id;
    }

    // If no offer specified, use default for the system
    if (!offerId) {
      const systemMap = {
        residential: 'asphalt', asphalt: 'asphalt',
        metal: 'metal', flat: 'asphalt',
        exterior: 'exterior', performance_shell: 'exterior', custom: 'exterior',
        combined: 'combined'
      };
      const offerSystem = systemMap[system] || 'asphalt';

      const { data: defaultOffer } = await supabaseAdmin
        .from('offers').select('id')
        .eq('tenant_id', tenantId).eq('system', offerSystem).eq('is_default', true)
        .single();

      if (defaultOffer) {
        offerId = defaultOffer.id;
      } else {
        // Fall back to first active offer for this system
        const { data: firstOffer } = await supabaseAdmin
          .from('offers').select('id')
          .eq('tenant_id', tenantId).eq('system', offerSystem).eq('active', true)
          .order('sort_order').limit(1).single();

        if (!firstOffer) return res.status(404).json({ error: `No active ${offerSystem} offers found` });
        offerId = firstOffer.id;
      }
    }

    const result = await calculateQuoteV3(supabaseAdmin, {
      tenantId, offerId, measurements, overrides: {}, choices, extras: extras || [], mode: 'guided'
    });

    if (result.error) return res.status(400).json(result);

    if (address) result.address = address;

    // Save if requested
    if (req.query.save === '1' && estimate_id) {
      result.persistence = await persistLineItems(supabaseAdmin, {
        estimateId: estimate_id, tenantId, offerId, lineItems: result.lineItems
      });
    }

    if (req.query.materials === '1') {
      result.materialList = generateMaterialList(result);
    }

    result.tenant = req.tenant.slug;
    return res.json(result);
  }

  // ── Multi-offer comparison ──
  if (req.query.mode === 'compare') {
    const { offer_ids, measurements, overrides, choices, extras } = body;

    let ids = offer_ids;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      const { data: allOffers } = await supabaseAdmin
        .from('offers').select('id')
        .eq('tenant_id', tenantId).eq('active', true).order('sort_order');
      ids = (allOffers || []).map(o => o.id);
    }

    const result = await calculateMultiOfferQuote(supabaseAdmin, {
      tenantId, offerIds: ids,
      measurements: measurements || {},
      overrides: overrides || {},
      choices: choices || {},
      extras: extras || []
    });

    result.tenant = req.tenant.slug;
    return res.json(result);
  }

  // ── Single offer quote (v3 advanced/override) ──
  const { offer_id, offer_slug, measurements, overrides, choices, extras, mode, estimate_id } = body;

  let offerId = offer_id;
  if (!offerId && offer_slug) {
    const { data: offer } = await supabaseAdmin
      .from('offers').select('id').eq('tenant_id', tenantId).eq('slug', offer_slug).single();
    if (!offer) return res.status(404).json({ error: `Offer "${offer_slug}" not found` });
    offerId = offer.id;
  }

  if (!offerId) {
    return res.status(400).json({
      error: 'Provide offer_id, offer_slug, or use ?mode=compare|guided.',
      hint: 'GET /api/quote?offers=1 to list offers. GET /api/quote?questions=1&system=residential for guided mode.'
    });
  }

  const result = await calculateQuoteV3(supabaseAdmin, {
    tenantId, offerId,
    measurements: measurements || {},
    overrides: overrides || {},
    choices: choices || {},
    extras: extras || [],
    mode: mode || 'advanced'
  });

  if (result.error) return res.status(400).json(result);

  if (req.query.save === '1' && estimate_id) {
    result.persistence = await persistLineItems(supabaseAdmin, {
      estimateId: estimate_id, tenantId, offerId, lineItems: result.lineItems
    });
  }

  if (req.query.materials === '1') {
    result.materialList = generateMaterialList(result);
  }

  result.tenant = req.tenant.slug;
  return res.json(result);
}

export default requireTenant(handler);
