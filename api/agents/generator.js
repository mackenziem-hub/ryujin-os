// Ryujin OS - Generator Agent
//
// Weekly cron (Sunday 23:00 UTC = Sun 8 PM AT). Picks 4 unused media_pool
// items for Plus Ultra Roofing, composites before/after pairs via the
// existing sharp renderer, generates a Claude caption draft, and inserts
// marketing_clips rows with status='ready' and source_kind='generator' at
// the fixed weekly slot grid (Tue/Thu/Sat 10am AT + Sun 2pm AT).
//
// The drafts wait at status='ready' WITHOUT a populated caption_overrides
// map. The existing marketing-publish guard refuses to fan out without
// approved overrides, so nothing leaves the system until Mac or Cat hits
// approve in /generator.html. On approval, the override is populated and
// the existing marketing-publish?next=1 cron picks it up within 10 min.
//
// Auth:
//   1. Authorization: Bearer $CRON_SECRET  ← Vercel cron auto-sends
//   2. x-internal-key: $INTERNAL_RENDER_KEY
//   3. Open in dev when neither env var is set
//
// Manual fire:
//   POST /api/agents/generator?manual=1   (still requires auth)
import { supabaseAdmin } from '../../lib/supabase.js';
import { logAgentRun } from '../../lib/agents/logAgentRun.js';
import { renderBeforeAfterPair } from '../../lib/beforeAfterRenderer.js';
import { shortCaption, vscoreFromTags } from '../../lib/generatorCaption.js';
import { SHOWCASE_SCORE_FLOOR } from '../../lib/visionGrader.js';
import { put } from '@vercel/blob';
import crypto from 'node:crypto';

const TENANT_SLUG = 'plus-ultra';
const BRAND_SLUG = 'plus_ultra';
const TARGET_COUNT = 4;
// Selection is use-once in practice: a posted photo keeps used_in_clip_id set
// forever and selection requires used_in_clip_id IS NULL, so it never recycles.
// DEDUP_WINDOW_DAYS only relaxes the secondary last_used_at gate; it does NOT
// re-open already-posted photos. Recycling would require clearing used_in_clip_id
// (the reject path does this), which is intentionally a manual action.
const DEDUP_WINDOW_DAYS = 180;

// Selection reads the persisted vision INDEX (media_pool.tags written by
// scripts/grade_media_pool.mjs: vstate:showcase / vscore:N / vmat:X) rather
// than grading live, instant, no API cost, and provenance-safe: only "our
// work" sources are eligible for a showcase post. estimate_photos are pre-sale
// customer roofs and are never posted as our work.
const OUR_WORK_SOURCES = ['companycam_archive', 'project_files', 'media_folder'];
const SHOWCASE_PAGE = 1000;       // pagination page size for the showcase pool
const QUEUE_HORIZON_DAYS = 21;    // weekly run skips while the queue already covers this far ahead

function checkAuth(req) {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const internalKey = (process.env.INTERNAL_RENDER_KEY || '').trim();
  if (!cronSecret && !internalKey) return { ok: true, via: 'open-dev' };
  const auth = (req.headers['authorization'] || '').trim();
  if (cronSecret && auth === `Bearer ${cronSecret}`) return { ok: true, via: 'cron-secret' };
  const got = (req.headers['x-internal-key'] || '').trim();
  if (internalKey && got === internalKey) return { ok: true, via: 'internal-key' };
  return { ok: false };
}

// Slot grid in Atlantic Time. Computes the next occurrence of each weekly
// slot AFTER `from`, returns up to `count` slots ascending. Atlantic Time
// is UTC-3 during ADT (Mar-Nov) and UTC-4 during AST (Nov-Mar). Phase 1
// hard-codes UTC-3 because the current window is summer; cutover to a tz
// library is a Phase 2 follow-up.
const AT_UTC_OFFSET_HOURS = -3;
const SLOTS = [
  { dayOfWeek: 2, hour: 10 }, // Tuesday 10:00 AT
  { dayOfWeek: 4, hour: 10 }, // Thursday 10:00 AT
  { dayOfWeek: 6, hour: 10 }, // Saturday 10:00 AT
  { dayOfWeek: 0, hour: 14 }, // Sunday 14:00 AT
];

function nextWeeklySlots(fromDate, count) {
  const out = [];
  let seedMs = fromDate.getTime();
  for (let week = 0; week < 4 && out.length < count; week++) {
    for (const slot of SLOTS) {
      if (out.length >= count) break;
      // Build a UTC date for "this week's <dayOfWeek> at <hour> AT". The
      // AT clock target hour is hour+(-AT_UTC_OFFSET_HOURS) UTC = hour+3 UTC.
      const candidate = new Date(seedMs);
      const currentDow = candidate.getUTCDay();
      const daysAhead = (slot.dayOfWeek - currentDow + 7) % 7;
      candidate.setUTCDate(candidate.getUTCDate() + daysAhead + week * 7);
      candidate.setUTCHours(slot.hour - AT_UTC_OFFSET_HOURS, 0, 0, 0);
      if (candidate.getTime() > fromDate.getTime()) out.push(candidate);
    }
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out.slice(0, count);
}

async function getTenant() {
  const { data, error } = await supabaseAdmin
    .from('tenants').select('id, slug').eq('slug', TENANT_SLUG).single();
  if (error) throw new Error(`tenant lookup: ${error.message}`);
  return data;
}

async function getBrand(tenantId) {
  const { data, error } = await supabaseAdmin
    .from('brands').select('id, slug, name, voice, tagline, cta, website, hashtags')
    .eq('tenant_id', tenantId).eq('slug', BRAND_SLUG).single();
  if (error) throw new Error(`brand lookup: ${error.message}`);
  return data;
}

// Picks candidates from the persisted vision INDEX (no live grading):
//   1. Pairs first: a before/after couple whose AFTER is tagged showcase, with
//      an unused, non-excluded before. (Rare until before/after tagging grows.)
//   2. Remaining slots: solo showcase singles, best vscore first, one per job.
// Provenance is enforced by SOURCE (OUR_WORK_SOURCES only): estimate photos
// (pre-sale customer roofs) are never eligible. Nothing is padded to hit
// `count`; thin inventory just means fewer posts (surfaced as low_inventory).
async function pickCandidates(tenantId, count) {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_DAYS * 86_400_000).toISOString();
  const stats = { pairs_kept: 0, singles_kept: 0, showcase_pool: 0 };
  const candidates = [];
  const seenProjects = new Set();
  const freshOrUnused = `last_used_at.is.null,last_used_at.lt.${cutoff}`;

  // ── PAIRS (preferred) ───────────────────────────────────────────────
  const { data: pairAfters } = await supabaseAdmin
    .from('media_pool')
    .select('id, url, mime_type, project_id, customer_name, address_city, package_tier, pair_partner_id, tags, source_bucket')
    .eq('tenant_id', tenantId)
    .in('source_bucket', OUR_WORK_SOURCES)
    .eq('excluded', false)
    .eq('pair_role', 'after')
    .not('pair_partner_id', 'is', null)
    .is('used_in_clip_id', null)
    .or(freshOrUnused)
    .contains('tags', ['vstate:showcase'])
    .limit(20);
  for (const after of (pairAfters || [])) {
    if (candidates.length >= count) break;
    if (after.project_id && seenProjects.has(after.project_id)) continue;
    const { data: before } = await supabaseAdmin
      .from('media_pool')
      .select('id, url, mime_type, project_id, used_in_clip_id')
      .eq('id', after.pair_partner_id)
      .eq('tenant_id', tenantId)
      .eq('excluded', false)        // an excluded before must not resurface as a pair half
      .in('source_bucket', OUR_WORK_SOURCES) // defense-in-depth: a non-our-work BEFORE can never ride a pair into a public post
      .maybeSingle();
    if (!before || before.used_in_clip_id) continue;
    if (after.project_id) seenProjects.add(after.project_id);
    candidates.push({
      kind: 'pair', before, after,
      project_id: after.project_id,
      customer_name: after.customer_name,
      address_city: after.address_city,
      package_tier: after.package_tier,
    });
    stats.pairs_kept++;
  }

  // ── SINGLES (fill remaining; indexed showcase, best-first, one per job) ──
  if (candidates.length < count) {
    const usedIds = new Set();
    for (const c of candidates) { if (c.kind === 'pair') { usedIds.add(c.before.id); usedIds.add(c.after.id); } }

    // Pull the full unused showcase pool for our-work sources, then rank by
    // vscore in JS (the score lives in a tag, so it can't be ORDER BY'd in SQL).
    const pool = [];
    for (let from = 0; ; from += SHOWCASE_PAGE) {
      const { data, error } = await supabaseAdmin
        .from('media_pool')
        .select('id, url, mime_type, project_id, customer_name, address_city, package_tier, tags, source_bucket')
        .eq('tenant_id', tenantId)
        .in('source_bucket', OUR_WORK_SOURCES)
        .eq('excluded', false)
        .is('used_in_clip_id', null)
        .or(freshOrUnused)
        .contains('tags', ['vstate:showcase'])
        .order('id', { ascending: true }) // stable order so range pagination can't skip rows
        .range(from, from + SHOWCASE_PAGE - 1);
      if (error || !data || !data.length) break;
      pool.push(...data);
      if (data.length < SHOWCASE_PAGE) break;
    }
    stats.showcase_pool = pool.length;
    pool.sort((a, b) => vscoreFromTags(b.tags) - vscoreFromTags(a.tags));
    for (const m of pool) {
      if (candidates.length >= count) break;
      if (usedIds.has(m.id)) continue;
      // Solo singles must clear the showcase score floor. Pairs keep no floor
      // (the before/after framing carries a lower-scoring after).
      if (vscoreFromTags(m.tags) < SHOWCASE_SCORE_FLOOR) continue;
      if (m.project_id && seenProjects.has(m.project_id)) continue; // one post per job
      if (m.project_id) seenProjects.add(m.project_id);
      candidates.push({
        kind: 'single', media: m,
        project_id: m.project_id,
        customer_name: m.customer_name,
        address_city: m.address_city,
        package_tier: m.package_tier,
      });
      stats.singles_kept++;
    }
  }

  return { candidates, stats };
}

// Composes a before/after pair using the existing sharp renderer and
// uploads the result to Blob. Returns the public URL or null on failure.
async function renderPair(tenantSlug, candidate) {
  try {
    // renderBeforeAfterPair returns { buffer, width, height, mime } not a raw
    // Buffer. Passing the wrapper object to put() silently fails with a type
    // error caught as 'pair render failed' (May 29 incident on media_pool
    // b5ebab68). Always destructure the buffer field.
    const result = await renderBeforeAfterPair({
      beforeUrl: candidate.before.url,
      afterUrl: candidate.after.url,
      format: 'landscape',
    });
    if (!result?.buffer) return null;
    const hash = crypto.createHash('sha256')
      .update(`${candidate.before.id}|${candidate.after.id}`).digest('hex').slice(0, 12);
    const blob = await put(
      `${tenantSlug}/generator/pairs/${hash}-landscape.jpg`,
      result.buffer,
      { access: 'public', contentType: result.mime || 'image/jpeg' },
    );
    return blob.url;
  } catch (e) {
    console.error('[generator] pair render failed:', e.message);
    return null;
  }
}

// Single-photo path: just reuse the source URL. The publisher hands the
// URL straight to GHL Social Planner which copies it to Meta/Google.
function resolveSingleUrl(candidate) {
  return candidate.media.url;
}

// Captions come from the shared shortCaption() in lib/generatorCaption.js,
// short, plain, rotating phrasings, no LLM (matches the backfill voice).

async function insertDraft({ tenant, brand, candidate, mediaUrl, captionText, captionModel, scheduledAt, runId, kind }) {
  const titleCity = candidate.address_city || 'Plus Ultra Roofing';
  const title = kind === 'pair'
    ? `Before/After · ${titleCity}`
    : `Plus Ultra · ${titleCity}`;

  // Pair renders are always JPEG from the sharp pipeline; singles preserve
  // the source MIME so the publisher hands GHL the correct content type
  // (codex P2: hardcoded jpeg broke PNG/WebP singles in early review).
  const mimeType = kind === 'pair'
    ? 'image/jpeg'
    : (candidate.media?.mime_type || 'image/jpeg');
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';

  const clipRow = {
    tenant_id: tenant.id,
    source_url: mediaUrl,
    source_filename: `${kind}-${Date.now()}.${ext}`,
    source_mime_type: mimeType,
    rendered_url: mediaUrl,
    thumbnail_url: mediaUrl,
    title,
    description: captionText.slice(0, 300),
    target_platforms: ['facebook', 'gbp'],
    scheduled_at: scheduledAt.toISOString(),
    is_photo: true,
    // 'awaiting_approval' instead of 'ready' so the publish sweep
    // skips drafts until Mac/Cat approves (codex P1, sweep would
    // auto-fail unapproved drafts within the 24h lookahead window).
    status: 'awaiting_approval',
    source_kind: 'generator',
    generator_run_id: runId,
    caption_suggestion: captionText,
    caption_overrides: {},
  };

  const { data: clip, error } = await supabaseAdmin
    .from('marketing_clips').insert(clipRow).select('*').single();
  if (error) {
    return { error: `clip insert: ${error.message}` };
  }

  await supabaseAdmin.from('marketing_clip_brands').insert({ clip_id: clip.id, brand_id: brand.id });

  const mediaIds = kind === 'pair'
    ? [{ clip_id: clip.id, media_id: candidate.before.id, role: 'before' },
       { clip_id: clip.id, media_id: candidate.after.id, role: 'after' }]
    : [{ clip_id: clip.id, media_id: candidate.media.id, role: 'hero' }];
  await supabaseAdmin.from('clip_media_sources').insert(mediaIds);

  const updateIds = kind === 'pair' ? [candidate.before.id, candidate.after.id] : [candidate.media.id];
  await supabaseAdmin
    .from('media_pool')
    .update({ used_in_clip_id: clip.id, last_used_at: new Date().toISOString() })
    .in('id', updateIds);

  return { clip };
}

async function runGenerator({ targetCount = TARGET_COUNT, dryRun = false, trigger = 'cron_daily' } = {}) {
  const startTime = Date.now();
  const tenant = await getTenant();
  const brand = await getBrand(tenant.id);

  // Schedule AFTER the last already-scheduled generator draft so the weekly run
  // extends the backlog instead of double-booking slots it already owns; and
  // skip entirely while the queue already covers QUEUE_HORIZON_DAYS (the backfill
  // can stage weeks of content, the weekly top-up only runs when it's low).
  const now = new Date();
  const { data: lastSched } = await supabaseAdmin
    .from('marketing_clips')
    .select('scheduled_at')
    .eq('tenant_id', tenant.id)
    .eq('source_kind', 'generator')
    .in('status', ['awaiting_approval', 'ready', 'scheduled'])
    .order('scheduled_at', { ascending: false })
    .limit(1).maybeSingle();
  const lastMs = lastSched?.scheduled_at ? new Date(lastSched.scheduled_at).getTime() : 0;
  const queueDeep = lastMs > now.getTime() + QUEUE_HORIZON_DAYS * 86_400_000;
  const seed = lastMs > now.getTime() ? new Date(lastMs) : now;

  const { candidates, stats } = await pickCandidates(tenant.id, targetCount);
  const slots = nextWeeklySlots(seed, targetCount);

  const warnings = [];
  if (queueDeep) warnings.push('queue_deep');
  if (candidates.length < targetCount) warnings.push('low_inventory');
  warnings.push(
    `pool:${stats.showcase_pool}`,
    `pairs:${stats.pairs_kept}`,
    `singles:${stats.singles_kept}`,
  );

  // Dry run: report exactly what WOULD be drafted (with vision scores), touch
  // nothing, no run row, no clips, no media_pool used-flags. Powers a
  // "preview next run" check from /generator.html or curl.
  if (dryRun) {
    return {
      dry_run: true,
      queue_deep: queueDeep,
      queue_until: lastMs ? new Date(lastMs).toISOString() : null,
      candidates_considered: candidates.length,
      stats,
      warnings,
      preview: candidates.map((c, i) => {
        const m = c.kind === 'pair' ? c.after : c.media;
        return {
          kind: c.kind,
          address_city: c.address_city || null,
          score: vscoreFromTags(m.tags),
          scheduled_at: slots[i]?.toISOString() || null,
          url: m.url,
        };
      }),
    };
  }

  // Queue already covers the horizon, skip to avoid double-booking slots the
  // backlog owns and unbounded queue growth. The staged drafts keep posting.
  if (queueDeep) {
    // Heartbeat via the shared logger: agent_runs has an `output` jsonb column,
    // NOT `payload` (a direct insert with `payload` silently 42703'd and the
    // fail-soft .then swallowed it, leaving generator permanently "dark").
    await logAgentRun({
      tenantId: tenant.id, agentSlug: 'generator', startedAt: startTime, trigger,
      status: 'success', summary: 'skipped: queue_deep',
      output: { skipped: 'queue_deep', queue_until: new Date(lastMs).toISOString(), warnings },
    });
    return { skipped: 'queue_deep', queue_until: new Date(lastMs).toISOString(), warnings };
  }

  const { data: runRow, error: runErr } = await supabaseAdmin
    .from('generator_runs')
    .insert({
      tenant_id: tenant.id,
      cadence: 'weekly',
      brand_slug: BRAND_SLUG,
      target_count: targetCount,
    })
    .select('id').single();
  if (runErr) throw new Error(`run row insert: ${runErr.message}`);
  const runId = runRow.id;

  const drafts = [];
  const captionModel = 'template';
  for (let i = 0; i < candidates.length && i < slots.length; i++) {
    const candidate = candidates[i];
    const slot = slots[i];

    let mediaUrl;
    if (candidate.kind === 'pair') {
      mediaUrl = await renderPair(tenant.slug, candidate);
      if (!mediaUrl) {
        warnings.push(`pair_render_failed:${candidate.after.id}`);
        mediaUrl = candidate.after.url;
      }
    } else {
      mediaUrl = resolveSingleUrl(candidate);
    }

    const captionText = shortCaption({
      city: candidate.address_city,
      tags: candidate.kind === 'pair' ? candidate.after.tags : candidate.media.tags,
      i,
      website: brand.website,
    });

    const inserted = await insertDraft({
      tenant, brand, candidate, mediaUrl,
      captionText,
      captionModel,
      scheduledAt: slot, runId, kind: candidate.kind,
    });
    if (inserted.error) {
      warnings.push(`insert_failed:${inserted.error}`);
      continue;
    }
    drafts.push({
      clip_id: inserted.clip.id,
      kind: candidate.kind,
      scheduled_at: slot.toISOString(),
      address_city: candidate.address_city,
      caption_preview: captionText.slice(0, 120),
    });
  }

  await supabaseAdmin.from('generator_runs').update({
    inserted_count: drafts.length,
    candidates_considered: candidates.length,
    warnings,
    caption_model: captionModel,
  }).eq('id', runId);

  // Heartbeat via the shared logger (agent_runs uses `output`, not `payload`).
  await logAgentRun({
    tenantId: tenant.id, agentSlug: 'generator', startedAt: startTime, trigger,
    status: drafts.length ? 'success' : 'partial',
    summary: `${drafts.length}/${candidates.length} drafts scheduled`,
    output: { drafts, warnings, stats, run_id: runId, target_count: targetCount },
  });

  return { run_id: runId, drafts, warnings, stats, candidates_considered: candidates.length };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }
  const auth = checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  // trigger must stay within the agent_runs CHECK ('cron_daily','manual','api');
  // generator is weekly, but 'cron_daily' is the only allowed cron value, so a
  // manual fire is the only distinction we can record without a schema change.
  const startTime = Date.now();
  const isManual = req.query.manual === '1' || req.query.manual === 'true';
  const trigger = isManual ? 'manual' : 'cron_daily';
  const dryRun = req.query.dryRun === '1' || req.query.dry === '1';
  try {
    const targetCount = Math.max(1, Math.min(8, parseInt(req.query.count, 10) || TARGET_COUNT));
    const result = await runGenerator({ targetCount, dryRun, trigger });
    return res.json({ via: auth.via, ...result });
  } catch (e) {
    console.error('[generator] run failed:', e);
    // A throw past tenant resolution (run-row insert, render, pickCandidates)
    // would otherwise 500 with NO agent_runs row, leaving the freshness alarm
    // blind to a failing generator for its full ~8-day WINDOW. Log a best-effort
    // error heartbeat so the failure surfaces as a loud [ERR] line. Skip for dry
    // runs (they intentionally touch nothing).
    if (!dryRun) {
      try {
        const t = await getTenant();
        await logAgentRun({ tenantId: t.id, agentSlug: 'generator', startedAt: startTime, trigger, status: 'error', error: e.message, summary: 'generator run failed' });
      } catch (logErr) { console.error('[generator] error-heartbeat failed:', logErr?.message); }
    }
    return res.status(500).json({ error: e.message });
  }
}
