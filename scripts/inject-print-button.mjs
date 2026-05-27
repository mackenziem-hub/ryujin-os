#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SNIPPET = `<!-- pu-print-btn -->
<style>
@media print { .pu-print-btn { display: none !important; } }
.pu-print-btn { position: fixed; top: 16px; right: 16px; z-index: 99999; background: #0f172a; color: #fff; border: 0; padding: 8px 14px; font: 600 13px system-ui, -apple-system, Segoe UI, sans-serif; border-radius: 8px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.18); display: inline-flex; align-items: center; gap: 6px; }
.pu-print-btn:hover { background: #1e293b; }
</style>
<button class="pu-print-btn" type="button" onclick="window.print()" aria-label="Print or save as PDF">&#9000; Print / PDF</button>
`;

const DIR = 'public';
const MARKER = 'pu-print-btn';
const files = readdirSync(DIR).filter(f => f.endsWith('.html'));

let injected = 0, skipped = 0, noBody = 0;
for (const f of files) {
  const path = join(DIR, f);
  const html = readFileSync(path, 'utf8');
  if (html.includes(MARKER)) { skipped++; continue; }
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) { noBody++; console.log('no </body>:', f); continue; }
  const out = html.slice(0, idx) + SNIPPET + html.slice(idx);
  writeFileSync(path, out);
  injected++;
}
console.log(`injected: ${injected}, skipped (already had marker): ${skipped}, no </body>: ${noBody}`);
