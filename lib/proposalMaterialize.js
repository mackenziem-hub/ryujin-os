// Ryujin OS - Materialize a v2 proposal instance (freeze a sent proposal).
// ----------------------------------------------------------------------------
// Extracted from api/proposal-materialize.js so the HTTP endpoint AND the field
// app (api/field-proposal.js) freeze through ONE chokepoint. That is what makes
// the engine-priced authority gate un-bypassable: a crew member cannot freeze a
// non-standard proposal by hitting /api/proposal-materialize directly, because
// the gate lives here, not in the field endpoint.
//
//   materializeInstance({ estimateId, templateInput, status, actor,
//                         productsOverride, variablesPatch, sectionsPatch,
//                         slugBase, expectedTenantId, discount, addons })
//     -> { ok:true, instanceId, slug, shareToken, status, url, shareUrl }
//     -> { ok:false, status, error, code?, reason? }   (never throws on a handled gate)
//
// actor = { role, userId }. Only role 'crew' is gated. owner/admin/sales/service
// freeze anything (the existing proposal-builder + chat workflows are unchanged).
// ----------------------------------------------------------------------------
import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from './supabase.js';
import { assembleProposalData } from '../api/proposal-v2.js';

function kebab(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'proposal';
}

// ── isStandardEngineClose ────────────────────────────────────────────────────
// A crew member (Diego) may freeze + close on the spot ONLY a standard engine-
// priced asphalt good/better/best proposal. Anything with a manual price override,
// a discount, add-ons, a non-asphalt system, or a roof the satellite auto-measure
// can't be trusted on (complex, or any hips - satellite under-measures hip roofs,
// EagleView is the arbiter) routes to Mac for approval instead.
//
//   isStandardEngineClose(est, ctx, args) -> { standard:boolean, reason:string }
//
// ctx = { products, template } from the assembled ProposalData.
export function isStandardEngineClose(est, ctx = {}, args = {}) {
  const reasons = [];
  const products = ctx.products || {};
  const template = ctx.template || {};
  const tmplSlug = String(template.slug || '').toLowerCase();

  // 1. Standard asphalt good/better/best only.
  if (products.mode && products.mode !== 'good_better_best') reasons.push(`mode=${products.mode}`);
  const sys = String(products?.scope?.system || est?.proposal_mode || '').toLowerCase();
  if (sys && !/asphalt|shingle|roof only/.test(sys)) reasons.push(`system=${sys}`);
  if (tmplSlug && tmplSlug !== 'asphalt-good-better-best') reasons.push(`template=${tmplSlug}`);

  // 2. A real engine tier is selected with a positive (pre-tax) price.
  const sel = String(est?.selected_package || '').toLowerCase();
  if (!['gold', 'platinum', 'diamond'].includes(sel)) reasons.push(`tier=${sel || 'none'}`);
  const pkg = est?.calculated_packages?.[sel];
  const price = Number(pkg?.total ?? pkg?.summary?.sellingPrice ?? 0);
  if (!(price > 0)) reasons.push('no engine price');

  // 3. No manual price override / discount / add-ons. The _envelope catalog
  //    scaffold that estimates.js auto-adds to custom_prices is NOT an override.
  const cp = est?.custom_prices || {};
  if (typeof cp[sel] === 'number' && cp[sel] > 0) reasons.push('custom tier price');
  if (Array.isArray(cp._addons) && cp._addons.length) reasons.push('add-ons');
  if (pkg && pkg.customPrice === true) reasons.push('customPrice flag');
  if (Number(args.discount) > 0) reasons.push('discount');
  if (Array.isArray(args.addons) && args.addons.length) reasons.push('addons');

  // 4. No hand-shaping passed into the freeze.
  if (args.productsOverride && Object.keys(args.productsOverride).length) reasons.push('productsOverride');
  if (Array.isArray(args.sectionsPatch) && args.sectionsPatch.length) reasons.push('sectionsPatch');
  if (args.variablesPatch && (args.variablesPatch.discount || args.variablesPatch.bundleSavings)) reasons.push('discount variable');

  // 5. Measurement confidence (Mac decision, Jun 26). Crew self-report the
  //    measurements with no satellite cross-check, and satellite/eyeball
  //    under-measures cut-up roofs, so ONLY a roof explicitly marked 'simple'
  //    closes on the spot; medium/complex or any hips route to Mac to verify
  //    (EagleView). Mac can relax this to allow 'medium' once he trusts the flow.
  if (String(est?.complexity || '').toLowerCase() !== 'simple') reasons.push('roof not marked simple - verify first');
  if ((Number(est?.hips_lf) || 0) > 0) reasons.push('hip roof - EagleView first');

  return { standard: reasons.length === 0, reason: reasons.join('; ') };
}

export async function materializeInstance(opts = {}) {
  const {
    estimateId,
    templateInput,
    status: statusInput = 'sent',
    actor = null,
    productsOverride = null,
    variablesPatch = null,
    sectionsPatch = null,
    slugBase = null,
    expectedTenantId = null,
    discount = null,
    addons = null,
  } = opts;

  const status = ['sent', 'draft'].includes(String(statusInput || '').trim())
    ? String(statusInput).trim()
    : 'sent';

  const hasTemplate = (typeof templateInput === 'object' && templateInput)
    ? Array.isArray(templateInput.sections)
    : !!String(templateInput || '').trim();
  if (!estimateId || !hasTemplate) {
    return { ok: false, status: 400, error: 'Need { estimate, template }' };
  }

  const r = await assembleProposalData(estimateId, templateInput, expectedTenantId);
  if (!r.ok) return { ok: false, status: r.status || 500, error: r.error };

  const { data, est, template, tenantId } = r;
  if (expectedTenantId && tenantId && expectedTenantId !== tenantId) {
    return { ok: false, status: 403, error: 'Estimate belongs to a different tenant' };
  }

  // ── Engine-priced authority gate. A crew member can only freeze a STANDARD
  //    proposal (gated for ANY status - a 'draft' instance is still publicly
  //    renderable + acceptable, so the gate must not be status-scoped).
  //    owner/admin/sales/service bypass entirely (admin builder + chat unchanged).
  if (actor && actor.role === 'crew') {
    const gate = isStandardEngineClose(est, { products: data.products, template },
      { productsOverride, variablesPatch, sectionsPatch, discount, addons });
    if (!gate.standard) {
      return {
        ok: false,
        status: 403,
        code: 'NON_STANDARD_REQUIRES_APPROVAL',
        error: 'Non-standard proposal requires owner approval',
        reason: gate.reason,
      };
    }
  }

  // Integrity warning: template asked for sections but none resolved (would freeze
  // a price-only proposal). renderInstance auto-heals on view but a clean send
  // should never freeze empty.
  if (Array.isArray(template?.sections) && template.sections.length
      && Array.isArray(data.sections) && !data.sections.length) {
    console.error('[proposalMaterialize] freezing EMPTY sections for estimate',
      estimateId, 'template', template.slug, '- check proposal_blocks seed for tenant', tenantId);
  }

  // Explicit shaping (objects only; anything else ignored).
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(productsOverride)) data.products = { ...(data.products || {}), ...productsOverride };
  if (isObj(variablesPatch)) data.variables = { ...(data.variables || {}), ...variablesPatch };
  if (Array.isArray(sectionsPatch) && Array.isArray(data.sections)) {
    for (const patch of sectionsPatch) {
      if (!patch || typeof patch.type !== 'string' || !isObj(patch.content)) continue;
      const i = data.sections.findIndex(s => s && s.type === patch.type);
      if (i >= 0) data.sections[i] = { type: patch.type, content: patch.content };
    }
  }

  const shareToken = randomBytes(12).toString('hex');
  const base = kebab(
    (typeof slugBase === 'string' && slugBase.trim())
      ? slugBase
      : (est.customer?.address || data.customer?.address || data.customer?.name || template?.slug)
  );
  const slug = `${base}-${shareToken.slice(0, 6)}`;

  data.meta.instanceSlug = slug;
  data.meta.status = status;

  const now = new Date().toISOString();
  const row = {
    tenant_id: tenantId,
    slug,
    share_token: shareToken,
    estimate_id: estimateId,
    template_id: template.id || null,
    customer_id: est.customer?.id || null,
    ghl_contact_id: est.ghl_contact_id || est.customer?.ghl_contact_id || null,
    sections: data.sections,
    product_selection: { mode: data.products?.mode, recommended: data.products?.recommended },
    variables: data.variables,
    pricing_snapshot: data.products,
    data_snapshot: data,
    renderer_version: 'v2',
    status,
    sent_at: status === 'sent' ? now : null,
    locked_at: now,
  };

  const { data: inserted, error } = await supabaseAdmin
    .from('proposal_instances')
    .insert(row)
    .select('id, slug, share_token, status')
    .single();
  if (error) return { ok: false, status: 500, error: 'Materialize failed', message: error.message };

  return {
    ok: true,
    instanceId: inserted.id,
    slug: inserted.slug,
    shareToken: inserted.share_token,
    status: inserted.status,
    url: `/p/${inserted.slug}`,
    shareUrl: `/p/${inserted.slug}`,
  };
}
