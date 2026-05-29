// Ryujin OS — Generator Agent
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
import { renderBeforeAfterPair } from '../../lib/beforeAfterRenderer.js';
import { gradeShowcase, isSoloShowcase } from '../../lib/visionGrader.js';
import { put } from '@vercel/blob';
import crypto from 'node:crypto';

const TENANT_SLUG = 'plus-ultra';
const BRAND_SLUG = 'plus_ultra';
const TARGET_COUNT = 4;
const DEDUP_WINDOW_DAYS = 180;
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// ── Vision showcase gating ──────────────────────────────────────────────
// Selection is vision-gated: a photo can only be drafted if a Claude vision
// pass says it's a finished, attractive roof (lib/visionGrader.js). Pairs are
// preferred; a solo single must clear isSoloShowcase. Graded LIVE per run and
// capped so the cron stays inside its 60s budget. (No media_pool persistence
// yet — caching the grade is a follow-up once the vision_* columns ship; see
// migration 076 + the FAST-FOLLOW task.)
const GRADE_BUDGET = 30;          // max vision calls per run (cost ceiling)
const GRADE_DEADLINE_MS = 45_000; // stop grading after this much elapsed, so a
                                  // slow Anthropic run cannot blow the function's
                                  // 120s budget before captions + inserts run
const GRADE_CONCURRENCY = 5;      // parallel vision calls
const PAIR_FETCH_LIMIT = 12;      // metadata candidates pulled before vision filter
const SINGLE_FETCH_LIMIT = 48;

// Bounded-concurrency map: runs fn over items, at most `limit` in flight.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

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

// Picks candidates from media_pool, VISION-GATED. Strategy:
//   1. Pairs first: before/after couples whose AFTER photo vision-grades as a
//      finished, attractive 'showcase' roof. Pairs may fill every slot.
//   2. Remaining slots: solo singles that clear isSoloShowcase (state=showcase
//      AND score >= floor). Worn/before/in-progress/detail shots are dropped.
// One kept post per project (diversify across jobs); a project is claimed only
// AFTER a photo passes vision, so a project's bad lead photo never blocks its
// good one. Nothing is padded to hit `count` — fewer good posts beats junk.
// Grading is bounded by BOTH a call budget and an elapsed deadline, so a slow
// Anthropic run cannot blow the function's time budget.
async function pickCandidates(tenantId, count) {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_DAYS * 86_400_000).toISOString();
  const stats = { graded: 0, pairs_kept: 0, singles_kept: 0, rejected: 0, ungraded: 0 };
  const candidates = [];
  const seenProjects = new Set();        // projects already claimed by a KEPT post
  let budget = GRADE_BUDGET;
  const deadline = Date.now() + GRADE_DEADLINE_MS;
  const canGrade = () => budget > 0 && Date.now() < deadline;

  const tallyReject = (grade) => {
    if (!grade || grade.state === 'ungraded') stats.ungraded++;
    stats.rejected++;
  };

  // Grade `items` in concurrency batches, calling keep(item, grade) for each
  // result. Stops when full / out of call budget / past the elapsed deadline.
  const gradeAndCollect = async (items, urlOf, keep) => {
    for (let i = 0; i < items.length && candidates.length < count && canGrade(); i += GRADE_CONCURRENCY) {
      const batch = items.slice(i, i + Math.min(GRADE_CONCURRENCY, budget));
      if (!batch.length) break;
      const grades = await mapLimit(batch, GRADE_CONCURRENCY, x => gradeShowcase(urlOf(x)));
      stats.graded += batch.length;
      budget -= batch.length;
      for (let j = 0; j < batch.length && candidates.length < count; j++) keep(batch[j], grades[j]);
    }
  };

  // ── PAIRS (preferred) ───────────────────────────────────────────────
  const { data: pairAfters } = await supabaseAdmin
    .from('media_pool')
    .select('id, url, thumbnail_url, mime_type, project_id, customer_name, address_city, package_tier, pair_role, pair_partner_id, quality_score, tags, captured_at, source_bucket, used_in_clip_id, last_used_at')
    .eq('tenant_id', tenantId)
    .eq('excluded', false)
    .eq('pair_role', 'after')
    .not('pair_partner_id', 'is', null)
    .is('used_in_clip_id', null)
    .or(`last_used_at.is.null,last_used_at.lt.${cutoff}`)
    .order('quality_score', { ascending: false })
    .limit(PAIR_FETCH_LIMIT);

  // Resolve each after's unused 'before' partner.
  const pairRaw = [];
  for (const after of (pairAfters || [])) {
    const { data: before } = await supabaseAdmin
      .from('media_pool')
      .select('id, url, thumbnail_url, mime_type, project_id, customer_name, address_city, package_tier, quality_score, tags, captured_at, source_bucket, used_in_clip_id')
      .eq('id', after.pair_partner_id).maybeSingle();
    if (!before || before.used_in_clip_id) continue;
    pairRaw.push({ after, before });
  }

  await gradeAndCollect(pairRaw, p => p.after.url, ({ after, before }, grade) => {
    if (grade?.state !== 'showcase') { tallyReject(grade); return; }
    if (after.project_id && seenProjects.has(after.project_id)) return; // job already covered
    if (after.project_id) seenProjects.add(after.project_id);
    stats.pairs_kept++;
    candidates.push({
      kind: 'pair', before, after, grade,
      project_id: after.project_id,
      customer_name: after.customer_name || before.customer_name,
      address_city: after.address_city || before.address_city,
      package_tier: after.package_tier || before.package_tier,
    });
  });

  // ── SINGLES (fill remaining; showcase-only, one per job) ────────────
  if (candidates.length < count && canGrade()) {
    const usedIds = new Set();
    for (const c of candidates) {
      if (c.kind === 'pair') { usedIds.add(c.before.id); usedIds.add(c.after.id); }
    }

    const { data: singleRows } = await supabaseAdmin
      .from('media_pool')
      .select('id, url, thumbnail_url, mime_type, project_id, customer_name, address_city, package_tier, quality_score, tags, captured_at, source_bucket, used_in_clip_id, last_used_at')
      .eq('tenant_id', tenantId)
      .eq('excluded', false)
      .is('used_in_clip_id', null)
      .or(`last_used_at.is.null,last_used_at.lt.${cutoff}`)
      .order('quality_score', { ascending: false })
      .limit(SINGLE_FETCH_LIMIT);

    const pool = (singleRows || []).filter(m => !usedIds.has(m.id));
    await gradeAndCollect(pool, m => m.url, (m, grade) => {
      if (!isSoloShowcase(grade)) { tallyReject(grade); return; }
      // Claim the project only on a PASS: a project's lower-ranked showcase
      // photo still gets a chance if its top-metadata photo was a detail /
      // before / in-progress shot (which would have been rejected above).
      if (m.project_id && seenProjects.has(m.project_id)) return;
      if (m.project_id) seenProjects.add(m.project_id);
      stats.singles_kept++;
      candidates.push({
        kind: 'single', media: m, grade,
        project_id: m.project_id,
        customer_name: m.customer_name,
        address_city: m.address_city,
        package_tier: m.package_tier,
      });
    });
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

async function draftCaption({ brand, candidate, kind }) {
  const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!ANTHROPIC_KEY) {
    return {
      text: buildFallbackCaption({ brand, candidate, kind }),
      model: 'fallback-template',
    };
  }

  // PRIVACY: never pass customer_name or project name to Claude. project_files
  // and projects.name in this codebase are commonly "265 Irving Blvd" or
  // similar street addresses, so leaking them into the prompt let Claude
  // faithfully write street addresses into public social posts. Only city
  // and package tier are safe to pass.
  const ctx = [
    `Source: ${kind === 'pair' ? 'before/after photo pair' : 'single roofing photo'}`,
    candidate.address_city ? `Location: ${candidate.address_city}, NB` : 'Location: greater Moncton area',
    candidate.package_tier ? `System: ${candidate.package_tier}` : null,
  ].filter(Boolean).join('\n');

  const prompt = `Write ONE Facebook social media caption for Plus Ultra Roofing.

## Brand
${brand.name}
Voice: ${brand.voice}
Default CTA: ${brand.cta || 'Get your free roof inspection'}
Website: ${brand.website || 'plusultraroofing.com'}

## Post context
${ctx}

## Rules
- 2 to 4 sentences. Sweet spot 200-400 chars.
- Open with a clear, specific hook tied to the work.
- ${kind === 'pair' ? 'Frame the transformation honestly. Reference the work that happened.' : 'Show pride in the craft without exaggeration.'}
- End with the brand CTA or a soft invitation to book a free inspection.
- 0 to 3 hashtags at the very end if they help. Skip if they feel forced.
- NEVER mention street addresses, house numbers, or specific street names. City and province only.
- NEVER mention customer names. Generic references only ("a Riverview homeowner", "this home").
- NO em dashes. NO "just". NO "no surprises" / "no rush" style negations. NO "in this market". NO sci-fi or techy tone.
- Plain English. Family-roofing voice. 3rd-gen pride without bragging.
- Mention New Brunswick or Moncton if location was provided.

## Output
Return ONLY the caption text. No quotes, no preamble, no markdown.`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
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
      console.error('[generator] Claude error:', r.status, errText.slice(0, 200));
      return { text: buildFallbackCaption({ brand, candidate, kind }), model: 'fallback-template' };
    }
    const data = await r.json();
    const text = (data?.content?.[0]?.text || '').trim().replace(/^["']|["']$/g, '');
    if (!text) return { text: buildFallbackCaption({ brand, candidate, kind }), model: 'fallback-template' };
    if (text.includes('—') || text.includes('–')) {
      const cleaned = text.replace(/\s*[—–]\s*/g, ', ');
      return { text: cleaned, model: CLAUDE_MODEL };
    }
    return { text, model: CLAUDE_MODEL };
  } catch (e) {
    console.error('[generator] Claude call failed:', e.message);
    return { text: buildFallbackCaption({ brand, candidate, kind }), model: 'fallback-template' };
  }
}

function buildFallbackCaption({ brand, candidate, kind }) {
  const city = candidate.address_city || 'greater Moncton';
  const head = kind === 'pair'
    ? `Another roof complete in ${city}. Before and after of work we just finished, on a system built to last.`
    : `Recent work from a ${city} project. Roofing done right the first time.`;
  const cta = brand.cta || 'Get your free roof inspection';
  return `${head}\n\n${cta} at ${brand.website || 'plusultraroofing.com'}.`;
}

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
    // skips drafts until Mac/Cat approves (codex P1 — sweep would
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

async function runGenerator({ targetCount = TARGET_COUNT, dryRun = false } = {}) {
  const tenant = await getTenant();
  const brand = await getBrand(tenant.id);

  const { candidates, stats } = await pickCandidates(tenant.id, targetCount);
  const slots = nextWeeklySlots(new Date(), targetCount);

  const warnings = [];
  if (candidates.length < targetCount) warnings.push('low_inventory');
  warnings.push(
    `graded:${stats.graded}`,
    `pairs:${stats.pairs_kept}`,
    `singles:${stats.singles_kept}`,
    `rejected:${stats.rejected}`,
  );
  if (stats.ungraded) warnings.push(`ungraded:${stats.ungraded}`);

  // Dry run: report exactly what WOULD be drafted (with vision grades), touch
  // nothing — no run row, no clips, no media_pool used-flags. Powers a
  // "preview next run" check from /generator.html or curl.
  if (dryRun) {
    return {
      dry_run: true,
      candidates_considered: candidates.length,
      stats,
      warnings,
      preview: candidates.map((c, i) => ({
        kind: c.kind,
        address_city: c.address_city || null,
        grade: c.grade ? { state: c.grade.state, score: c.grade.score, reason: c.grade.reason } : null,
        scheduled_at: slots[i]?.toISOString() || null,
        url: c.kind === 'pair' ? c.after.url : c.media.url,
      })),
    };
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
  let captionModelUsed = null;
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

    const captionResult = await draftCaption({ brand, candidate, kind: candidate.kind });
    captionModelUsed = captionResult.model;

    const inserted = await insertDraft({
      tenant, brand, candidate, mediaUrl,
      captionText: captionResult.text,
      captionModel: captionResult.model,
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
      caption_preview: captionResult.text.slice(0, 120),
    });
  }

  await supabaseAdmin.from('generator_runs').update({
    inserted_count: drafts.length,
    candidates_considered: candidates.length,
    warnings,
    caption_model: captionModelUsed,
  }).eq('id', runId);

  await supabaseAdmin.from('agent_runs').insert({
    tenant_id: tenant.id,
    agent_slug: 'generator',
    payload: { drafts, warnings, stats, run_id: runId, target_count: targetCount },
    status: drafts.length ? 'success' : 'partial',
  }).select('id').single().then(() => null, e => console.error('[generator] agent_runs insert:', e?.message));

  return { run_id: runId, drafts, warnings, stats, candidates_considered: candidates.length };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }
  const auth = checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const targetCount = Math.max(1, Math.min(8, parseInt(req.query.count, 10) || TARGET_COUNT));
    const dryRun = req.query.dryRun === '1' || req.query.dry === '1';
    const result = await runGenerator({ targetCount, dryRun });
    return res.json({ via: auth.via, ...result });
  } catch (e) {
    console.error('[generator] run failed:', e);
    return res.status(500).json({ error: e.message });
  }
}
