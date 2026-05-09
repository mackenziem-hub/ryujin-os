// One-off: seed the docs table with the Outside Sales Handbook from Plus Ultra/Sales/.
// Reads the markdown file directly, upserts to docs via the Supabase Management API.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env.local');
try {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch {}

const PAT = (process.env.SUPABASE_PAT || '').trim();
const URL_ENV = (process.env.SUPABASE_URL || '').trim();
const ref = URL_ENV.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!PAT || !ref) { console.error('Missing SUPABASE_PAT or SUPABASE_URL'); process.exit(1); }

const TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b';
const SLUG = 'outside-sales-handbook';
const TITLE = '2026 Outside Sales Handbook';
const SUMMARY = 'Tier A 10% self-gen, Tier B 7% company-supplied + 5% marketing. Effective May 15, 2026.';

const HANDBOOK_PATH = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Sales/Outside Sales Handbook 2026 v1 DRAFT.md';
const markdown = readFileSync(HANDBOOK_PATH, 'utf8');

// Pick a dollar-quote tag that doesn't collide with the markdown
let tag = 'PUDOC';
while (markdown.includes(`$${tag}$`)) tag = tag + 'X';
const dq = `$${tag}$`;

const sql = `
insert into docs (tenant_id, slug, title, markdown, summary, status, version)
values ('${TENANT_ID}', '${SLUG}', '${TITLE.replace(/'/g, "''")}', ${dq}${markdown}${dq}, '${SUMMARY.replace(/'/g, "''")}', 'draft', 1)
on conflict (tenant_id, slug) do update set
  title = excluded.title,
  markdown = excluded.markdown,
  summary = excluded.summary,
  version = docs.version + 1
returning id, slug, version;
`;

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await r.text();
if (!r.ok) { console.error(`✗ ${r.status}: ${text}`); process.exit(1); }
console.log(`✓ seeded ${SLUG}`);
console.log(text);
