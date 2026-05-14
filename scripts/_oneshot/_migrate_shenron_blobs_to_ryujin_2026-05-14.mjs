// Migrate Vercel Blob storage from shenron-* keys to ryujin-* keys.
// Copies (does not delete) so the 7-day rollback window has the originals intact.
//
// Keys migrated:
//   shenron-watchdog-state.json   → ryujin-watchdog-state.json
//   shenron-memory/<key>          → ryujin-memory/<key>   (all under prefix)
//   shenron-snapshot.json         → ryujin-snapshot.json
//
// Deploy code first with dual-read fallback, run this script, verify, then
// 7 days later run _drop_shenron_blobs_2026-05-21.mjs to clean up originals.
//
// Run: node scripts/_oneshot/_migrate_shenron_blobs_to_ryujin_2026-05-14.mjs

import fs from 'node:fs';
import path from 'node:path';
import { list, copy } from '@vercel/blob';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Missing BLOB_READ_WRITE_TOKEN in environment (.env.local or shell).');
  process.exit(1);
}

const TARGETS = [
  { kind: 'single', oldKey: 'shenron-watchdog-state.json', newKey: 'ryujin-watchdog-state.json' },
  { kind: 'prefix', oldKey: 'shenron-memory/',            newKey: 'ryujin-memory/' },
  { kind: 'single', oldKey: 'shenron-snapshot.json',      newKey: 'ryujin-snapshot.json' }
];

const counts = { found: 0, copied: 0, skipped: 0, failed: 0 };

for (const target of TARGETS) {
  console.log(`\n— ${target.oldKey} → ${target.newKey}`);

  // Vercel Blob list() with a single-file prefix still returns multiple matches when
  // pathnames have hashed suffixes appended by put(). Iterate all matches.
  let cursor;
  do {
    const result = await list({ prefix: target.oldKey, cursor, limit: 1000 });
    cursor = result.cursor;
    for (const blob of result.blobs) {
      counts.found++;

      let newPathname;
      if (target.kind === 'single') {
        // For singletons the blob.pathname may be "shenron-snapshot.json" exactly
        // or "shenron-snapshot-{hash}.json" if Vercel added randomness.
        // We always normalise to the canonical new name (no hash suffix).
        newPathname = target.newKey;
      } else {
        // Prefix mode: keep the suffix after the old prefix.
        const suffix = blob.pathname.slice(target.oldKey.length);
        if (!suffix) {
          counts.skipped++;
          console.log(`  · skip (empty suffix): ${blob.pathname}`);
          continue;
        }
        newPathname = target.newKey + suffix;
      }

      // Check whether the destination already exists. If so, skip — assume prior
      // run partially completed.
      const existing = await list({ prefix: newPathname, limit: 1 });
      if (existing.blobs.length > 0 && existing.blobs[0].pathname === newPathname) {
        counts.skipped++;
        console.log(`  · skip (exists): ${newPathname}`);
        continue;
      }

      try {
        const result = await copy(blob.url, newPathname, {
          access: 'public',
          addRandomSuffix: false,
          contentType: blob.contentType || 'application/json'
        });
        counts.copied++;
        console.log(`  ✓ copied: ${blob.pathname} → ${result.pathname}`);
      } catch (err) {
        counts.failed++;
        console.error(`  ✗ failed: ${blob.pathname} → ${newPathname} :: ${err.message}`);
      }
    }
  } while (cursor);
}

console.log('\n── Summary ──');
console.log(`Found:   ${counts.found}`);
console.log(`Copied:  ${counts.copied}`);
console.log(`Skipped: ${counts.skipped} (already existed at destination)`);
console.log(`Failed:  ${counts.failed}`);

if (counts.failed > 0) {
  console.error('\n⚠ Some copies failed — review above and re-run after fixing.');
  process.exit(1);
}

console.log('\n✅ Migration complete. Originals preserved for 7-day rollback window.');
console.log('   Schedule: drop originals 2026-05-21 via _drop_shenron_blobs_2026-05-21.mjs');
