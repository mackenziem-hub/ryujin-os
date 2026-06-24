// Ryujin OS - Generator Scheduler API
//
// Operator surface for the weekly Generator drafts. Backed by the same
// marketing_clips lifecycle that powers manual video uploads, filtered to
// rows where source_kind='generator'. Publish model (v2): approve flips the
// clip awaiting_approval → ready ("Ready for Cat to schedule"). The old
// marketing-publish?next=1 auto-fanout cron is DISABLED on purpose — Mac
// approves, Cat schedules by hand (no surprise auto-posts). A manual GHL
// schedule action is a later phase.
//
// Endpoints:
//   GET  /api/generator?view=queue          - drafts + scheduled + posted (7d)
//   GET  /api/generator?id=X                - single draft detail
//   PUT  /api/generator                     - { id, action: 'approve'|'edit'|'reschedule', caption?, scheduled_at? }
//   DELETE /api/generator?id=X              - reject draft, free media_pool items
//   POST /api/generator?action=regenerate   - { id }, re-draft caption via Claude
//   POST /api/generator?action=run          - manual fire of the weekly generator
//   POST /api/generator?action=platform_captions - { id, platforms? }, per-platform
//                                             caption variants for Cat to copy/schedule
//   POST /api/generator?action=ingest        - { url, title?, caption?, mime?, is_photo?,
//                                             scheduled_at?, target_platforms? } operator-seeds
//                                             an awaiting_approval draft from a hosted asset
//                                             (e.g. the pre-rendered video shorts). DRAFT only.
//
// Auth: requirePortalSessionAndTenant. Approve and run require isPrivileged
// (owner/admin) so both Mac and Cat can use them.
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant, isPrivileged } from '../lib/portalAuth.js';
import { sanitizeCaption } from '../lib/captionPrivacy.js';
import { generatePlatformCaptions } from '../lib/captionGenerator.js';

const BRAND_SLUG = 'plus_ultra';
const POSTED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

async function getPlusUltraBrandId(tenantId) {
  const { data, error } = await supabaseAdmin
    .from('brands').select('id, name, voice, cta, website')
    .eq('tenant_id', tenantId).eq('slug', BRAND_SLUG).maybeSingle();
  if (error || !data) return null;
  return data;
}

function shapeClip(row) {
  if (!row) return row;
  const overrides = row.caption_overrides && typeof row.caption_overrides === 'object'
    ? row.caption_overrides : {};
  const approved = Object.keys(overrides).length > 0;
  return {
    id: row.id,
    status: row.status,
    source_kind: row.source_kind,
    title: row.title,
    rendered_url: row.rendered_url,
    thumbnail_url: row.thumbnail_url,
    scheduled_at: row.scheduled_at,
    posted_at: row.posted_at,
    target_platforms: row.target_platforms || [],
    caption_suggestion: row.caption_suggestion,
    caption_approved: approved,
    caption_final: approved ? Object.values(overrides)[0] : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function loadQueue(tenantId) {
  const since = new Date(Date.now() - POSTED_WINDOW_MS).toISOString();

  const [draftsRes, approvedRes, scheduledRes, postedRes] = await Promise.all([
    supabaseAdmin
      .from('marketing_clips')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('source_kind', 'generator')
      .eq('status', 'awaiting_approval')
      .order('scheduled_at', { ascending: true })
      .limit(20),
    supabaseAdmin
      .from('marketing_clips')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('source_kind', 'generator')
      .eq('status', 'ready')
      .order('scheduled_at', { ascending: true })
      .limit(20),
    supabaseAdmin
      .from('marketing_clips')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('source_kind', 'generator')
      .eq('status', 'scheduled')
      .order('scheduled_at', { ascending: true })
      .limit(20),
    supabaseAdmin
      .from('marketing_clips')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('source_kind', 'generator')
      .eq('status', 'posted')
      .gte('posted_at', since)
      .order('posted_at', { ascending: false })
      .limit(20),
  ]);

  // Pull associated scheduled_posts for the scheduled + posted lists so the
  // UI can show "Posted to Facebook + Google" or "Failed on Facebook" badges.
  const scheduledIds = [...(scheduledRes.data || []), ...(postedRes.data || [])].map(c => c.id);
  let postsByClip = new Map();
  if (scheduledIds.length) {
    const { data: posts } = await supabaseAdmin
      .from('scheduled_posts')
      .select('clip_id, platform, status, posted_at, error_msg')
      .in('clip_id', scheduledIds);
    for (const p of (posts || [])) {
      if (!postsByClip.has(p.clip_id)) postsByClip.set(p.clip_id, []);
      postsByClip.get(p.clip_id).push(p);
    }
  }

  // Drafts: awaiting_approval status, sweep ignores these.
  // Approved-pending: status='ready' with caption_overrides populated; the
  // marketing-publish sweep picks them up within 10 min.
  const drafts = (draftsRes.data || []).map(shapeClip);
  const approvedNotYetSent = (approvedRes.data || []).map(shapeClip);

  const scheduled = (scheduledRes.data || []).map(c => ({
    ...shapeClip(c),
    fanout: postsByClip.get(c.id) || [],
  }));

  const approvedWithFanout = approvedNotYetSent.map(c => ({
    ...c,
    fanout: postsByClip.get(c.id) || [],
  }));

  const posted = (postedRes.data || []).map(c => ({
    ...shapeClip(c),
    fanout: postsByClip.get(c.id) || [],
  }));

  return {
    counts: {
      drafts: drafts.length,
      approved_pending: approvedWithFanout.length,
      scheduled: scheduled.length,
      posted_last_7d: posted.length,
    },
    drafts,
    approved_pending: approvedWithFanout,
    scheduled,
    posted,
  };
}

async function loadSingle(tenantId, id) {
  const { data, error } = await supabaseAdmin
    .from('marketing_clips')
    .select('*')
    .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error || !data) return null;
  if (data.source_kind !== 'generator') return null;
  return shapeClip(data);
}

async function approveClip({ tenantId, clipId, captionFinal, brand }) {
  if (!brand) return { error: 'Plus Ultra brand not found for this tenant', status: 500 };
  // Hard privacy backstop: this is the text that actually publishes, so strip
  // any street address before it leaves the building (the prompt is not enough).
  const safeCaption = sanitizeCaption(captionFinal);
  if (!safeCaption) return { error: 'Caption is empty after privacy sanitize', status: 400 };
  const overrides = { [brand.id]: safeCaption };
  // Flip awaiting_approval → ready AND populate caption_overrides in one
  // statement so the next publish sweep immediately picks it up. Mutation
  // scoped to source_kind='generator' to prevent cross-clip writes via
  // this endpoint (codex P2).
  const { data, error } = await supabaseAdmin
    .from('marketing_clips')
    .update({
      caption_overrides: overrides,
      status: 'ready',
      updated_at: new Date().toISOString(),
    })
    .eq('id', clipId)
    .eq('tenant_id', tenantId)
    .eq('source_kind', 'generator')
    .select('*').single();
  if (error) return { error: error.message, status: 500 };
  return { clip: data };
}

async function editClip({ tenantId, clipId, captionSuggestion, scheduledAt }) {
  const updates = { updated_at: new Date().toISOString() };
  if (captionSuggestion !== undefined) updates.caption_suggestion = String(captionSuggestion).slice(0, 2000);
  if (scheduledAt !== undefined) updates.scheduled_at = new Date(scheduledAt).toISOString();
  // source_kind filter prevents cross-clip writes (codex P2).
  const { data, error } = await supabaseAdmin
    .from('marketing_clips')
    .update(updates)
    .eq('id', clipId)
    .eq('tenant_id', tenantId)
    .eq('source_kind', 'generator')
    .select('*').single();
  if (error) return { error: error.message, status: 500 };
  return { clip: data };
}

// reject deletes the draft. By default its source photos are freed back to the
// pool (used_in_clip_id cleared) so they can be re-picked. With exclude=true
// the photos are instead marked excluded, use this when the photo was already
// posted (e.g. manually to Facebook) so the generator never resurfaces it.
async function rejectClip({ tenantId, clipId, exclude = false }) {
  // Confirm the target is a generator-sourced clip BEFORE deleting so
  // /api/generator?id=X can't be used to wipe out an upload-sourced clip
  // owned by the same tenant (codex P2).
  const { data: target, error: tErr } = await supabaseAdmin
    .from('marketing_clips')
    .select('id, source_kind')
    .eq('id', clipId)
    .eq('tenant_id', tenantId)
    .eq('source_kind', 'generator')
    .maybeSingle();
  if (tErr) return { error: tErr.message, status: 500 };
  if (!target) return { error: 'Generator draft not found', status: 404 };

  const { data: sources } = await supabaseAdmin
    .from('clip_media_sources').select('media_id').eq('clip_id', clipId);
  const mediaIds = (sources || []).map(s => s.media_id);

  const { error } = await supabaseAdmin
    .from('marketing_clips')
    .delete()
    .eq('id', clipId)
    .eq('tenant_id', tenantId)
    .eq('source_kind', 'generator');
  if (error) return { error: error.message, status: 500 };

  if (mediaIds.length) {
    const update = exclude
      ? { used_in_clip_id: null, last_used_at: null, excluded: true, excluded_reason: 'posted_elsewhere' }
      : { used_in_clip_id: null, last_used_at: null };
    await supabaseAdmin.from('media_pool').update(update).in('id', mediaIds);
  }
  return { deleted: clipId, freed_media: exclude ? 0 : mediaIds.length, excluded_media: exclude ? mediaIds.length : 0 };
}

async function regenerateCaption({ tenantId, clipId, brand }) {
  const { data: clip, error } = await supabaseAdmin
    .from('marketing_clips').select('*')
    .eq('id', clipId).eq('tenant_id', tenantId).eq('source_kind', 'generator').single();
  if (error || !clip) return { error: 'Generator draft not found', status: 404 };

  const { data: sources } = await supabaseAdmin
    .from('clip_media_sources')
    .select('role, media:media_pool(id, address_city, customer_name, package_tier)')
    .eq('clip_id', clipId);
  const flat = (sources || []).map(s => ({ role: s.role, ...(s.media || {}) }));
  const after = flat.find(s => s.role === 'after') || flat.find(s => s.role === 'hero') || flat[0] || {};
  const kind = flat.some(s => s.role === 'before') ? 'pair' : 'single';

  const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!ANTHROPIC_KEY) {
    return { error: 'ANTHROPIC_API_KEY missing, cannot regenerate', status: 503 };
  }

  // PRIVACY: same constraint as the agent. customer_name + project name are
  // often street addresses in this codebase; never expose to the caption LLM.
  const ctx = [
    `Source: ${kind === 'pair' ? 'before/after photo pair' : 'single roofing photo'}`,
    after.address_city ? `Location: ${after.address_city}, NB` : 'Location: greater Moncton area',
    after.package_tier ? `System: ${after.package_tier}` : null,
  ].filter(Boolean).join('\n');

  const prompt = `Write ONE Facebook social media caption for Plus Ultra Roofing.

## Brand
${brand.name}
Voice: ${brand.voice}
Default CTA: ${brand.cta || 'Get your free roof inspection'}
Website: ${brand.website || 'plusultraroofing.com'}

## Post context
${ctx}

## Previous draft (avoid repeating tone or wording)
${clip.caption_suggestion || '(none)'}

## Rules
- 2 to 4 sentences. Sweet spot 200-400 chars.
- Open with a clear, specific hook tied to the work.
- ${kind === 'pair' ? 'Frame the transformation honestly.' : 'Show pride in the craft without exaggeration.'}
- End with the brand CTA or a soft invitation to book a free inspection.
- 0 to 3 hashtags at the end if they help.
- NEVER mention street addresses, house numbers, or specific street names. City and province only.
- NEVER mention customer names. Generic references only ("a Riverview homeowner", "this home").
- NO em dashes. NO "just". NO negations. NO sci-fi tone.
- Plain English. Family-roofing voice.

## Output
Return ONLY the new caption. No quotes, no preamble.`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    clearTimeout(timer);
    if (!r.ok) {
      const errText = await r.text();
      return { error: `Claude ${r.status}: ${errText.slice(0, 200)}`, status: 502 };
    }
    const data = await r.json();
    let text = (data?.content?.[0]?.text || '').trim().replace(/^["']|["']$/g, '');
    if (!text) return { error: 'Claude returned empty caption', status: 502 };
    // captionPrivacy strips street addresses + em dashes + tidies spacing.
    text = sanitizeCaption(text);
    if (!text) return { error: 'Caption empty after privacy sanitize', status: 502 };

    const { data: updated, error: upErr } = await supabaseAdmin
      .from('marketing_clips')
      .update({ caption_suggestion: text, updated_at: new Date().toISOString() })
      .eq('id', clipId).eq('tenant_id', tenantId).eq('source_kind', 'generator')
      .select('*').single();
    if (upErr) return { error: upErr.message, status: 500 };
    return { clip: updated };
  } catch (e) {
    return { error: e.message, status: 500 };
  }
}

// Per-platform caption variants for Cat's scheduling workspace. Seeds the
// generatePlatformCaptions LLM with the post's approved (or suggested) caption
// as the "transcript", then runs every variant back through the privacy
// backstop. Read-only on the clip — just returns the variants for copy/paste.
async function platformCaptionsForClip({ tenantId, clipId, brand, platforms }) {
  const { data: clip } = await supabaseAdmin
    .from('marketing_clips').select('caption_overrides, caption_suggestion')
    .eq('id', clipId).eq('tenant_id', tenantId).eq('source_kind', 'generator').maybeSingle();
  if (!clip) return { error: 'Generator post not found', status: 404 };
  const overrides = clip.caption_overrides && typeof clip.caption_overrides === 'object' ? clip.caption_overrides : {};
  const base = (Object.values(overrides)[0] || clip.caption_suggestion || '').trim();
  if (!base) return { error: 'No caption to adapt yet, approve or write one first', status: 400 };

  let captions;
  try {
    captions = await generatePlatformCaptions({ transcript: base, brand, platforms });
  } catch (e) {
    return { error: e.message, status: 502 };
  }
  for (const k of Object.keys(captions)) {
    if (captions[k] && captions[k].caption) captions[k].caption = sanitizeCaption(captions[k].caption);
  }
  return { captions };
}

// Operator-seeded clip from an already-hosted asset (e.g. the pre-rendered
// video shorts pushed to Blob). Lands as an awaiting_approval generator draft
// so it flows through the same preview -> approve -> Ready-for-Cat path as the
// auto-drafted photo posts. Nothing publishes: this only creates a draft.
async function ingestClip({ tenantId, brand, url, title, caption, mime, isPhoto, scheduledAt, targetPlatforms }) {
  if (!url || !/^https:\/\//i.test(String(url))) return { error: 'A https asset url is required', status: 400 };
  const safeCaption = sanitizeCaption(caption == null ? '' : String(caption));
  const mimeType = mime ? String(mime) : 'video/mp4';
  const ext = (String(url).split('?')[0].match(/\.([a-z0-9]+)$/i) || [, 'mp4'])[1];
  // Guard a bad scheduled_at so it returns JSON 400, not a RangeError 500.
  const sched = scheduledAt ? new Date(scheduledAt) : null;
  if (scheduledAt && isNaN(sched)) return { error: 'Invalid scheduled_at', status: 400 };
  const clipRow = {
    tenant_id: tenantId,
    source_url: url,
    source_filename: `ingest-${Date.now()}.${ext}`,
    source_mime_type: mimeType,
    rendered_url: url,
    thumbnail_url: url,
    title: String(title || 'Video post').slice(0, 200),
    description: safeCaption.slice(0, 300),
    target_platforms: Array.isArray(targetPlatforms) && targetPlatforms.length ? targetPlatforms : ['facebook', 'instagram'],
    scheduled_at: sched ? sched.toISOString() : null,
    is_photo: isPhoto === true,
    status: 'awaiting_approval',
    source_kind: 'generator',
    generator_run_id: null,
    caption_suggestion: safeCaption,
    caption_overrides: {},
  };
  const { data: clip, error } = await supabaseAdmin
    .from('marketing_clips').insert(clipRow).select('*').single();
  if (error) return { error: `clip insert: ${error.message}`, status: 500 };
  // Brand link mirrors the weekly agent. Non-fatal if it fails: the draft
  // still lists + approves (approve writes caption_overrides keyed by brand).
  if (brand) {
    await supabaseAdmin.from('marketing_clip_brands')
      .insert({ clip_id: clip.id, brand_id: brand.id }).then(() => {}, () => {});
  }
  return { clip };
}

async function runWeeklyGenerator({ req }) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `https://${req.headers.host || 'ryujin-os.vercel.app'}`;
  const internalKey = (process.env.INTERNAL_RENDER_KEY || '').trim();
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const headers = { 'Content-Type': 'application/json' };
  if (internalKey) headers['x-internal-key'] = internalKey;
  else if (cronSecret) headers['Authorization'] = `Bearer ${cronSecret}`;

  try {
    const r = await fetch(`${baseUrl}/api/agents/generator?manual=1`, { method: 'POST', headers });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    if (!r.ok) return { error: body?.error || `agent returned ${r.status}`, status: 502 };
    return { result: body };
  } catch (e) {
    return { error: e.message, status: 500 };
  }
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;
  const session = req.session;

  if (req.method === 'GET') {
    const { id, view } = req.query;
    if (id) {
      const clip = await loadSingle(tenantId, id);
      if (!clip) return res.status(404).json({ error: 'Draft not found' });
      return res.json(clip);
    }
    if (view === 'queue' || !view) {
      const queue = await loadQueue(tenantId);
      return res.json(queue);
    }
    return res.status(400).json({ error: 'Unknown view' });
  }

  if (req.method === 'PUT') {
    const { id, action, caption, scheduled_at } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    if (action === 'approve') {
      if (!isPrivileged(session)) return res.status(403).json({ error: 'Owner or admin required to approve' });
      const brand = await getPlusUltraBrandId(tenantId);
      if (!brand) return res.status(500).json({ error: 'Plus Ultra brand row missing for this tenant' });
      const finalText = (caption && String(caption).trim()) || null;
      if (!finalText) {
        const { data: existing } = await supabaseAdmin
          .from('marketing_clips').select('caption_suggestion')
          .eq('id', id).eq('tenant_id', tenantId).eq('source_kind', 'generator').maybeSingle();
        if (!existing?.caption_suggestion) return res.status(400).json({ error: 'No caption to approve' });
        const out = await approveClip({ tenantId, clipId: id, captionFinal: existing.caption_suggestion, brand });
        if (out.error) return res.status(out.status || 500).json({ error: out.error });
        return res.json({ approved: true, clip: shapeClip(out.clip) });
      }
      const out = await approveClip({ tenantId, clipId: id, captionFinal: finalText, brand });
      if (out.error) return res.status(out.status || 500).json({ error: out.error });
      return res.json({ approved: true, clip: shapeClip(out.clip) });
    }

    if (action === 'edit' || action === 'reschedule' || !action) {
      const out = await editClip({
        tenantId, clipId: id,
        captionSuggestion: caption,
        scheduledAt: scheduled_at,
      });
      if (out.error) return res.status(out.status || 500).json({ error: out.error });
      return res.json({ updated: true, clip: shapeClip(out.clip) });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  if (req.method === 'DELETE') {
    const { id, exclude } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });
    const wantExclude = exclude === '1';
    // Permanent exclusion removes inventory from all future runs, so it is
    // owner/admin-only like approve/run. A plain reject (frees the photo for a
    // later run) stays open to any authenticated portal user.
    if (wantExclude && !isPrivileged(session)) {
      return res.status(403).json({ error: 'Owner or admin required to exclude media' });
    }
    const out = await rejectClip({ tenantId, clipId: id, exclude: wantExclude });
    if (out.error) return res.status(out.status || 500).json({ error: out.error });
    return res.json({ rejected: true, ...out });
  }

  if (req.method === 'POST') {
    const { action } = req.query;
    if (action === 'regenerate') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const brand = await getPlusUltraBrandId(tenantId);
      if (!brand) return res.status(500).json({ error: 'Plus Ultra brand row missing for this tenant' });
      const out = await regenerateCaption({ tenantId, clipId: id, brand });
      if (out.error) return res.status(out.status || 500).json({ error: out.error });
      return res.json({ regenerated: true, clip: shapeClip(out.clip) });
    }
    if (action === 'run') {
      if (!isPrivileged(session)) return res.status(403).json({ error: 'Owner or admin required to fire generator' });
      const out = await runWeeklyGenerator({ req });
      if (out.error) return res.status(out.status || 500).json({ error: out.error });
      return res.json({ fired: true, ...out });
    }
    if (action === 'platform_captions') {
      const { id, platforms } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const brand = await getPlusUltraBrandId(tenantId);
      if (!brand) return res.status(500).json({ error: 'Plus Ultra brand row missing for this tenant' });
      const list = Array.isArray(platforms) && platforms.length ? platforms : ['facebook', 'instagram', 'google'];
      const out = await platformCaptionsForClip({ tenantId, clipId: id, brand, platforms: list });
      if (out.error) return res.status(out.status || 500).json({ error: out.error });
      return res.json({ ok: true, captions: out.captions });
    }
    if (action === 'ingest') {
      if (!isPrivileged(session)) return res.status(403).json({ error: 'Owner or admin required to ingest media' });
      const { url, title, caption, mime, is_photo, scheduled_at, target_platforms } = req.body || {};
      const brand = await getPlusUltraBrandId(tenantId);
      const out = await ingestClip({
        tenantId, brand, url, title, caption, mime,
        isPhoto: is_photo === true, scheduledAt: scheduled_at, targetPlatforms: target_platforms,
      });
      if (out.error) return res.status(out.status || 500).json({ error: out.error });
      return res.json({ ingested: true, clip: shapeClip(out.clip) });
    }
    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requirePortalSessionAndTenant(handler);
