// Drop legacy shenron-* blob keys AFTER the 7-day verification window.
// DO NOT RUN before 2026-05-21. Pre-flight check: confirm no fetch errors in
// Vercel logs against ryujin-* keys for at least 7 days.
//
// Run: node scripts/_oneshot/_drop_shenron_blobs_2026-05-21.mjs --confirm

import fs from 'node:fs';
import path from 'node:path';
import { list, del } from '@vercel/blob';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Missing BLOB_READ_WRITE_TOKEN.');
  process.exit(1);
}

if (!process.argv.includes('--confirm')) {
  console.error('Add --confirm flag to actually delete. Dry-run below.');
}
const dryRun = !process.argv.includes('--confirm');

const today = new Date();
const safetyDate = new Date('2026-05-21T00:00:00Z');
if (today < safetyDate) {
  console.error(`Refusing to run before ${safetyDate.toISOString()}. Today: ${today.toISOString()}`);
  process.exit(1);
}

const PREFIXES = ['shenron-watchdog-state.json', 'shenron-memory/', 'shenron-snapshot.json'];
const stats = { listed: 0, deleted: 0, failed: 0 };

for (const prefix of PREFIXES) {
  console.log(`\n— Scanning ${prefix}`);
  let cursor;
  do {
    const result = await list({ prefix, cursor, limit: 1000 });
    cursor = result.cursor;
    for (const blob of result.blobs) {
      stats.listed++;
      if (dryRun) {
        console.log(`  · would delete: ${blob.pathname}`);
        continue;
      }
      try {
        await del(blob.url);
        stats.deleted++;
        console.log(`  ✓ deleted: ${blob.pathname}`);
      } catch (err) {
        stats.failed++;
        console.error(`  ✗ failed: ${blob.pathname} :: ${err.message}`);
      }
    }
  } while (cursor);
}

console.log('\n── Summary ──');
console.log(`Listed:  ${stats.listed}`);
console.log(`Deleted: ${stats.deleted}`);
console.log(`Failed:  ${stats.failed}`);
if (dryRun) console.log('(dry-run — re-run with --confirm to delete)');
