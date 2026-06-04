// Ryujin OS - Materialize a v2 proposal instance (freeze a sent proposal).
//
// POST /api/proposal-materialize  { estimate, template, status? }
//
// Assembles the full ProposalData from an estimate + template (the SAME shared
// assembler the live preview uses) and persists it as a FROZEN proposal_instances
// snapshot (data_snapshot). Returns { slug, shareToken, url }.
//
// Each call creates a NEW immutable instance (re-materialize = a new version with
// a new slug). The customer is sent /p/<slug>; api/proposal-v2.js serves the
// stored snapshot verbatim, so the proposal never changes after it is sent.
import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { assembleProposalData } from './proposal-v2.js';

function kebab(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'proposal';
}

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await readBody(req);
  const estimateId = String(body.estimate || body.estimateId || req.query.estimate || '').trim();
  const templateSlug = String(body.template || body.templateSlug || req.query.template || '').trim();
  // 'sent' freezes it as the live version (legacy links route to it). 'draft'
  // creates the snapshot without making it the routed default.
  const status = ['sent', 'draft'].includes(String(body.status || '').trim())
    ? String(body.status).trim()
    : 'sent';

  if (!estimateId || !templateSlug) {
    return res.status(400).json({ error: 'Need { estimate, template }' });
  }

  try {
    const r = await assembleProposalData(estimateId, templateSlug);
    if (!r.ok) return res.status(r.status || 500).json({ error: r.error });

    const { data, est, template, tenantId } = r;

    const shareToken = randomBytes(12).toString('hex');
    const base = kebab(est.customer?.address || data.customer?.address || data.customer?.name || templateSlug);
    const slug = `${base}-${shareToken.slice(0, 6)}`;

    // Bake the resolved slug + status into the frozen snapshot's meta.
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
      locked_at: now
    };

    const { data: inserted, error } = await supabaseAdmin
      .from('proposal_instances')
      .insert(row)
      .select('id, slug, share_token, status')
      .single();
    if (error) return res.status(500).json({ error: 'Materialize failed', message: error.message });

    return res.json({
      ok: true,
      instanceId: inserted.id,
      slug: inserted.slug,
      shareToken: inserted.share_token,
      status: inserted.status,
      url: `/p/${inserted.slug}`,
      shareUrl: `/p/${inserted.slug}`
    });
  } catch (e) {
    console.error('[proposal-materialize] error:', e?.message, e?.stack);
    return res.status(500).json({ error: 'Materialize failed', message: String(e?.message || e) });
  }
}
