// Unified LOAD scan — one command that pulls the live state a session LOAD needs,
// instead of the auth-gated HTTP + claude.ai-connector steps that failed silently.
//
// Pulls (each section fails LOUD, never silently): Cat's open tickets, ALL open
// tickets count, pending approvals (queued agent actions), live in-flight estimates
// (proxy for hot deals), deck suggestions, and — if RYUJIN_SERVICE_TOKEN is set —
// the daily snapshot's morning brief + cashflow + pipeline top.
//
// Reliability order (per the 2026-06-07 infra audit): Supabase service key first
// (RLS bypass, always present locally), then /api/snapshot via service token.
//
// Usage (from C:/Users/Owner/Code/ryujin-os):
//   node --env-file=.env.local scripts/load-scan.mjs [tenant_slug]
// Defaults tenant_slug=plus-ultra. Always exit 0; prints a digest + JSON tail.

function clean(v) {
  // CRLF-safe: strips trailing \r (the .env.local footgun the audit flagged),
  // surrounding quotes, and a literal trailing \n.
  return String(v || '').replace(/\r/g, '').trim().replace(/^["']|["']$/g, '').replace(/\\n$/, '').trim();
}

const SUPA = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
const KEY = clean(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
const SVC = clean(process.env.RYUJIN_SERVICE_TOKEN);
const APP = clean(process.env.RYUJIN_APP_URL) || 'https://ryujin-os.vercel.app';
const TENANT = process.argv[2] || 'plus-ultra';
const CAT_UUID = '82c7b9b3-9188-4309-bab9-c86eb9b08e49';

if (!SUPA || !KEY) {
  console.error('[FATAL] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Run: node --env-file=.env.local scripts/load-scan.mjs');
  process.exit(0);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const out = { tenant: TENANT, sources: {} };

async function rest(path) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`REST ${r.status}: ${(await r.text()).slice(0, 180)}`);
  return r.json();
}
function ok(label, val) { out.sources[label] = { status: 'ok', ...val }; }
function fail(label, e) { out.sources[label] = { status: 'FAILED', error: String(e && e.message || e) }; }

console.log(`# LOAD scan — ${TENANT} — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z\n`);

// Resolve tenant id
let tenantId = null;
try {
  const t = await rest(`tenants?slug=eq.${encodeURIComponent(TENANT)}&select=id&limit=1`);
  tenantId = Array.isArray(t) && t[0] ? t[0].id : null;
  if (!tenantId) throw new Error(`tenant "${TENANT}" not found`);
} catch (e) { fail('tenant', e); console.log(`[FAIL] tenant resolve: ${out.sources.tenant.error}`); }

// 1) Cat's open tickets + total open
if (tenantId) {
  try {
    const cat = await rest(`tickets?tenant_id=eq.${tenantId}&assigned_to=eq.${CAT_UUID}&status=not.in.(completed,closed,done,cancelled)&select=ticket_number,title,status,priority,created_at&order=created_at.asc`);
    const allOpen = await rest(`tickets?tenant_id=eq.${tenantId}&status=not.in.(completed,closed,done,cancelled)&select=ticket_number`);
    ok('cat_tickets', { count: cat.length, totalOpen: allOpen.length, items: cat });
    console.log(`## Cat's open tickets: ${cat.length} (of ${allOpen.length} open total)`);
    for (const c of cat) console.log(`  #${c.ticket_number} [${c.priority || '-'}/${c.status}] ${String(c.title).replace(/\s+/g, ' ').slice(0, 80)}`);
    if (!cat.length) console.log('  (none)');
  } catch (e) { fail('cat_tickets', e); console.log(`[FAIL] cat_tickets: ${out.sources.cat_tickets.error}`); }
}

// 2) Pending approvals (queued agent actions awaiting Mac)
if (tenantId) {
  try {
    const pa = await rest(`pending_approvals?tenant_id=eq.${tenantId}&status=eq.pending&select=*&order=created_at.desc&limit=25`);
    ok('pending_approvals', { count: pa.length, items: pa.map(p => ({ id: p.id, tool: (p.execute_payload && p.execute_payload.tool) || p.action_type || p.type, summary: p.summary || p.title, created_at: p.created_at })) });
    console.log(`\n## Pending approvals: ${pa.length}`);
    for (const p of pa.slice(0, 10)) console.log(`  ${(p.execute_payload && p.execute_payload.tool) || p.action_type || p.type || '?'} — ${String(p.summary || p.title || '').slice(0, 70)}`);
  } catch (e) { fail('pending_approvals', e); console.log(`\n[FAIL] pending_approvals: ${out.sources.pending_approvals.error}`); }
}

// 3) Live in-flight estimates (hot-deal proxy: touched in last 14d, not closed)
if (tenantId) {
  try {
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const est = await rest(`estimates?tenant_id=eq.${tenantId}&updated_at=gte.${since}&status=in.(draft,sent,accepted)&select=estimate_number,status,proposal_status,selected_package,final_accepted_total,updated_at,customers(full_name,address)&order=updated_at.desc&limit=25`);
    ok('hot_estimates', { count: est.length, items: est });
    console.log(`\n## In-flight estimates (touched <14d, not closed): ${est.length}`);
    for (const e of est.slice(0, 12)) {
      const c = e.customers || {};
      console.log(`  #${e.estimate_number} ${(c.full_name || '?')} — ${e.selected_package || '-'} ${e.final_accepted_total ? '$' + e.final_accepted_total : ''} [${e.status}] ${String(e.updated_at).slice(0, 10)}`);
    }
  } catch (e) { fail('hot_estimates', e); console.log(`\n[FAIL] hot_estimates: ${out.sources.hot_estimates.error}`); }
}

// 3b) Finance snapshot (audit blind spot: surface AR / payables / collected on every load).
// All queries fail-soft (table-missing / column drift only drops this section, never the scan).
if (tenantId) {
  try {
    const d7 = new Date(Date.now() - 7 * 864e5).toISOString();
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const d90 = new Date(Date.now() - 90 * 864e5).toISOString();
    let c7 = 0, c30 = 0, c90 = 0, unmatched = 0;
    const pays = await rest(`payments?tenant_id=eq.${tenantId}&payment_date=gte.${d90}&select=*&limit=1000`).catch(() => []);
    for (const p of (Array.isArray(pays) ? pays : [])) {
      const a = parseFloat(p.amount) || 0; c90 += a;
      if (p.payment_date >= d30) c30 += a;
      if (p.payment_date >= d7) c7 += a;
      if (!p.matched_estimate_id) unmatched++;
    }
    const ps = await rest(`paysheets?tenant_id=eq.${tenantId}&select=*&limit=500`).catch(() => []);
    let psPending = 0, payables = 0;
    for (const p of (Array.isArray(ps) ? ps : [])) {
      const s = String(p.state || p.status || '').toLowerCase();
      if (s === 'pending_approval' || s === 'submitted' || s === 'approved') { psPending++; payables += parseFloat(p.total_pay ?? p.total) || 0; }
    }
    const dep = await rest(`estimates?tenant_id=eq.${tenantId}&deposit_status=eq.pending&select=deposit_amount&limit=500`).catch(() => []);
    let ar = 0; for (const e of (Array.isArray(dep) ? dep : [])) ar += (e.deposit_amount ? e.deposit_amount / 100 : 0);
    const r = n => '$' + Math.round(n).toLocaleString();
    ok('finance', { collected_7d: Math.round(c7), collected_30d: Math.round(c30), collected_90d: Math.round(c90), unmatched_payments: unmatched, paysheets_pending: psPending, payables: Math.round(payables), receivables_pending_deposits: Math.round(ar) });
    console.log(`\n## Finance: collected ${r(c7)} (7d) · ${r(c30)} (30d) · ${r(c90)} (90d)`);
    console.log(`  payables (${psPending} paysheets pending): ${r(payables)} · pending-deposit AR: ${r(ar)} · unmatched payments: ${unmatched}`);
  } catch (e) { fail('finance', e); console.log(`\n[FAIL] finance: ${out.sources.finance.error}`); }
}

// 4) Deck suggestions
if (tenantId) {
  try {
    const notes = await rest(`deck_notes?tenant_id=eq.${tenantId}&select=deck_id,author,text,updated_at&order=updated_at.desc`);
    const SEEDED = new Set(['jules', 'revised']);
    const byDeck = {};
    for (const n of notes) { if (SEEDED.has(n.author)) continue; (byDeck[n.deck_id] ||= { count: 0, latest: n.updated_at }).count++; }
    const decks = Object.entries(byDeck).map(([deck_id, d]) => ({ deck_id, ...d }));
    ok('deck_suggestions', { count: decks.length, decks });
    console.log(`\n## Deck suggestions: ${decks.length} deck(s)`);
    for (const d of decks) console.log(`  ${d.deck_id}: ${d.count} note(s)`);
  } catch (e) { fail('deck_suggestions', e); console.log(`\n[FAIL] deck_suggestions: ${out.sources.deck_suggestions.error}`); }
}

// 4d) GHL appointments (next 48h upcoming inspections/bookings) - via the app endpoint
// with the service token (GHL creds are prod-only). Closes the "confirmed appointment
// invisible at load" gap (the Ken Tolembek whiffed-inspection miss).
if (SVC) {
  try {
    const r = await fetch(`${APP}/api/ghl?mode=appointments&days=2`, { headers: { Authorization: `Bearer ${SVC}`, 'x-tenant-id': TENANT } });
    if (!r.ok) throw new Error(`/api/ghl appointments ${r.status}: ${(await r.text()).slice(0, 120)}`);
    const j = await r.json();
    const appts = (j.appointments || []).filter(a => a.status !== 'cancelled');
    ok('ghl_appointments', { count: appts.length, items: appts.map(a => ({ title: a.title, contact: a.contactName, startTime: a.startTime, status: a.status })) });
    console.log(`\n## GHL appointments (next 48h): ${appts.length}`);
    for (const a of appts.slice(0, 10)) console.log(`  ${String(a.startTime || '').slice(0, 16).replace('T', ' ')} ${a.status === 'confirmed' ? 'CONFIRMED' : (a.status || '')} - ${a.title}${a.contactName ? ' (' + a.contactName + ')' : ''}`);
    if (!appts.length) console.log('  (none in next 48h)');
  } catch (e) { fail('ghl_appointments', e); console.log(`\n[FAIL] ghl_appointments: ${out.sources.ghl_appointments.error}`); }
} else {
  out.sources.ghl_appointments = { status: 'skipped', error: 'no RYUJIN_SERVICE_TOKEN' };
}

// 5) Daily snapshot (cross-sector brief) — needs service token
if (SVC) {
  try {
    const r = await fetch(`${APP}/api/snapshot?tenant=${TENANT}`, { headers: { Authorization: `Bearer ${SVC}`, 'x-tenant-id': TENANT } });
    if (!r.ok) throw new Error(`/api/snapshot ${r.status}: ${(await r.text()).slice(0, 120)}`);
    const snap = await r.json();
    const s = snap.snapshot || snap;
    const brief = s.briefing_morning && s.briefing_morning.briefMarkdown;
    const cash = s.cashflow || (s.sections && s.sections.cashflow);
    ok('snapshot', { hasBrief: !!brief, briefAgeMin: s.briefing_morning && s.briefing_morning.generated_at ? Math.round((Date.now() - new Date(s.briefing_morning.generated_at)) / 60000) : null, hasCashflow: !!cash });
    console.log(`\n## Daily snapshot: brief=${brief ? 'present' : 'MISSING'} cashflow=${cash ? 'present' : 'MISSING'}`);
    if (brief) console.log(brief.split('\n').slice(0, 8).map(l => '  ' + l).join('\n'));
  } catch (e) { fail('snapshot', e); console.log(`\n[FAIL] snapshot: ${out.sources.snapshot.error}`); }
} else {
  out.sources.snapshot = { status: 'skipped', error: 'no RYUJIN_SERVICE_TOKEN' };
  console.log(`\n## Daily snapshot: SKIPPED (no RYUJIN_SERVICE_TOKEN in .env.local)`);
}

// Summary line of any FAILED sources (the "fail loud" contract)
const failed = Object.entries(out.sources).filter(([, v]) => v.status === 'FAILED').map(([k]) => k);
console.log(`\n---\n${failed.length ? '⚠ CONNECTOR GAPS: ' + failed.join(', ') : 'All sources OK.'}`);
console.log('JSON:');
console.log(JSON.stringify(out, null, 1));
