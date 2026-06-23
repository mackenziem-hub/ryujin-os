// One-shot security backfill (F7): rotate guessable estimate share tokens.
//
// The classic estimates.share_token was minted as `${slug}-${estimate_number}`
// (e.g. plus-ultra-77), which let anyone enumerate /api/proposal?share=plus-ultra-1..N
// and read every customer's PII, pricing, and signed contract. api/estimates.js now
// mints 192-bit random tokens going forward; this rotates the existing deterministic
// ones to random so the enumeration hole closes.
//
// Vanity links + the canary stay intact because the ONE estimate with a hardcoded
// rewrite/canary reference (plus-ultra-77, Catherine Ablak / 62 Charlotte) is rotated
// to a PRE-AGREED value (CATHERINE_TOKEN) that vercel.json + api/agents/canary.js were
// updated to match in the same deploy.
//
// Usage:
//   node scripts/rotate_share_tokens_2026-06-23.mjs            # dry-run (prints plan)
//   node scripts/rotate_share_tokens_2026-06-23.mjs --apply    # execute
//
// Idempotent: a second run finds no `plus-ultra-%` tokens and is a no-op.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const APPLY = process.argv.includes('--apply');

// Tokens that other code hardcodes must rotate to a KNOWN value, not a random one,
// so every reference stays consistent. These are all updated in the SAME deploy:
//   plus-ultra-77 (Catherine, 62 Charlotte) -> vercel.json vanity rewrite + canary + static beacon + smoke
//   plus-ultra-98 (Desiree, 67 Charlotte)   -> static page open-tracking beacon
const PINNED = {
  'plus-ultra-77': 'JI639ircHmr2JGEelAhJRO6eAkPBm482',
  'plus-ultra-98': 'QB4pR00VTJxYSgts98F4rn10ZQYWdPm8',
};

const newToken = () => randomBytes(24).toString('base64url');

const sb = createClient(url, key);

const { data: tenant } = await sb.from('tenants').select('id, slug').eq('slug', 'plus-ultra').single();
if (!tenant) { console.error('plus-ultra tenant not found'); process.exit(1); }

// All estimates whose share_token still uses the guessable plus-ultra-<...> form.
const { data: rows, error } = await sb
  .from('estimates')
  .select('id, estimate_number, share_token, customer:customers(full_name)')
  .eq('tenant_id', tenant.id)
  .like('share_token', 'plus-ultra-%');
if (error) { console.error('query failed:', error.message); process.exit(1); }

console.log(`\n${APPLY ? 'APPLYING' : 'DRY-RUN'}: ${rows.length} guessable token(s) to rotate:\n`);

let done = 0, failed = 0;
for (const r of rows) {
  const pinned = PINNED[r.share_token];
  const next = pinned || newToken();
  const who = r.customer?.full_name || '(no customer)';
  const tag = pinned ? '  <- pinned (hardcoded refs updated in same deploy)' : '';
  console.log(`  #${r.estimate_number ?? '?'} ${who.padEnd(26)} ${r.share_token.padEnd(28)} -> ${next}${tag}`);
  if (APPLY) {
    const { error: upErr } = await sb.from('estimates').update({ share_token: next }).eq('id', r.id);
    if (upErr) { console.error(`    FAILED: ${upErr.message}`); failed++; } else { done++; }
  }
}

console.log(`\n${APPLY ? `Done. rotated=${done} failed=${failed}` : 'Dry-run only. Re-run with --apply to execute.'}`);
if (APPLY && failed) process.exit(1);
