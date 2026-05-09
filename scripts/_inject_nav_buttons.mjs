import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const PUBLIC = join(process.cwd(), 'public');
const TAG = '<script src="/assets/nav-buttons.js" defer></script>';

const SKIP = new Set([
  'proposal-client.html',
  'sales-client.html',
  'sub-portal.html',
  'handbook-outside-sales.html',
  'landing.html',
  'login.html',
  'reset-password.html',
  'customer-showcase.html',
  'proposal-715-rt-11.html',
  'doc.html',
  'boot.html',
  'index.html'
]);

const files = readdirSync(PUBLIC).filter(f => f.endsWith('.html'));
let injected = 0, skipped = 0, already = 0;

for (const f of files) {
  if (SKIP.has(f)) { skipped++; continue; }
  const path = join(PUBLIC, f);
  const html = readFileSync(path, 'utf8');
  if (html.includes('nav-buttons.js')) { already++; continue; }
  let out;
  if (html.includes('</head>')) {
    out = html.replace('</head>', `  ${TAG}\n</head>`);
  } else if (html.includes('</body>')) {
    out = html.replace('</body>', `${TAG}\n</body>`);
  } else {
    out = html + '\n' + TAG + '\n';
  }
  writeFileSync(path, out);
  injected++;
  console.log('  injected:', f);
}

console.log(`\nDone. injected=${injected} already=${already} skipped=${skipped} total=${files.length}`);
