// Ryujin OS - Materialize a v2 proposal instance (freeze a sent proposal).
//
// Thin HTTP wrapper over lib/proposalMaterialize.js. The freeze logic AND the
// engine-priced crew authority gate live in that shared lib so api/field-proposal.js
// (Diego's on-the-spot close) freezes through the exact same chokepoint - a crew
// member cannot bypass the gate by POSTing here directly.
//
// POST /api/proposal-materialize
//   { estimate, template, status?, productsOverride?, variablesPatch?,
//     sectionsPatch?, slugBase? }
// Returns { slug, shareToken, url }. Each call creates a NEW immutable instance
// (re-materialize = a new slug); the customer is sent /p/<slug>.
//
// Auth: requirePortalSessionAndTenant. The only browser caller
// (admin-proposal-builder.html) sends a Bearer session; chat + cron agents use the
// service token (synthetic admin). Both are non-crew, so the gate is a no-op for
// them - it only constrains a crew session posting here.
import { materializeInstance } from '../lib/proposalMaterialize.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';
import { withSentry } from '../lib/sentry.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise(resolve => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Crew use /api/field-proposal (which enforces the engine-priced gate). They
  // have no legitimate path through this endpoint - reject before any freeze so a
  // crew session cannot craft a draft instance that skips the gate.
  if (req.session?.role === 'crew') {
    return res.status(403).json({ error: 'crew_uses_field_proposal', code: 'FORBIDDEN' });
  }

  const body = await readBody(req);
  const estimateId = String(body.estimate || body.estimateId || req.query.estimate || '').trim();
  const templateInput = body.template ?? body.templateSlug ?? req.query.template ?? '';

  const result = await materializeInstance({
    estimateId,
    templateInput,
    status: body.status,
    actor: req.session,
    productsOverride: body.productsOverride,
    variablesPatch: body.variablesPatch,
    sectionsPatch: body.sectionsPatch,
    slugBase: body.slugBase,
    expectedTenantId: req.tenant?.id || null,
  });

  if (!result.ok) {
    return res.status(result.status || 500).json({
      error: result.error,
      code: result.code,
      reason: result.reason,
      message: result.message,
    });
  }
  return res.json({
    ok: true,
    instanceId: result.instanceId,
    slug: result.slug,
    shareToken: result.shareToken,
    status: result.status,
    url: result.url,
    shareUrl: result.shareUrl,
  });
}

export default withSentry(requirePortalSessionAndTenant(handler));
