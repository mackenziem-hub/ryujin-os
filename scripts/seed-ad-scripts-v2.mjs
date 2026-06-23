// One-off: reseed the Ad Script Studio with the broken-out, versioned (v1/v2) library.
//
// Reads the four cluster JSON files produced for the v2 rebuild, wipes every existing
// adscript:* row, then POSTs each item as a single row carrying TWO versions
// (v1 = current copy, v2 = Jewels-playbook rebuild) with v2 published (active).
//
//   node scripts/seed-ad-scripts-v2.mjs [jsonDir]
//
//   RYUJIN_SERVICE_TOKEN   required (Bearer)
//   BASE                   optional, default https://ryujin-os.vercel.app
//   TENANT                 optional, default plus-ultra
//   jsonDir argv           optional, default the _brain/adstudio-v2 folder
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.BASE || 'https://ryujin-os.vercel.app').replace(/\/$/, '');
const TENANT = process.env.TENANT || 'plus-ultra';
const TOKEN = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
const DIR = process.argv[2] || 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/_brain/adstudio-v2';
const FILES = ['seq.json', 'scripts.json', 'ads.json', 'funnel.json'];

if (!TOKEN) { console.error('RYUJIN_SERVICE_TOKEN missing'); process.exit(1); }

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${TOKEN}`,
  'x-tenant-id': TENANT,
};

async function api(method, urlPath, body) {
  const r = await fetch(`${BASE}${urlPath}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${urlPath} -> ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

function kindFor(group) {
  return group === 'Shoot scripts' ? 'script' : 'reference';
}

async function main() {
  // 1) load + flatten all items
  const items = [];
  for (const f of FILES) {
    const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    (d.items || []).forEach((it, i) => items.push({ ...it, _sort: i }));
  }
  console.log(`loaded ${items.length} items from ${FILES.length} files`);

  // 2) wipe existing adscript rows
  const existing = await api('GET', '/api/ad-scripts');
  const rows = existing.scripts || [];
  console.log(`deleting ${rows.length} existing rows...`);
  for (const row of rows) {
    await api('DELETE', `/api/ad-scripts?id=${encodeURIComponent(row.id)}`);
  }

  // 3) seed each item with v1 + v2, v2 published
  let ok = 0;
  for (const it of items) {
    const body = {
      slug: it.slug,
      name: it.name,
      kind: kindFor(it.group),
      category: it.category,
      meta: { group: it.group },
      sort_order: it._sort,
      activeVersion: 'v2',
      versions: [
        { id: 'v1', label: 'v1', source: it.v1_source || '', html: it.v1_html || '' },
        { id: 'v2', label: 'v2', source: it.v2_source || '', html: it.v2_html || '' },
      ],
    };
    await api('POST', '/api/ad-scripts', body);
    ok++;
    process.stdout.write(`  + ${it.group} / ${it.name}\n`);
  }
  console.log(`\nseeded ${ok}/${items.length} items`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
