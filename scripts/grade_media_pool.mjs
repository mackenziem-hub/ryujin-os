#!/usr/bin/env node
// Ryujin OS — Media Pool Vision Indexer
//
// Grades every "our work" photo in media_pool for showcase-worthiness via
// Claude vision (lib/visionGrader.js) and persists the grade into the existing
// media_pool.tags array (no schema change needed):
//   vgraded            marker that this row has been graded
//   vstate:<state>     showcase | before_or_worn | in_progress | detail | not_roof
//   vscore:<0-10>      visual appeal as a social post
//   vmat:<material>    asphalt | metal | flat | other | unknown
//
// Provenance is by SOURCE, not vision: companycam_archive + project_files are
// our jobs (gradeable for showcase); estimate_photos are pre-sale customer
// roofs and are intentionally NOT graded here (never a solo showcase post).
//
// Resumable: rows already carrying 'vgraded' are skipped, so re-running picks
// up where it left off (and re-runs only retry the failures).
//
// Usage:
//   node --env-file=.env.local scripts/grade_media_pool.mjs            # grade all ungraded
//   node --env-file=.env.local scripts/grade_media_pool.mjs --limit 50 # smoke test
import { createClient } from '@supabase/supabase-js';
import { gradeShowcase } from '../lib/visionGrader.js';

const supabase = createClient(
  (process.env.SUPABASE_URL || '').trim(),
  (process.env.SUPABASE_SERVICE_KEY || '').replace(/\\n/g, '').trim(),
  { auth: { persistSession: false } },
);

const CONCURRENCY = 12;
const OUR_WORK_SOURCES = ['companycam_archive', 'project_files'];
const VTAG = /^(vgraded|vstate:|vscore:|vmat:)/;
const limitArg = (() => { const i = process.argv.indexOf('--limit'); return i >= 0 ? parseInt(process.argv[i + 1], 10) : 0; })();

const wait = (ms) => new Promise(r => setTimeout(r, ms));

const { data: tenant } = await supabase.from('tenants').select('id').eq('slug', 'plus-ultra').single();
if (!tenant) { console.error('tenant not found'); process.exit(1); }

// Pull all ungraded our-work rows (paginated past the 1k cap), recent first so
// an interrupted run still leaves the most postable photos graded.
async function fetchUngraded() {
  const out = []; const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('media_pool')
      .select('id, url, tags, source_bucket, captured_at')
      .eq('tenant_id', tenant.id)
      .in('source_bucket', OUR_WORK_SOURCES)
      .eq('excluded', false)
      .order('captured_at', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error) { console.error('fetch error:', error.message); break; }
    if (!data || !data.length) break;
    for (const r of data) if (!(r.tags || []).includes('vgraded')) out.push(r);
    if (data.length < PAGE) break;
  }
  return out;
}

async function gradeWithRetry(url, tries = 3) {
  for (let a = 0; a < tries; a++) {
    const g = await gradeShowcase(url);
    if (g && g.state !== 'ungraded') return g;
    if (a < tries - 1) await wait(1500 * (a + 1));
  }
  return { state: 'ungraded', score: null };
}

const all = await fetchUngraded();
const todo = limitArg > 0 ? all.slice(0, limitArg) : all;
console.log(`Ungraded our-work photos: ${all.length}. Grading ${todo.length} (concurrency ${CONCURRENCY}).`);

let done = 0, failed = 0, showcase = 0;
const states = {};
let next = 0;
const t0 = Date.now();

async function worker() {
  while (next < todo.length) {
    const m = todo[next++];
    const g = await gradeWithRetry(m.url);
    done++;
    if (!g || g.state === 'ungraded') { failed++; }
    else {
      states[g.state] = (states[g.state] || 0) + 1;
      if (g.state === 'showcase') showcase++;
      const base = (m.tags || []).filter(t => !VTAG.test(t));
      const tags = [...base, 'vgraded', `vstate:${g.state}`, `vscore:${g.score ?? 0}`];
      if (g.material) tags.push(`vmat:${g.material}`);
      const { error } = await supabase.from('media_pool').update({ tags }).eq('id', m.id).eq('tenant_id', tenant.id);
      if (error) { console.error('persist fail', m.id, error.message); failed++; }
    }
    if (done % 100 === 0 || done === todo.length) {
      const rate = done / ((Date.now() - t0) / 1000);
      const eta = rate > 0 ? Math.round((todo.length - done) / rate) : 0;
      console.log(`  ${done}/${todo.length} | showcase=${showcase} failed=${failed} | ${JSON.stringify(states)} | ${rate.toFixed(1)}/s eta ${eta}s`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\nDONE in ${Math.round((Date.now() - t0) / 1000)}s | graded=${done} showcase=${showcase} failed=${failed}`);
console.log('states:', JSON.stringify(states, null, 2));
