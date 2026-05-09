// One-off: push handbook v1.1 + new team-comms SOP to /api/docs.
// Reads markdown source from Plus Ultra folder, PUTs to Ryujin.

import { readFileSync } from 'node:fs';

const BASE = 'https://ryujin-os.vercel.app';
const TENANT = 'plus-ultra';

const docs = [
  {
    slug: 'outside-sales-handbook',
    title: '2026 Outside Sales Handbook',
    summary: 'Tier A 12% / Tier B 8% + 5% referral override. Tier C commercial 7/5/3% with GP cap and Mac pre-approval. Effective May 15, 2026.',
    file: 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Sales/Outside Sales Handbook 2026 v1 DRAFT.md',
    status: 'draft'
  },
  {
    slug: 'commercial-sales-workflow',
    title: 'Commercial Sales Workflow SOP',
    summary: 'Stage-by-stage walkthrough of a self-generated commercial deal. Pre-approval gate, pursuit, proposal, milestone-paid commission. Companion to Handbook Section 3.6 + 4.6.',
    file: 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Sales/Commercial Sales Workflow SOP.md',
    status: 'draft'
  }
];

for (const d of docs) {
  const markdown = readFileSync(d.file, 'utf8');
  const r = await fetch(`${BASE}/api/docs?slug=${encodeURIComponent(d.slug)}&tenant=${TENANT}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: d.title,
      summary: d.summary,
      markdown,
      status: d.status
    })
  });
  const text = await r.text();
  if (!r.ok) {
    console.error(`✗ ${d.slug}: ${r.status} ${text.slice(0, 200)}`);
    process.exit(1);
  }
  const data = JSON.parse(text);
  console.log(`✓ ${d.slug}  v${data.version}  ${markdown.length} chars`);
}
