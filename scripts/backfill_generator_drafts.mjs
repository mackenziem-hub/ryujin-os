#!/usr/bin/env node
// Ryujin OS — Generator Backlog Backfill
//
// Pre-stages a batch of social drafts from the vision INDEX (no live grading):
// picks the highest-scoring showcase photos from our-work sources (CompanyCam +
// project_files; estimate photos are pre-sale customer roofs and excluded),
// one per job, writes a varied caption (rotating angles so the feed doesn't read
// templated), and inserts them as status='awaiting_approval' across the weekly
// slot grid. Mac/Cat then approve in /generator.html.
//
// Reads the index from media_pool.tags (vstate:showcase / vscore:N / vmat:X).
//
// Usage:
//   node --env-file=.env.local scripts/backfill_generator_drafts.mjs --dry          # preview, no writes
//   node --env-file=.env.local scripts/backfill_generator_drafts.mjs --count 40     # stage 40 drafts
import { createClient } from '@supabase/supabase-js';
import { shortCaption, vscoreFromTags, vmatFromTags } from '../lib/generatorCaption.js';

const supabaseAdmin = createClient(
  (process.env.SUPABASE_URL || '').trim(),
  (process.env.SUPABASE_SERVICE_KEY || '').replace(/\\n/g, '').trim(),
  { auth: { persistSession: false } },
);

const TENANT_SLUG = 'plus-ultra';
const BRAND_SLUG = 'plus_ultra';
const OUR_WORK_SOURCES = ['companycam_archive', 'project_files', 'media_folder'];
const DEDUP_WINDOW_DAYS = 180;

const argN = (flag, def) => { const i = process.argv.indexOf(flag); return i >= 0 ? parseInt(process.argv[i + 1], 10) : def; };
const DRY = process.argv.includes('--dry');
const COUNT = argN('--count', 40);

// ── Slot grid (Atlantic Time, UTC-3 summer), matches the generator agent ──
const AT_UTC_OFFSET_HOURS = -3;
const SLOTS = [
  { dayOfWeek: 2, hour: 10 }, { dayOfWeek: 4, hour: 10 },
  { dayOfWeek: 6, hour: 10 }, { dayOfWeek: 0, hour: 14 },
];
function nextWeeklySlots(fromDate, count) {
  const out = [];
  for (let week = 0; week < 60 && out.length < count; week++) {
    for (const slot of SLOTS) {
      if (out.length >= count) break;
      const c = new Date(fromDate.getTime());
      const daysAhead = (slot.dayOfWeek - c.getUTCDay() + 7) % 7;
      c.setUTCDate(c.getUTCDate() + daysAhead + week * 7);
      c.setUTCHours(slot.hour - AT_UTC_OFFSET_HOURS, 0, 0, 0);
      if (c.getTime() > fromDate.getTime()) out.push(c);
    }
  }
  out.sort((a, b) => a - b);
  return out.slice(0, count);
}

async function getTenantBrand() {
  const { data: tenant } = await supabaseAdmin.from('tenants').select('id, slug').eq('slug', TENANT_SLUG).single();
  const { data: brand } = await supabaseAdmin.from('brands')
    .select('id, slug, name, voice, tagline, cta, website, hashtags')
    .eq('tenant_id', tenant.id).eq('slug', BRAND_SLUG).single();
  return { tenant, brand };
}

// Pull the indexed showcase pool (our-work, unused, not excluded), best-first,
// one per project to diversify across jobs.
async function pickShowcase(tenantId, count) {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_DAYS * 86_400_000).toISOString();
  const pool = []; const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('media_pool')
      .select('id, url, mime_type, project_id, customer_name, address_city, package_tier, source_bucket, tags')
      .eq('tenant_id', tenantId)
      .in('source_bucket', OUR_WORK_SOURCES)
      .eq('excluded', false)
      .is('used_in_clip_id', null)
      .or(`last_used_at.is.null,last_used_at.lt.${cutoff}`)
      .contains('tags', ['vstate:showcase'])
      .range(from, from + PAGE - 1);
    if (error) { console.error('pool fetch error:', error.message); break; }
    if (!data || !data.length) break;
    pool.push(...data);
    if (data.length < PAGE) break;
  }
  pool.sort((a, b) => vscoreFromTags(b.tags) - vscoreFromTags(a.tags));
  const picked = []; const seenProjects = new Set();
  for (const m of pool) {
    if (picked.length >= count) break;
    if (m.project_id && seenProjects.has(m.project_id)) continue;
    if (m.project_id) seenProjects.add(m.project_id);
    picked.push(m);
  }
  return { picked, poolSize: pool.length };
}

async function main() {
  const { tenant, brand } = await getTenantBrand();
  if (!brand) { console.error('plus_ultra brand not found'); process.exit(1); }
  const { picked, poolSize } = await pickShowcase(tenant.id, COUNT);
  console.log(`Showcase pool: ${poolSize} | staging ${picked.length} drafts${DRY ? ' (DRY RUN)' : ''}`);
  if (!picked.length) { console.log('Nothing to stage.'); return; }

  const slots = nextWeeklySlots(new Date(), picked.length);
  const captions = picked.map((m, i) =>
    shortCaption({ city: m.address_city, tags: m.tags, i, website: brand.website }));

  let inserted = 0;
  for (let i = 0; i < picked.length; i++) {
    const m = picked[i]; const slot = slots[i]; const cap = captions[i];
    const city = m.address_city || 'Plus Ultra Roofing';
    if (DRY) {
      console.log(`\n#${i + 1} [score ${vscoreFromTags(m.tags)} ${vmatFromTags(m.tags)}] ${city} @ ${slot.toISOString()}`);
      console.log('   ' + cap);
      continue;
    }
    const mimeType = m.mime_type || 'image/jpeg';
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const { data: clip, error } = await supabaseAdmin.from('marketing_clips').insert({
      tenant_id: tenant.id,
      source_url: m.url, source_filename: `backfill-${Date.now()}-${i}.${ext}`, source_mime_type: mimeType,
      rendered_url: m.url, thumbnail_url: m.url,
      title: `Plus Ultra · ${city}`,
      description: cap.slice(0, 300),
      target_platforms: ['facebook', 'gbp'],
      scheduled_at: slot.toISOString(), is_photo: true,
      status: 'awaiting_approval', source_kind: 'generator',
      caption_suggestion: cap, caption_overrides: {},
    }).select('id').single();
    if (error) { console.error(`insert fail #${i + 1}:`, error.message); continue; }
    await supabaseAdmin.from('marketing_clip_brands').insert({ clip_id: clip.id, brand_id: brand.id });
    await supabaseAdmin.from('clip_media_sources').insert({ clip_id: clip.id, media_id: m.id, role: 'hero' });
    await supabaseAdmin.from('media_pool').update({ used_in_clip_id: clip.id, last_used_at: new Date().toISOString() }).eq('id', m.id);
    inserted++;
  }
  console.log(`\n${DRY ? 'DRY: would stage' : 'Staged'} ${DRY ? picked.length : inserted} drafts across ${slots.length} slots (first ${slots[0]?.toISOString().slice(0,10)}, last ${slots[slots.length-1]?.toISOString().slice(0,10)}).`);
}

main().catch(e => { console.error('backfill failed:', e); process.exit(1); });
