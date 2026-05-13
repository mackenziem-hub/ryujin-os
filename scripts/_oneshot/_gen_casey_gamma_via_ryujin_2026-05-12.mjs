// Generate consolidated Casey Realty Gamma deck via Ryujin's prod /api/gamma-generate endpoint.
// 1. Insert/update docs row with the consolidated source markdown.
// 2. POST /api/gamma-generate?slug=... to fire generation.
// 3. Poll GET /api/gamma-generate?slug=... until complete.
// 4. PATCH both Casey Realty proposal pages with the new Gamma URL.
import { readFileSync, writeFileSync } from 'node:fs';

const env = {};
for (const path of ['C:/Users/macke/OneDrive/Desktop/Ryujin/ryujin-os/.env.local']) {
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
}

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const RYUJIN_BASE = 'https://ryujin-os.vercel.app';
const TENANT_SLUG = 'plus-ultra';
const DOC_SLUG = 'casey-realty-bundle';
const DOC_TITLE = 'Casey Realty — Commercial Roof Inspection Bundle';

const SOURCE_PATH = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Proposals/_GAMMA_SOURCE_casey_realty_consolidated_2026-05-12.md';
const sourceMd = readFileSync(SOURCE_PATH, 'utf8');

async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      'apikey': SUPABASE_KEY,
      'authorization': `Bearer ${SUPABASE_KEY}`,
      'content-type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { _raw: t }; }
  if (!r.ok) throw new Error(`${path} ${r.status}: ${typeof j === 'object' ? JSON.stringify(j).slice(0, 300) : t.slice(0, 300)}`);
  return j;
}

// 1. Find tenant
const tenants = await sb(`/rest/v1/tenants?slug=eq.${TENANT_SLUG}&select=id`);
if (!tenants[0]) throw new Error('tenant plus-ultra not found');
const tenantId = tenants[0].id;
console.log('tenant:', tenantId);

// 2. Upsert docs row
const existing = await sb(`/rest/v1/docs?tenant_id=eq.${tenantId}&slug=eq.${DOC_SLUG}&select=id`);
let docId;
if (existing[0]) {
  docId = existing[0].id;
  await sb(`/rest/v1/docs?id=eq.${docId}`, {
    method: 'PATCH',
    headers: { 'prefer': 'return=minimal' },
    body: JSON.stringify({
      title: DOC_TITLE,
      markdown: sourceMd,
      gamma_generation_id: null,
      gamma_url: null
    })
  });
  console.log('doc updated:', docId);
} else {
  const inserted = await sb(`/rest/v1/docs`, {
    method: 'POST',
    headers: { 'prefer': 'return=representation' },
    body: JSON.stringify({
      tenant_id: tenantId,
      slug: DOC_SLUG,
      title: DOC_TITLE,
      markdown: sourceMd
    })
  });
  docId = inserted[0]?.id;
  console.log('doc inserted:', docId);
}

// 3. Fire generation
console.log('\nfiring /api/gamma-generate...');
const fire = await fetch(`${RYUJIN_BASE}/api/gamma-generate?slug=${DOC_SLUG}`, {
  method: 'POST',
  headers: { 'x-tenant-id': TENANT_SLUG }
});
const fireT = await fire.text();
console.log('fire:', fire.status, fireT);
if (!fire.ok) process.exit(1);
const { generationId } = JSON.parse(fireT);
console.log('generationId:', generationId);

// 4. Poll
console.log('\npolling...');
let url = null;
for (let i = 0; i < 60; i++) {  // 60 × 10s = 10 min max
  const poll = await fetch(`${RYUJIN_BASE}/api/gamma-generate?slug=${DOC_SLUG}`, {
    headers: { 'x-tenant-id': TENANT_SLUG }
  });
  const pj = await poll.json();
  console.log(`  t+${i*10}s  status=${pj.status}  url=${pj.url || '-'}`);
  if (pj.status === 'completed' && pj.url) { url = pj.url; break; }
  if (pj.status === 'failed' || pj.status === 'error') { console.error('FAILED', pj); process.exit(2); }
  await new Promise(r => setTimeout(r, 10_000));
}
if (!url) { console.error('timed out without URL'); process.exit(3); }

console.log('\nFINAL GAMMA URL:', url);

// 5. PATCH both proposals
for (const share of ['plus-ultra-56', 'plus-ultra-57']) {
  const r = await sb(`/rest/v1/estimates?share_token=eq.${share}`, {
    method: 'PATCH',
    headers: { 'prefer': 'return=minimal' },
    body: JSON.stringify({
      custom_prices: {
        _gamma_deck_url: url,
        _gamma_deck_label: 'View Casey Realty Inspection Bundle'
      }
    })
  });
  console.log(`  patched ${share}`);
}

writeFileSync(
  'C:/Users/macke/.claude/projects/C--Users-macke/62e341ac-744e-4c4e-9722-251a60294feb/tool-results/casey_gamma_final.json',
  JSON.stringify({ generationId, url, completed_at: new Date().toISOString() }, null, 2)
);
console.log('\nDONE.');
