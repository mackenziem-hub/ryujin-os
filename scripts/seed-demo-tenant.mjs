// ═══════════════════════════════════════════════════════════════
// RYUJIN OS — DEMO TENANT SEED  (DEMO TENANT ONLY)
// ═══════════════════════════════════════════════════════════════
//
// Provisions a clean, demo-able second tenant end to end: tenant row,
// tenant_settings (branding + rates), the full offer set (cloned live
// from plus-ultra so it never drifts), a couple of sample customers,
// estimates, and a project. Idempotent: safe to re-run, every write is
// guarded by a unique key so a second run updates instead of duplicating.
//
// SAFETY: this script NEVER writes to the plus-ultra tenant. It resolves
// the demo tenant id once and asserts it is not the plus-ultra id before
// any mutation. It reads plus-ultra offers (read-only) to clone them.
//
// CONTEXT: tenants.is_sandbox is set true here, but per migration 042 that
// flag is NOT yet enforced server-side (cron agents, snapshot, and CAPI do
// not skip sandbox tenants as of 2026-06-11). Treat this demo tenant as a
// fully live tenant until data isolation lands post-July.
//
// USAGE:
//   node scripts/seed-demo-tenant.mjs            # provision / update
//   node scripts/seed-demo-tenant.mjs --dry-run  # print plan, write nothing
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in env or .env.local.
// Do NOT run against prod without intent. Build stops at PR open.
// ═══════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { cloneDefaultOffers } from '../lib/cloneOffers.js';

// Mirror api/auth.js hashPassword exactly so the seeded password verifies at
// login (scrypt, stored as `salt:hash`). FIX-2: the demo owner needs a real
// credential so a stranger can sign in at /login.html.
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// ── env load (matches scripts/seed_test_metal.mjs) ───────────────
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const DRY_RUN = process.argv.includes('--dry-run');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Set them in env or .env.local.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── demo tenant identity ─────────────────────────────────────────
const PLUS_ULTRA_SLUG = 'plus-ultra';
const DEMO = {
  slug: 'demo-roofing',
  name: 'Aurora Roofing Co. (DEMO)',
  owner_email: 'demo@ryujin-os.dev',
  company_phone: '(506) 555-0123',
  company_email: 'hello@auroraroofing.demo',
  company_website: 'https://auroraroofing.demo',
  accent_color: '#2B6CB0',
  tagline: 'Roofing done right.',
  proposal_header: 'Your Home. Protected.',
  // FIX-2 demo login + FIX-5 demo logo. The password is intentionally a known
  // demo credential (documented in _brain/qa/DEMO_LOGIN.md), not a secret.
  owner_password: 'AuroraDemo2026',
  logo_url: '/assets/branding/aurora-demo-logo.svg',
};

let plusUltraId = null;
const log = (...a) => console.log(DRY_RUN ? '[dry-run]' : '[seed]', ...a);

// Hard guard: refuse to ever touch the plus-ultra tenant.
function assertNotPlusUltra(tenantId, where) {
  if (!tenantId) throw new Error(`No tenant id resolved before ${where}`);
  if (plusUltraId && tenantId === plusUltraId) {
    throw new Error(`SAFETY ABORT: refusing to write to plus-ultra tenant at ${where}`);
  }
}

async function run() {
  if (DEMO.slug === PLUS_ULTRA_SLUG) throw new Error('SAFETY ABORT: demo slug equals plus-ultra');

  // Resolve plus-ultra id first so the guard has something to compare against.
  const { data: pu, error: puErr } = await sb
    .from('tenants').select('id').eq('slug', PLUS_ULTRA_SLUG).maybeSingle();
  if (puErr) throw puErr;
  plusUltraId = pu?.id || null;
  if (!plusUltraId) log('WARN: plus-ultra tenant not found; offer cloning will be skipped.');

  const tenantId = await upsertTenant();
  assertNotPlusUltra(tenantId, 'post-tenant');

  await upsertSettings(tenantId);
  await upsertOwnerUser(tenantId);
  const offerCount = await cloneOffers(tenantId);
  const customers = await upsertCustomers(tenantId);
  const estimate = await upsertSampleEstimate(tenantId, customers[0]);
  await upsertSampleProject(tenantId, customers[0], estimate);
  const inboxCount = await seedInboxItems(tenantId);

  log('DONE.');
  log(`tenant=${tenantId} slug=${DEMO.slug} offers=${offerCount} customers=${customers.length} inbox=${inboxCount}`);
  log(`login: /login.html  email=${DEMO.owner_email}  password=${DEMO.owner_password}  tenant=${DEMO.slug}`);
  if (estimate?.share_token) {
    log(`proposal: https://ryujin-os.vercel.app/proposal-client.html?share=${estimate.share_token}`);
  }
}

// ── tenants ──────────────────────────────────────────────────────
async function upsertTenant() {
  const { data: existing } = await sb
    .from('tenants').select('id').eq('slug', DEMO.slug).maybeSingle();

  const row = {
    slug: DEMO.slug,
    name: DEMO.name,
    owner_email: DEMO.owner_email,
    plan: 'starter',
    active: true,
    is_sandbox: true,
    branding: { accent_color: DEMO.accent_color, tagline: DEMO.tagline },
  };

  if (existing) {
    log(`tenant exists (${existing.id}); updating branding fields`);
    if (!DRY_RUN) {
      const { error } = await sb.from('tenants').update(row).eq('id', existing.id);
      if (error) throw error;
    }
    return existing.id;
  }

  log('creating demo tenant');
  if (DRY_RUN) return '00000000-0000-0000-0000-000000000000';
  const { data, error } = await sb.from('tenants').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

// ── tenant_settings (unique per tenant) ──────────────────────────
async function upsertSettings(tenantId) {
  assertNotPlusUltra(tenantId, 'settings');
  const { data: existing } = await sb
    .from('tenant_settings').select('id').eq('tenant_id', tenantId).maybeSingle();

  // Branding only; every rate/margin/multiplier column has a sane default.
  const row = {
    tenant_id: tenantId,
    company_name: DEMO.name,
    company_phone: DEMO.company_phone,
    company_email: DEMO.company_email,
    company_website: DEMO.company_website,
    accent_color: DEMO.accent_color,
    tagline: DEMO.tagline,
    proposal_header: DEMO.proposal_header,
    logo_url: DEMO.logo_url,
  };

  if (existing) {
    log('tenant_settings exists; updating branding');
    if (!DRY_RUN) {
      const { error } = await sb.from('tenant_settings').update(row).eq('id', existing.id);
      if (error) throw error;
    }
    return;
  }
  log('creating tenant_settings');
  if (DRY_RUN) return;
  const { error } = await sb.from('tenant_settings').insert(row);
  if (error) throw error;
}

// ── owner user ───────────────────────────────────────────────────
async function upsertOwnerUser(tenantId) {
  assertNotPlusUltra(tenantId, 'user');
  const email = DEMO.owner_email;
  const { data: existing } = await sb
    .from('users').select('id, password_hash').eq('tenant_id', tenantId).eq('email', email).maybeSingle();

  // FIX-2: ensure the owner has a login credential. The owner row may already
  // exist (POST /api/tenants creates it without a password), so backfill the
  // password_hash when it is missing rather than only setting it on insert.
  if (existing) {
    if (!existing.password_hash) {
      log('owner user exists without password; setting demo credential');
      if (!DRY_RUN) {
        const { error } = await sb.from('users')
          .update({ password_hash: hashPassword(DEMO.owner_password) }).eq('id', existing.id);
        if (error) throw error;
      }
    } else {
      log('owner user exists with a password; leaving it');
    }
    return;
  }
  log('creating owner user with demo password');
  if (DRY_RUN) return;
  const { error } = await sb.from('users').insert({
    tenant_id: tenantId, email, name: 'Demo Owner', role: 'owner', active: true,
    password_hash: hashPassword(DEMO.owner_password),
  });
  if (error) throw error;
}

// ── offers: clone live from plus-ultra so they never drift ───────
// Delegates to lib/cloneOffers.js (the shared GAP-A path) so the seed and real
// tenant provisioning (api/tenants.js) use identical logic. The local
// assertNotPlusUltra stays as a belt-and-suspenders guard; the lib also refuses
// to clone a tenant's offers onto itself.
async function cloneOffers(tenantId) {
  assertNotPlusUltra(tenantId, 'offers');
  const result = await cloneDefaultOffers(tenantId, { sb, dryRun: DRY_RUN, log });
  return result.cloned;
}

// ── sample customers ─────────────────────────────────────────────
async function upsertCustomers(tenantId) {
  assertNotPlusUltra(tenantId, 'customers');
  const seeds = [
    { full_name: 'Jordan Demo', email: 'jordan@example.demo', phone: '(506) 555-0201', address: '12 Maple Crescent', city: 'Moncton', source: 'website' },
    { full_name: 'Riley Demo', email: 'riley@example.demo', phone: '(506) 555-0202', address: '48 Birch Lane', city: 'Riverview', source: 'referral' },
  ];
  const out = [];
  for (const s of seeds) {
    const { data: ex } = await sb
      .from('customers').select('id').eq('tenant_id', tenantId).eq('full_name', s.full_name).maybeSingle();
    if (ex) { out.push({ id: ex.id, ...s }); continue; }
    if (DRY_RUN) { out.push({ id: '00000000-0000-0000-0000-000000000000', ...s }); continue; }
    const { data, error } = await sb.from('customers')
      .insert({ tenant_id: tenantId, province: 'NB', tags: ['demo'], ...s })
      .select('id').single();
    if (error) throw error;
    out.push({ id: data.id, ...s });
  }
  log(`customers ready: ${out.length}`);
  return out;
}

// ── sample estimate (published proposal so the demo renders) ─────
async function upsertSampleEstimate(tenantId, customer) {
  assertNotPlusUltra(tenantId, 'estimate');
  const SHARE = 'demo-roofing-sample';
  const { data: ex } = await sb
    .from('estimates').select('id, share_token').eq('tenant_id', tenantId).eq('share_token', SHARE).maybeSingle();
  if (ex) { log('sample estimate exists'); return ex; }
  if (DRY_RUN) { log('would create sample estimate'); return { share_token: SHARE }; }

  const calc = {
    gold:     { hardCost: 9500,  sellingPrice: 13965, hst: 2094.75, total: 16059.75 },
    platinum: { hardCost: 11200, sellingPrice: 17024, hst: 2553.60, total: 19577.60 },
    diamond:  { hardCost: 16800, sellingPrice: 26544, hst: 3981.60, total: 30525.60 },
  };
  const { data, error } = await sb.from('estimates').insert({
    tenant_id: tenantId, customer_id: customer.id,
    proposal_mode: 'Roof Only', pricing_model: 'Local',
    roof_area_sqft: 1800, roof_pitch: '6/12', complexity: 'medium',
    eaves_lf: 95, ridges_lf: 42, valleys_lf: 18, pipes: 2, vents: 3, chimneys: 1, distance_km: 8,
    calculated_packages: calc, selected_package: 'platinum',
    status: 'proposal_sent', share_token: SHARE,
    tags: ['demo'],
  }).select('id, share_token').single();
  if (error) throw error;
  log(`sample estimate ${data.id}`);
  return data;
}

// ── sample project ───────────────────────────────────────────────
async function upsertSampleProject(tenantId, customer, estimate) {
  assertNotPlusUltra(tenantId, 'project');
  const SHARE = 'demo-roofing-project';
  const { data: ex } = await sb
    .from('projects').select('id').eq('tenant_id', tenantId).eq('share_token', SHARE).maybeSingle();
  if (ex) { log('sample project exists'); return; }
  if (DRY_RUN) { log('would create sample project'); return; }
  const { error } = await sb.from('projects').insert({
    tenant_id: tenantId, customer_id: customer.id, estimate_id: estimate?.id || null,
    name: '12 Maple Crescent — Demo Reroof', address: '12 Maple Crescent', city: 'Moncton',
    status: 'active', share_token: SHARE, tags: ['demo'],
  });
  if (error) throw error;
  log('sample project created');
}

// ── demo inbox items (FIX-4) ─────────────────────────────────────
// Seed 2-3 representative curated-inbox rows (a lead, a warranty question, a
// sub message) with drafted replies so the inbox stop demos live without a
// sandbox GHL. Idempotent by (tenant_id, ghl_conversation_id). state_hash is
// not null in the schema, so a stable synthetic value is supplied per row.
async function seedInboxItems(tenantId) {
  assertNotPlusUltra(tenantId, 'inbox');
  const nowIso = new Date().toISOString();
  const items = [
    {
      ghl_conversation_id: 'demo-conv-lead-001',
      contact_name: 'Taylor Bishop',
      channel: 'sms',
      last_message_body: 'Hi, saw your sign in the neighbourhood. My roof started leaking after the storm. Can you come quote a replacement?',
      category: 'lead', urgency: 'high', notify: true, notify_reason: 'new reroof lead',
      summary: 'Storm-damage leak, wants a replacement quote.',
      draft_reply: 'Hi Taylor, sorry to hear about the leak. We can get out this week to take a look and put a quote together. What is the best address and a daytime number to reach you?',
      source: 'ghl',
    },
    {
      ghl_conversation_id: 'demo-conv-warranty-002',
      contact_name: 'Morgan Reyes',
      channel: 'email',
      last_message_body: "One of the ridge caps lifted in last week's wind. Is that something covered under our workmanship warranty?",
      category: 'customer', urgency: 'normal', notify: false, notify_reason: null,
      summary: 'Lifted ridge cap, asking about warranty coverage.',
      draft_reply: 'Hi Morgan, thanks for flagging it. A lifted ridge cap in the first years is exactly what the workmanship warranty covers. We will get a crew out to reseat it at no charge. What day this week works for a quick visit?',
      source: 'ghl',
    },
    {
      ghl_conversation_id: 'demo-conv-sub-003',
      contact_name: 'Casey (crew lead)',
      channel: 'sms',
      last_message_body: 'Crew wrapped 12 Maple Crescent. Photos uploaded. Ready for the next address.',
      category: 'sub', urgency: 'normal', notify: false, notify_reason: null,
      summary: 'Job done at 12 Maple, crew free for the next assignment.',
      draft_reply: 'Nice work Casey. Next up is 48 Birch Lane, tear-off in the morning. I will send the work order and material drop time tonight.',
      source: 'sub_portal',
    },
  ];

  let n = 0;
  for (const it of items) {
    const { data: ex } = await sb
      .from('inbox_items').select('id')
      .eq('tenant_id', tenantId).eq('ghl_conversation_id', it.ghl_conversation_id).maybeSingle();
    if (ex) { n++; continue; }
    if (DRY_RUN) { n++; continue; }
    const row = {
      tenant_id: tenantId,
      ghl_conversation_id: it.ghl_conversation_id,
      contact_name: it.contact_name,
      channel: it.channel,
      last_message_body: it.last_message_body,
      last_message_at: nowIso,
      last_message_id: it.ghl_conversation_id + '-m1',
      state_hash: it.ghl_conversation_id + '-m1',
      summary: it.summary,
      category: it.category,
      urgency: it.urgency,
      notify: it.notify,
      notify_reason: it.notify_reason,
      needs_reply: true,
      draft_reply: it.draft_reply,
      status: 'needs_review',
      source: it.source,
    };
    const { error } = await sb.from('inbox_items').insert(row);
    if (error) throw error;
    n++;
  }
  log(`inbox items ready: ${n}`);
  return n;
}

run().catch((e) => { console.error('[seed] FAILED:', e.message || e); process.exit(1); });
