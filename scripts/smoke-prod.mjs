#!/usr/bin/env node
// Post-deploy smoke for the CUSTOMER-FACING prod surfaces. Fails loud, exits
// non-zero on any failure. Run this immediately after every `vercel --prod` so a
// deploy clobber (the Jun 21 2026 incident: every /p/ proposal link 404'd for
// ~9.5h, undetected until a link was clicked) is caught in two minutes, not nine
// hours.
//
// Usage:
//   node scripts/smoke-prod.mjs [base-url]        public routes only
//   node --env-file=.env.local scripts/smoke-prod.mjs   also checks /api/snapshot
//   base-url defaults to https://ryujin-os.vercel.app (or SMOKE_BASE env)
//
// The headline check is /p/__canary__ : a synthetic slug. A healthy /p/ rewrite
// serves the static renderer (200) for ANY slug, so it tests the exact clobber
// failure mode (the rewrite rule getting dropped) without depending on a real
// proposal instance.

const BASE = (process.argv[2] || process.env.SMOKE_BASE || 'https://ryujin-os.vercel.app').replace(/\/$/, '');
const TOKEN = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
const TENANT = (process.env.SMOKE_TENANT || 'plus-ultra').trim();

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' :: ' + detail : ''}`);
}

async function expect200(name, path, headers = {}) {
  try {
    const r = await fetch(`${BASE}${path}`, { redirect: 'follow', cache: 'no-store', headers, signal: AbortSignal.timeout(20000) });
    record(name, r.status === 200, `status ${r.status} -> ${path}`);
  } catch (e) {
    record(name, false, `${path} :: ${e.message}`);
  }
}

console.log(`Prod smoke vs ${BASE}\n`);

// Customer-facing routes (no auth). The /p/ rewrite is the clobber canary.
await expect200('rewrite /p/__canary__ (proposal links)', '/p/__canary__');
await expect200('legacy proposal ?share=', '/proposal-client.html?share=plus-ultra-77');
await expect200('site /login', '/login.html');
await expect200('decks panel', '/decks.html');
await expect200('version endpoint', '/api/version');

// API layer (authed). Skipped with a note if no token is provided.
if (TOKEN) {
  await expect200('api/snapshot (authed)', '/api/snapshot', { Authorization: `Bearer ${TOKEN}`, 'x-tenant-id': TENANT });
} else {
  console.log('[SKIP] api/snapshot (authed) :: no RYUJIN_SERVICE_TOKEN; run with --env-file=.env.local to include it');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed.`);
if (failed.length) {
  console.error(`SMOKE FAILED: ${failed.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
console.log('All prod surfaces healthy.');
