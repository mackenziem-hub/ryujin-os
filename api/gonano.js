// Ryujin OS - GoNano Application Tracker API.
//
// A read-only, single-link record of NuRoof Revive applied per roof, shared with
// the NanoSeal supplier (Ben) so they can verify spray quantities. Backed by the
// existing proposal_blocks table (no migration): each job is one row with
// block_type='custom_html', audience='internal', is_library=false,
// block_key='gonano:<stableId>'. A single 'gonano:_config' row holds the
// tenant-level share token. The 'gonano:' prefix isolates these from proposal
// sections, ad scripts, and invoices. Mirrors api/invoices.js / api/ad-scripts.js.
//
// PUBLIC (the share token is the auth (no session), one link lists all jobs):
//   GET  /api/gonano?token=<shareToken>   - public board data (jobs + summary, PII-stripped)
//
// PRIVILEGED (resolveSession + isPrivileged; tenant from the SESSION, never the
// client x-tenant-id header, same cross-tenant posture as api/settings.js. The
// service token + x-tenant-id resolves an admin session, which is how the GHL
// Automator webhook authenticates):
//   GET    /api/gonano                       - list jobs (full) + config
//   GET    /api/gonano?action=config         - ensure + return the share token / link
//   POST   /api/gonano  { ...job }           - upsert a job (the GHL webhook target)
//   DELETE /api/gonano?id=<uuid>             - delete a job (also ?jobCode=)

import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';

const PREFIX = 'gonano:';
const CONFIG_KEY = `${PREFIX}_config`;
const APP_BASE = (process.env.APP_BASE_URL || 'https://ryujin-os.vercel.app').trim();

// NuRoof Revive coverage spec (sq ft per liter, single coat). Drives the
// planned-liters envelope shown beside each job so quantities can be verified.
const COVERAGE_BEST = 70;   // newer / warmer shingle
const COVERAGE_LEAN = 50;   // aged / porous shingle
const SQFT_PER_SQ = 100;

const STATUSES = ['signed', 'scheduled', 'ordered', 'sprayed', 'complete'];
// Map common GHL stage names onto our 5 lifecycle states.
const STATUS_ALIASES = {
  'signed': 'signed', 'awaiting schedule': 'signed', 'signed - awaiting schedule': 'signed',
  'scheduled': 'scheduled', 'booked': 'scheduled',
  'product ordered': 'ordered', 'ordered': 'ordered', 'pails ordered': 'ordered',
  'sprayed': 'sprayed', 'applied': 'sprayed',
  'complete': 'complete', 'completed': 'complete', 'verified': 'complete', 'complete - verified': 'complete',
};

// ── helpers ──────────────────────────────────────────────────────
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
// Finite number or null. A malformed webhook field ("abc") becomes null
// (renders as "pending"), never a misleading 0.
const numOrNull = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
function kebab(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'job';
}
function normStatus(s) {
  const k = String(s || '').toLowerCase().trim();
  return STATUS_ALIASES[k] || (STATUSES.includes(k) ? k : 'signed');
}
function plannedLiters(sq) {
  const sqft = (Number(sq) || 0) * SQFT_PER_SQ;
  if (!sqft) return { low: 0, high: 0 };
  return { low: round1(sqft / COVERAGE_BEST), high: round1(sqft / COVERAGE_LEAN) };
}

// proposal_blocks row -> internal job object
function toJob(row) {
  const c = (row.content && typeof row.content === 'object') ? row.content : {};
  return { id: row.id, slug: String(row.block_key || '').replace(PREFIX, ''), updated_at: row.updated_at, ...c };
}

// PUBLIC projection. Address is the ONLY identifier exposed, no customer name,
// phone, or email ever reaches the shared board.
function toPublic(row) {
  const c = (row.content && typeof row.content === 'object') ? row.content : {};
  const plan = plannedLiters(c.sq);
  return {
    jobCode: c.jobCode || null,
    address: c.address || '',
    sq: c.sq != null ? round1(c.sq) : null,
    pails: c.pails != null ? Number(c.pails) : null,
    litersApplied: c.litersApplied != null ? round1(c.litersApplied) : null,
    coverage: c.coverage != null ? round1(c.coverage) : null,
    sprayDate: c.sprayDate || null,
    status: normStatus(c.status),
    plannedLow: plan.low,
    plannedHigh: plan.high,
  };
}

function summarize(jobs) {
  let totalSq = 0, totalPails = 0, totalApplied = 0, planLow = 0, planHigh = 0;
  for (const j of jobs) {
    totalSq += Number(j.sq) || 0;
    totalPails += Number(j.pails) || 0;
    totalApplied += Number(j.litersApplied) || 0;
    planLow += Number(j.plannedLow) || 0;
    planHigh += Number(j.plannedHigh) || 0;
  }
  return {
    jobs: jobs.length,
    totalSq: round1(totalSq),
    totalPails,
    litersApplied: round1(totalApplied),
    plannedLow: round1(planLow),
    plannedHigh: round1(planHigh),
  };
}

// ── config (tenant share token) ──────────────────────────────────
async function ensureConfig(tenantId) {
  const { data } = await supabaseAdmin.from('proposal_blocks')
    .select('id, content').eq('tenant_id', tenantId).eq('block_key', CONFIG_KEY).maybeSingle();
  if (data?.content?.shareToken) return data.content;
  const content = { shareToken: crypto.randomBytes(16).toString('hex'), createdAt: new Date().toISOString() };
  await supabaseAdmin.from('proposal_blocks').upsert({
    tenant_id: tenantId, block_key: CONFIG_KEY, block_type: 'custom_html',
    audience: 'internal', is_library: false, active: true, name: 'GoNano config',
    content, updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,block_key' });
  return content;
}

async function findTenantByToken(token) {
  if (!token) return null;
  const { data } = await supabaseAdmin.from('proposal_blocks')
    .select('tenant_id, content').eq('block_key', CONFIG_KEY)
    .eq('content->>shareToken', token).maybeSingle();
  return data?.tenant_id || null;
}

async function nextSeq(tenantId) {
  const { data } = await supabaseAdmin.from('proposal_blocks')
    .select('content').eq('tenant_id', tenantId).like('block_key', `${PREFIX}%`).neq('block_key', CONFIG_KEY);
  let max = 0;
  (data || []).forEach((r) => { const s = Number(r?.content?.seq) || 0; if (s > max) max = s; });
  return max + 1;
}

async function listJobRows(tenantId) {
  const { data } = await supabaseAdmin.from('proposal_blocks')
    .select('id, block_key, name, content, updated_at')
    .eq('tenant_id', tenantId).like('block_key', `${PREFIX}%`).neq('block_key', CONFIG_KEY)
    .order('updated_at', { ascending: false });
  return data || [];
}

// ══════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── PUBLIC: board data by share token ──
  // Only treats ?token= as a SHARE token when it actually resolves a config row.
  // On a miss, fall through to the privileged gate: resolveSession also accepts a
  // session token via ?token=, so a privileged caller passing one must not 404 here.
  if (req.method === 'GET' && req.query.token && !req.headers.authorization && !req.headers['x-ryujin-token']) {
    const tenantId = await findTenantByToken(req.query.token);
    if (tenantId) {
      const rows = await listJobRows(tenantId);
      const jobs = rows.map(toPublic)
        .sort((a, b) => STATUSES.indexOf(b.status) - STATUSES.indexOf(a.status));
      return res.json({ jobs, summary: summarize(jobs), generatedAt: new Date().toISOString() });
    }
  }

  // ── PRIVILEGED gate (tenant from session, not client header) ──
  const session = await resolveSession(req);
  if (!isPrivileged(session)) {
    return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  }
  const tenantId = session.tenant_id;

  // ── GET config (share token / link) ──
  if (req.method === 'GET' && req.query.action === 'config') {
    const cfg = await ensureConfig(tenantId);
    return res.json({ shareToken: cfg.shareToken, shareLink: `${APP_BASE}/gonano-tracker.html?token=${cfg.shareToken}` });
  }

  // ── GET list (full) ──
  if (req.method === 'GET') {
    const rows = await listJobRows(tenantId);
    const jobs = rows.map(toJob);
    const cfg = await ensureConfig(tenantId);
    return res.json({
      jobs, summary: summarize(jobs.map((j) => ({ ...j, ...plannedLiters(j.sq) }))),
      shareLink: `${APP_BASE}/gonano-tracker.html?token=${cfg.shareToken}`,
    });
  }

  // ── POST upsert job (the GHL Automator webhook target) ──
  if (req.method === 'POST') {
    const b = req.body || {};
    const address = String(b.address || '').trim();
    if (!address && !b.opportunityId && !b.jobCode) {
      return res.status(400).json({ error: 'address, jobCode, or opportunityId required' });
    }
    const stableId = kebab(b.opportunityId || b.jobCode || address);
    const blockKey = `${PREFIX}${stableId}`;

    const { data: existing } = await supabaseAdmin.from('proposal_blocks')
      .select('id, content').eq('tenant_id', tenantId).eq('block_key', blockKey).maybeSingle();
    const prev = (existing?.content && typeof existing.content === 'object') ? existing.content : {};

    // seq + jobCode are assigned once and held stable across webhook updates.
    // nextSeq is read-then-increment with no lock: two brand-new jobs created in
    // the same instant could share a GN-code. Acceptable at GoNano sign volume
    // (human-paced, rare); the row key (blockKey) is stable so rows never collide,
    // only the display code could ever dup. Revisit if volume climbs.
    let seq = Number(prev.seq) || 0;
    let jobCode = prev.jobCode || (b.jobCode ? String(b.jobCode).trim() : '');
    if (!seq) { seq = await nextSeq(tenantId); }
    if (!jobCode) { jobCode = `GN-${String(seq).padStart(3, '0')}`; }

    const sqIn = numOrNull(b.sq);
    const sq = sqIn != null ? round1(sqIn) : (prev.sq != null ? prev.sq : null);
    const pailsIn = numOrNull(b.pails);
    const pails = pailsIn != null ? pailsIn : (prev.pails != null ? prev.pails : null);
    const litersIn = numOrNull(b.litersApplied);
    const litersApplied = litersIn != null ? round1(litersIn) : (prev.litersApplied != null ? prev.litersApplied : null);
    // Coverage: explicit wins; else derive from liters + sq when both are known.
    const covIn = numOrNull(b.coverage);
    let coverage = covIn != null ? round1(covIn) : (prev.coverage != null ? prev.coverage : null);
    if (coverage == null && litersApplied > 0 && sq > 0) coverage = round1((sq * SQFT_PER_SQ) / litersApplied);

    const nowIso = new Date().toISOString();
    const content = {
      seq, jobCode,
      opportunityId: b.opportunityId || prev.opportunityId || null,
      address: address || prev.address || '',
      sq, pails, litersApplied, coverage,
      sprayDate: b.sprayDate != null ? String(b.sprayDate).trim() : (prev.sprayDate || null),
      status: normStatus(b.status || b.stageName || prev.status || 'signed'),
      updatedAt: nowIso,
      createdAt: prev.createdAt || nowIso,
    };

    const { data, error } = await supabaseAdmin.from('proposal_blocks').upsert({
      tenant_id: tenantId, block_key: blockKey, block_type: 'custom_html',
      audience: 'internal', is_library: false, active: true, name: jobCode,
      content, updated_at: nowIso,
    }, { onConflict: 'tenant_id,block_key' }).select('id, block_key, name, content, updated_at').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(existing ? 200 : 201).json({ job: toJob(data) });
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    const { id, jobCode } = req.query;
    if (!id && !jobCode) return res.status(400).json({ error: 'id or jobCode required' });
    let q = supabaseAdmin.from('proposal_blocks').delete()
      .eq('tenant_id', tenantId).like('block_key', `${PREFIX}%`).neq('block_key', CONFIG_KEY);
    q = id ? q.eq('id', id) : q.eq('content->>jobCode', jobCode);
    const { error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deleted: id || jobCode });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };
