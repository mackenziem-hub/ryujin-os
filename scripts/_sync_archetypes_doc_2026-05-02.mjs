// Phase 7: sync ARCHETYPES.md → Ryujin docs as kb-archetype-system

import { readFileSync } from 'node:fs';

const BASE = 'https://ryujin-os.vercel.app';
const TENANT = 'plus-ultra';

const file = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/_brain/knowledge/ARCHETYPES.md';
const markdown = readFileSync(file, 'utf8');

const r = await fetch(`${BASE}/api/docs?slug=kb-archetype-system&tenant=${TENANT}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Plus Ultra, Archetype Operating System',
    summary: 'Canonical reference for the 12 Jungian archetypes (Pearson/Mark formalization) mapped to Greek gods and Plus Ultra functions. Evergreen layer that sits on top of every Ryujin chat. Roles define authority, archetypes define voice/lens. People wear multiple archetypes throughout the day; archetypes belong to situations, not people.',
    markdown,
    status: 'draft'
  })
});

const text = await r.text();
if (!r.ok) {
  console.error(`✗ ${r.status} ${text.slice(0, 200)}`);
  process.exit(1);
}
const data = JSON.parse(text);
console.log(`✓ kb-archetype-system v${data.version}  ${markdown.length} chars`);
