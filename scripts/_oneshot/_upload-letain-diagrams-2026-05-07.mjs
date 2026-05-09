// Upload the 28 Russell envelope diagrams to Vercel Blob and patch
// estimate #44's custom_prices._envelope.media to point at them.
import { readFileSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { put } from '@vercel/blob';
import { createClient } from '@supabase/supabase-js';

// Load .env.production
const envPath = resolve(process.cwd(), '.env.production');
try {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch (e) {
  console.error('No .env.production found'); process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY?.trim();
const BLOB_TOKEN  = process.env.BLOB_READ_WRITE_TOKEN?.trim();

if (!SUPABASE_URL || !SUPABASE_KEY || !BLOB_TOKEN) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / BLOB_READ_WRITE_TOKEN'); process.exit(1);
}

const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
const TENANT_SLUG = 'plus-ultra';
const ESTIMATE_ID = 'c7240b24-fb20-49c1-80c5-4babe1dc9d4c';

const FOLDER = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/28 Russell St- Peticodiac';

// Map source filename → media key + a clean, customer-facing slug
const FILES = [
  { src: 'cover photo.png',                    key: 'cover',            mime: 'image/png' },
  { src: 'after photo.png',                    key: 'after_shingle',    mime: 'image/png' },
  { src: 'metal roof.png',                     key: 'after_metal',      mime: 'image/png' },
  { src: 'gutters.png',                        key: 'after_gutters',    mime: 'image/png' },
  { src: 'siding.png',                         key: 'siding_closeup',   mime: 'image/png' },
  { src: 'Overview diagram.png',               key: 'envelope_diagram', mime: 'image/png' },
  { src: 'complete exterior system.png',       key: 'complete_system',  mime: 'image/png' },
  { src: 'Certainteed Cedar Imitation Siding.png', key: 'cedar_shake',  mime: 'image/png' }
];

const uploaded = {};
for (const f of FILES) {
  const path = resolve(FOLDER, f.src);
  try {
    statSync(path);
  } catch {
    console.log(`  SKIP ${f.src} (not found)`);
    continue;
  }
  const buf = readFileSync(path);
  const blobPath = `tenants/${TENANT_SLUG}/estimates/${ESTIMATE_ID}/envelope/${Date.now()}-${f.key}.png`;
  console.log(`  ↑ ${f.src} → ${blobPath} (${(buf.length/1024).toFixed(0)} KB)`);
  const blob = await put(blobPath, buf, { access: 'public', contentType: f.mime, token: BLOB_TOKEN });
  uploaded[f.key] = blob.url;
  console.log(`    ✓ ${blob.url}`);
}

console.log('\nUploaded media:', JSON.stringify(uploaded, null, 2));

// Patch _envelope.media on the estimate
const { data: est, error: estErr } = await supa
  .from('estimates')
  .select('custom_prices')
  .eq('id', ESTIMATE_ID)
  .single();

if (estErr) { console.error(estErr); process.exit(1); }

const cp = { ...(est.custom_prices || {}) };
const env = { ...(cp._envelope || {}) };
env.media = { ...(env.media || {}), ...uploaded };
cp._envelope = env;

const { error: upErr } = await supa
  .from('estimates')
  .update({ custom_prices: cp })
  .eq('id', ESTIMATE_ID);

if (upErr) { console.error(upErr); process.exit(1); }
console.log('\n✓ Estimate #44 _envelope.media patched');
