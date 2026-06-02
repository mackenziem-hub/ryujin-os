import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
function clean(v) { return String(v || '').replace(/\\n/g, '').replace(/\n/g, '').trim(); }
const sb = createClient(clean(process.env.SUPABASE_URL), clean(process.env.SUPABASE_SERVICE_KEY));

const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b';

// 1. Sample a real companycam_archive_photos row and dump every column
console.log('=== one photo row, every column ===');
const { data: photo } = await sb.from('companycam_archive_photos').select('*').eq('tenant_id', TENANT).limit(1).maybeSingle();
if (photo) {
  for (const [k, v] of Object.entries(photo)) {
    let display = v;
    if (typeof v === 'object' && v !== null) display = JSON.stringify(v).slice(0, 300);
    else if (typeof v === 'string') display = v.slice(0, 200);
    console.log(`  ${k}:`, display);
  }
}

// 2. Sample a project row
console.log('\n=== one project row, every column ===');
const { data: proj } = await sb.from('companycam_archive_projects').select('*').eq('tenant_id', TENANT).limit(1).maybeSingle();
if (proj) {
  for (const [k, v] of Object.entries(proj)) {
    let display = v;
    if (typeof v === 'object' && v !== null) display = JSON.stringify(v).slice(0, 500);
    else if (typeof v === 'string') display = v.slice(0, 200);
    console.log(`  ${k}:`, display);
  }
}

// 3. Count how many photos have caption that ISN'T '[object Object]'
console.log('\n=== caption health ===');
const { count: totalPhotos } = await sb.from('companycam_archive_photos').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT);
const { count: brokenCaptions } = await sb.from('companycam_archive_photos').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT).eq('caption', '[object Object]');
const { count: nullCaptions } = await sb.from('companycam_archive_photos').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT).is('caption', null);
console.log('total photos:', totalPhotos);
console.log('caption = "[object Object]":', brokenCaptions);
console.log('caption is null:', nullCaptions);
console.log('caption looks real (other):', (totalPhotos||0) - (brokenCaptions||0) - (nullCaptions||0));

// 4. Spot check a few photos for genuine non-broken captions
console.log('\n=== sample photos with real captions ===');
const { data: realCap } = await sb.from('companycam_archive_photos')
  .select('id, caption, tags, url_source')
  .eq('tenant_id', TENANT)
  .neq('caption', '[object Object]')
  .not('caption', 'is', null)
  .limit(10);
(realCap || []).forEach(p => console.log(`  caption: "${p.caption?.slice(0,100)}" | tags: "${p.tags?.slice(0,80)}"`));

// 5. Does the import script exist? What did it pull?
console.log('\n=== sample tags ===');
const { data: tagSample } = await sb.from('companycam_archive_photos')
  .select('tags')
  .eq('tenant_id', TENANT)
  .not('tags', 'is', null)
  .neq('tags', '')
  .limit(10);
(tagSample || []).forEach(p => console.log(`  tags: ${p.tags}`));
