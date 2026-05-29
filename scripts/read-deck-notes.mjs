// Read deck sticky notes (Ryujin Proposal Generator) straight from Supabase.
//
// Canonical way for a working session to read the suggestions Mac leaves on a
// deck, without a browser console or the gated service token. Notes sync to the
// deck_notes table (migration 077) when an admin views a deck logged in.
//
// Usage (run from any clone that has a populated .env.local):
//   node --env-file=.env.local scripts/read-deck-notes.mjs [deck_id] [tenant_slug]
//
// Defaults: deck_id=deck-calendar-workflow, tenant_slug=plus-ultra
//
// Uses the Supabase REST API via global fetch, so it needs no node_modules.
// Reads SUPABASE_URL + a service-role key from the environment (.trim() + strips
// the literal quote/\n that .env.local values carry, per the env-local gotcha).

function clean(v) {
  return String(v || '').trim().replace(/^"|"$/g, '').replace(/\\n$/, '').trim();
}

const url = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
const key = clean(
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET ||
  process.env.SUPABASE_KEY
);
const deckId = process.argv[2] || 'deck-calendar-workflow';
const tenantSlug = process.argv[3] || 'plus-ultra';

if (!url || !key) {
  console.error('Missing SUPABASE_URL or a service-role key in the environment.');
  console.error('Run with: node --env-file=.env.local scripts/read-deck-notes.mjs');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function rest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) {
    console.error(`Supabase REST ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

// Resolve tenant (optional scoping; if not found, fall back to deck_id only).
let tenantId = null;
const tenants = await rest(`tenants?slug=eq.${encodeURIComponent(tenantSlug)}&select=id&limit=1`);
if (Array.isArray(tenants) && tenants[0]) tenantId = tenants[0].id;

let q = `deck_notes?deck_id=eq.${encodeURIComponent(deckId)}&select=slide_id,author,text,updated_at&order=slide_id.asc,updated_at.asc`;
if (tenantId) q += `&tenant_id=eq.${tenantId}`;
const notes = await rest(q);

if (!Array.isArray(notes) || notes.length === 0) {
  console.log(`No notes found for deck "${deckId}" (tenant ${tenantSlug}).`);
  process.exit(0);
}

// Group by slide for a readable dump.
const bySlide = {};
for (const n of notes) (bySlide[n.slide_id] ||= []).push(n);

console.log(`# ${notes.length} note(s) on "${deckId}"\n`);
for (const slide of Object.keys(bySlide)) {
  console.log(`## slide: ${slide}`);
  for (const n of bySlide[slide]) {
    console.log(`  - [${n.author}] ${n.text}`);
  }
  console.log('');
}
console.log('---\nRAW JSON:');
console.log(JSON.stringify(notes, null, 2));
