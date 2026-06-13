// ═══════════════════════════════════════════════════════════════
// RYUJIN RECONCILIATION AGENT - the cross-system revenue truth check.
//
// Reads estimates + workorders + paysheets + customers, runs the pure engine
// (lib/reconcile.js), and persists the drift findings so the cockpit can stop
// quoting a single-system number that lies. It answers "what signed work is my
// software blind to, and what one-tap fix closes each gap".
//
// Design guarantees (mirrors questscan):
//   - READ-ONLY on business data. It writes ONLY to reconciliation_findings +
//     agent_runs. It never edits an estimate, customer, or dollar. The fixes it
//     proposes are executed later, with approval, by Slice 2.
//   - IDEMPOTENT: every finding carries a deterministic dedup_key (kind:target).
//     A second run updates the existing row, never duplicates it.
//   - SELF-CLEANING: a finding whose condition has cleared (someone backfilled
//     the dollar, fixed the estimate) is auto-resolved on the next clean run.
//     Auto-resolve only runs when the scan itself succeeded, so a fetch error
//     can never mass-resolve real findings.
//   - SAFE: dormant until tenant_settings.reconcile_agent_enabled is true, and
//     ?dry=1 returns the full reconciliation without writing anything.
//
// Schedule: daily via vercel cron (/api/agents/reconcile?tenant=plus-ultra).
// Preview:  GET ?tenant=plus-ultra&dry=1  -> figures + findings, no writes.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../../lib/supabase.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { reconcile, sentinelChecks } from '../../lib/reconcile.js';
import { fetchWonOpportunities, crossCheckGhl } from '../../lib/ghlReconcile.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';
import { buildCollections } from '../../lib/collections.js';

export const config = { maxDuration: 60 };

// Owner SMS alert path (the pre-built Automator/GHL channel, exempt from the
// outbound sign-off rule because it pings the OWNER, never a customer).
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_TOKEN = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
const GHL_VERSION = '2021-07-28';
const OWNER_SMS_CONTACT_ID = '02IhxZfSwZZAZ2fooVGu';

async function sendOwnerSMS(message) {
  if (process.env.OWNER_SMS_MUTED === '1') return { muted: true };
  if (!GHL_TOKEN) return { error: 'no GHL_TOKEN' };
  try {
    const resp = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: GHL_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SMS', contactId: OWNER_SMS_CONTACT_ID, message }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return { error: `SMS ${resp.status}: ${(await resp.text()).slice(0, 200)}` };
    return { sent: true };
  } catch (e) {
    return { error: String(e.message).slice(0, 200) };
  }
}

// Weekly collections pass: read the cashflow AR book from the snapshot, classify
// + draft per job (lib/collections.js), write a sections.collections section, and
// SMS the owner if collections have stayed dry for 7 days while AR is open. Drafts
// are NEVER auto-sent. Invoked via ?collections=1 (Monday cron); ?dry=1 previews.
async function runCollections({ req, res, tenant, slug, dry, startTime }) {
  const trigger = req.query.manual === '1' ? 'manual' : 'cron_daily';
  let runId = null, runClosed = false;
  try {
    if (!dry) {
      const { data: run, error: runErr } = await supabaseAdmin
        .from('agent_runs')
        .insert({ tenant_id: tenant.id, agent_slug: 'reconcile', trigger, status: 'running' })
        .select('id').single();
      if (runErr) console.error('collections: agent_runs insert failed:', runErr.message);
      runId = run?.id || null;
    }

    const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://ryujin-os.vercel.app';
    let cashflow = null;
    try {
      const r = await fetch(`${base}/api/snapshot`, { headers: snapshotHeaders(), signal: AbortSignal.timeout(10000) });
      const snap = await r.json();
      cashflow = snap?.sections?.cashflow || null;
    } catch (e) {
      throw new Error(`snapshot read failed: ${e.message}`);
    }
    if (!cashflow) throw new Error('cashflow section missing from snapshot (run the cashflow agent first)');

    const now = new Date().toISOString();
    const collections = buildCollections(cashflow, now);

    // Owner SMS only on the live cron path (never on dry preview or manual run),
    // and only when the 7-day-dry condition holds. Weekly cadence = at most one ping/week.
    let smsResult = null;
    if (!dry && trigger === 'cron_daily' && collections.alert.dry7d) {
      smsResult = await sendOwnerSMS(`RYUJIN COLLECTIONS\n\n${collections.alert.message}`);
    }
    collections.alert.smsFired = !!(smsResult && smsResult.sent);

    const summary = `collections: ${collections.openCount} open AR, ${collections.trueChases} chase(s), $${collections.collectibleNow.toLocaleString()} collectible now, 7d collected $${collections.collected7d}${collections.alert.dry7d ? ' [DRY ALERT]' : ''}`;

    if (runId) {
      await supabaseAdmin.from('agent_runs').update({
        status: 'success', completed_at: new Date().toISOString(), summary,
        output: { mode: 'collections', collections, smsResult },
        duration_ms: Date.now() - startTime,
      }).eq('id', runId);
      runClosed = true;
    }

    if (!dry) {
      try {
        await fetch(`${base}/api/snapshot`, {
          method: 'POST', headers: snapshotHeaders(),
          body: JSON.stringify({ collections }), signal: AbortSignal.timeout(10000),
        });
      } catch { /* snapshot is best-effort */ }
    }

    return res.json({ agent: 'reconcile', mode: 'collections', tenant: slug, dry, summary, collections, smsResult });
  } catch (e) {
    if (runId && !runClosed) {
      try {
        await supabaseAdmin.from('agent_runs').update({
          status: 'error', completed_at: new Date().toISOString(),
          error_message: String(e.message).slice(0, 500), duration_ms: Date.now() - startTime,
        }).eq('id', runId);
      } catch { /* ignore */ }
    }
    return res.status(500).json({ agent: 'reconcile', mode: 'collections', tenant: slug, error: e.message });
  }
}

const normJob = (s) => String(s || '')
  .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// dedup_key: stable per logical finding. Prefer the estimate id (survives a name
// change); fall back to kind + normalized job label for the no-estimate jobs.
const dedupKey = (f) => `${f.kind}:${f.estimate_id || normJob(f.job)}`;

async function fetchData(tenantId) {
  const sel = (table, cols) => supabaseAdmin.from(table).select(cols).eq('tenant_id', tenantId);
  const [est, wos, pay, cust] = await Promise.all([
    sel('estimates', 'id,estimate_number,customer_id,status,final_accepted_total,accepted_at,created_at'),
    sel('workorders', 'id,wo_number,customer_name,address,status,total_sq,linked_estimate_id,linked_paysheet_id'),
    sel('paysheets', 'id,customer_name,address,status,total,subtotal,linked_estimate_id,paid_at,completed_at,completed_date'),
    sel('customers', 'id,full_name,address'),
  ]);
  for (const r of [est, wos, pay, cust]) if (r.error) throw new Error(r.error.message);
  return { estimates: est.data || [], workorders: wos.data || [], paysheets: pay.data || [], customers: cust.data || [] };
}

// ── Sentinel data assembly (Mac Jun 12: continuous money-bug scans) ──
const ESTIMATOR_BASE = 'https://estimator-os.replit.app/api';
const ESTIMATOR_KEY = (process.env.ESTIMATOR_KEY || process.env.ESTIMATOR_OS_KEY || 'pu-estimator-2026').trim();
const RYUJIN_BASE = 'https://ryujin-os.vercel.app';

// Unified estimate pool, same shape the cashflow matcher uses, so the
// dup_estimate_rows sentinel sees exactly what payment matching sees.
async function buildEstimatePool(data) {
  const pool = [];
  try {
    const r = await fetch(`${ESTIMATOR_BASE}/estimates`, { headers: { 'x-api-key': ESTIMATOR_KEY }, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const d = await r.json();
      const arr = Array.isArray(d) ? d : (d.estimates || d.data || []);
      for (const e of arr) {
        if (e.proposalStatus === 'Accepted' || e.jobStatus === 'Proposal Accepted') {
          pool.push({ id: e.id, source: 'estimator-os', fullName: e.customer?.fullName || '', address: e.customer?.address || '', finalAcceptedTotal: e.finalAcceptedTotal ?? null });
        }
      }
    }
  } catch { /* estimator-os unreachable: pool stays ryujin-only, the check degrades gracefully */ }
  const custById = new Map((data.customers || []).map(c => [c.id, c]));
  for (const e of (data.estimates || [])) {
    if (!String(e.status || '').toLowerCase().includes('accept')) continue;
    const c = custById.get(e.customer_id) || {};
    pool.push({ id: e.id, source: 'ryujin', fullName: c.full_name || '', address: c.address || '', finalAcceptedTotal: e.final_accepted_total ?? null });
  }
  return pool;
}

// Current snapshot sections: the cashflow section carries byJob + the
// arExceptions the payment matcher emits (PR #392), and reconcile.log holds
// the run history this agent appends to.
async function fetchSnapshotSections() {
  try {
    const r = await fetch(`${RYUJIN_BASE}/api/snapshot`, {
      headers: {
        ...(process.env.RYUJIN_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.RYUJIN_SERVICE_TOKEN.trim()}` } : {}),
        'x-tenant-id': 'plus-ultra'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return {};
    const s = await r.json();
    return s.sections || {};
  } catch { return {}; }
}

async function persistFindings(tenantId, findings) {
  const now = new Date().toISOString();
  const seen = new Set();
  let persisted = 0, skippedDismissed = 0;

  // Findings the user has DISMISSED stay dismissed — e.g. a VALUE_LOOKS_LIKE_COST
  // on a deliberate price-match (Egbuwoku) is a confirmed false positive, not a
  // gap. Never re-open them, and keep them in `seen` so the self-clean below
  // doesn't touch them either.
  const { data: dismissedRows } = await supabaseAdmin
    .from('reconciliation_findings')
    .select('dedup_key').eq('tenant_id', tenantId).eq('status', 'dismissed');
  const dismissed = new Set((dismissedRows || []).map((r) => r.dedup_key));

  for (const f of findings) {
    const key = dedupKey(f);
    seen.add(key);
    if (dismissed.has(key)) { skippedDismissed++; continue; } // honor the user's dismissal
    const row = {
      tenant_id: tenantId, dedup_key: key, kind: f.kind, job: f.job,
      detail: f.detail, proposed_fix: f.proposed_fix,
      dollar_impact: f.dollar_impact ?? null,
      estimate_id: f.estimate_id || null,
      status: 'open', updated_at: now,
      metadata: { sub_cost_floor: f.sub_cost_floor ?? null },
    };
    // upsert on (tenant_id, dedup_key); re-open a previously resolved one if it recurs
    const { error } = await supabaseAdmin
      .from('reconciliation_findings')
      .upsert(row, { onConflict: 'tenant_id,dedup_key' });
    if (error) throw new Error(`persist ${key}: ${error.message}`);
    persisted++;
  }

  // Self-clean: auto-resolve open findings not present in this (successful) run.
  const { data: open } = await supabaseAdmin
    .from('reconciliation_findings')
    .select('id,dedup_key').eq('tenant_id', tenantId).eq('status', 'open');
  const stale = (open || []).filter((r) => !seen.has(r.dedup_key)).map((r) => r.id);
  let resolved = 0;
  if (stale.length) {
    const { error } = await supabaseAdmin.from('reconciliation_findings')
      .update({ status: 'resolved', resolved_at: now, updated_at: now }).in('id', stale);
    if (!error) resolved = stale.length;
  }
  return { persisted, resolved, skippedDismissed };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const slug = (req.query.tenant || 'plus-ultra').toString().trim();
  const dry = req.query.dry === '1' || req.query.dry === 'true';
  const trigger = req.query.manual === '1' ? 'manual' : 'cron_daily'; // must match agent_runs.trigger CHECK (migration_041)
  const startTime = Date.now();

  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('id, slug').eq('slug', slug).maybeSingle();
  if (!tenant) return res.status(404).json({ error: `tenant '${slug}' not found` });

  const { data: settings } = await supabaseAdmin
    .from('tenant_settings').select('reconcile_agent_enabled').eq('tenant_id', tenant.id).maybeSingle();
  if (!settings?.reconcile_agent_enabled && !dry) {
    return res.json({ agent: 'reconcile', skipped: 'reconcile_agent_enabled is false for this tenant', tenant: slug });
  }

  // Weekly collections pass (P0 cash lever): own AR-aging + chase-draft path,
  // wired to a Monday cron. Shares the reconcile slug + enable gate; ?dry=1 previews.
  if (req.query.collections === '1' || req.query.collections === 'true') {
    return runCollections({ req, res, tenant, slug, dry, startTime });
  }

  let runId = null, runClosed = false;
  try {
    if (!dry) {
      const { data: run, error: runErr } = await supabaseAdmin
        .from('agent_runs')
        .insert({ tenant_id: tenant.id, agent_slug: 'reconcile', trigger, status: 'running' })
        .select('id').single();
      if (runErr) console.error('reconcile: agent_runs insert failed:', runErr.message);
      runId = run?.id || null;
    }

    const data = await fetchData(tenant.id);
    const result = reconcile(data);

    // Slice 3: widen senses — cross-check GHL won deals (graceful; null if GHL unavailable).
    const ghlWon = await fetchWonOpportunities();
    if (ghlWon) result.findings.push(...crossCheckGhl(ghlWon, result.jobs));
    result.figures.ghl_won_checked = ghlWon ? ghlWon.length : 0;

    // Slice 4: sentinel checks (Mac Jun 12: continuous money-bug scans).
    // Duplicate estimate rows, matcher exceptions, contract-vs-collected
    // drift, aged unpaid paysheets. Findings ride the same persistence
    // machinery below (dedup + dismiss + auto-resolve).
    const [pool, sections] = await Promise.all([buildEstimatePool(data), fetchSnapshotSections()]);
    const sentinels = sentinelChecks({ pool, cashflow: sections.cashflow || null, paysheets: data.paysheets });
    result.findings.push(...sentinels);
    result.figures.sentinel_findings = sentinels.length;

    let persistence = { persisted: 0, resolved: 0, skippedDismissed: 0 };
    if (!dry) persistence = await persistFindings(tenant.id, result.findings);

    const F = result.figures;
    const summary = `${F.committed_delivered_jobs} jobs; recorded $${F.figureA_accepted_sum.toLocaleString()}, est true ~$${F.estimated_true_committed_mid.toLocaleString()}; ${result.findings.length} findings (${F.jobs_with_no_recorded_contract_value} no-value, ${sentinels.length} sentinel)`;

    if (runId) {
      await supabaseAdmin.from('agent_runs').update({
        status: 'success', completed_at: new Date().toISOString(), summary,
        output: { figures: F, persistence, finding_count: result.findings.length, sentinel_count: sentinels.length },
        duration_ms: Date.now() - startTime,
      }).eq('id', runId);
      runClosed = true;
    }

    if (!dry) {
      try {
        const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://ryujin-os.vercel.app';
        // RECONCILE LOG: one line per run, capped at the last 60 entries, so
        // the UIs (activity-log panel) can read a continuous history instead
        // of only the latest state. Lives inside sections.reconcile, which is
        // already in snapshot preserveKeys.
        const prevLog = Array.isArray(sections.reconcile?.log) ? sections.reconcile.log : [];
        const byKind = {};
        for (const f of sentinels) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
        const log = [...prevLog.slice(-59), {
          at: new Date().toISOString(),
          summary,
          findings: result.findings.length,
          sentinels: sentinels.length,
          byKind
        }];
        await fetch(`${base}/api/snapshot`, {
          method: 'POST', headers: snapshotHeaders(),
          body: JSON.stringify({ reconcile: { lastRun: new Date().toISOString(), figures: F, openFindings: result.findings.length, sentinels: sentinels.length, log } }),
          signal: AbortSignal.timeout(10000),
        });
      } catch { /* snapshot is best-effort */ }
    }

    return res.json({ agent: 'reconcile', tenant: slug, dry, summary, figures: F, ...persistence, findings: result.findings, jobs: result.jobs });
  } catch (e) {
    if (runId && !runClosed) {
      try {
        await supabaseAdmin.from('agent_runs').update({
          status: 'error', completed_at: new Date().toISOString(),
          error_message: String(e.message).slice(0, 500), duration_ms: Date.now() - startTime,
        }).eq('id', runId);
        runClosed = true;
      } catch { /* ignore */ }
    }
    return res.status(500).json({ agent: 'reconcile', tenant: slug, error: e.message });
  }
}
