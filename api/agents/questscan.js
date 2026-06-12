// ═══════════════════════════════════════════════════════════════
// RYUJIN QUEST SCANNER - the daily engine behind the Quest Board.
//
// Reads live business state once a day and emits assigned, deduped,
// auto-expiring quests onto each person's board (source_agent='questscan').
// The board, XP, per-user filtering and the cockpit "needs you" chip were all
// already built; this is the missing piece that actually fills the board.
//
// Design guarantees:
//   - IDEMPOTENT: every quest carries a deterministic metadata.dedup_key
//     (rule:entityId). A second run of the same condition does NOT create a
//     duplicate - it finds the still-open quest and skips it.
//   - SELF-CLEANING: when a condition clears (proposal sent, job scheduled,
//     invoice raised), the agent expires the stale open quest on the next run.
//     Auto-expire is scoped to rules that RAN SUCCESSFULLY this tick, so a rule
//     that errors can never mass-expire its own real quests.
//   - SAFE: dormant until tenant_settings.questscan_agent_enabled is true, and
//     ?dry=1 returns the full plan without writing anything.
//   - DRAFTS ONLY: it creates to-dos; it never touches a customer or money.
//
// Schedule: daily via vercel cron (/api/agents/questscan?tenant=plus-ultra).
// Manual / preview: POST or GET ?tenant=plus-ultra&dry=1 (and &manual=1).
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../../lib/supabase.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Staleness thresholds (days). Owner-tunable later via questscan_config if needed.
const PROPOSAL_STALE_DAYS = 3;   // a sent proposal with no movement
const SCHEDULE_GRACE_DAYS = 1;   // an approved estimate still unscheduled

const daysAgoISO = (n) => new Date(Date.now() - n * DAY_MS).toISOString();
const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY_MS) : null);
const shortId = (id) => String(id || '').slice(0, 8);

// Defensive label pickers (we select * so whatever exists is available).
function customerLabel(row) {
  return row.customer_name
    || (row.customer && (row.customer.full_name || row.customer.name))
    || row.full_name || row.name || row.address || row.property_address
    || ('record ' + shortId(row.id));
}

// ── Resolve who each kind of work goes to. Config overrides win; then owner for
// sales; then best-effort name/email match for scheduler + finance; else null
// (unassigned = visible to everyone on the board, never mis-assigned). ──
function resolveAssignees(users, cfg) {
  const owner = users.find(u => u.role === 'owner') || null;
  const match = (re) => users.find(u => re.test(String(u.name || '')) || re.test(String(u.email || ''))) || null;
  const byId = (id) => (id && users.find(u => u.id === id)) || null;
  const sales = byId(cfg.sales_user_id) || owner;
  const scheduler = byId(cfg.scheduler_user_id) || match(/cat|catherine/i) || null;
  const finance = byId(cfg.finance_user_id) || match(/mel|melodie/i) || null;
  return {
    sales: sales ? sales.id : null,
    scheduler: scheduler ? scheduler.id : null,
    finance: finance ? finance.id : null,
  };
}

// ── The rules. Each returns an array of quest candidates. Each candidate MUST
// carry a stable dedup_key so re-runs are idempotent. Rules are run in isolation
// (one throwing does not abort the scan, and does not trigger expiry of its
// own quests). ──
function buildRules(tenantId, who) {
  return [
    {
      key: 'proposal-followup',
      category: 'sales',
      assignedTo: who.sales,
      async run() {
        const { data, error } = await supabaseAdmin
          .from('estimates').select('*')
          .eq('tenant_id', tenantId)
          .eq('state', 'proposal_sent')
          .lt('updated_at', daysAgoISO(PROPOSAL_STALE_DAYS))
          .limit(100);
        if (error) throw new Error('estimates(proposal_sent): ' + error.message);
        return (data || []).map(e => {
          const d = daysSince(e.updated_at);
          return {
            dedup_key: `proposal-followup:${e.id}`,
            ref_id: e.id,
            title: `Follow up: ${customerLabel(e)} proposal`,
            description: `Proposal sent ${d != null ? d + 'd ago' : 'a while ago'} with no movement. Nudge the customer or log the outcome.`,
            due_at: e.rate_hold_expires_at || null,
          };
        });
      },
    },
    {
      key: 'schedule-accepted',
      category: 'ops',
      assignedTo: who.scheduler,
      async run() {
        // Approved estimate that has not been scheduled yet (no scheduled_at set).
        const { data, error } = await supabaseAdmin
          .from('estimates').select('*')
          .eq('tenant_id', tenantId)
          .not('approved_at', 'is', null)
          .is('scheduled_at', null)
          .lt('approved_at', daysAgoISO(SCHEDULE_GRACE_DAYS))
          .limit(100);
        if (error) throw new Error('estimates(accepted_unscheduled): ' + error.message);
        return (data || []).map(e => ({
          dedup_key: `schedule-accepted:${e.id}`,
          ref_id: e.id,
          title: `Schedule job: ${customerLabel(e)}`,
          description: `Accepted ${daysSince(e.approved_at) != null ? daysSince(e.approved_at) + 'd ago' : ''} and not on the calendar yet. Book the crew + create the work order.`,
          due_at: e.schedule_due_by || null,
        }));
      },
    },
    {
      key: 'invoice-completed',
      category: 'finance',
      assignedTo: who.finance,
      async run() {
        // Completed work orders whose paysheet is not yet payable/paid.
        const { data: wos, error } = await supabaseAdmin
          .from('workorders').select('*')
          .eq('tenant_id', tenantId)
          .not('completed_at', 'is', null)
          .limit(100);
        if (error) throw new Error('workorders(completed): ' + error.message);
        const list = wos || [];
        const psIds = list.map(w => w.linked_paysheet_id).filter(Boolean);
        let paysheetState = {};
        if (psIds.length) {
          const { data: ps, error: pErr } = await supabaseAdmin
            .from('paysheets').select('id, state, status')
            .eq('tenant_id', tenantId).in('id', psIds);
          if (pErr) throw new Error('paysheets(by id): ' + pErr.message);
          for (const p of (ps || [])) paysheetState[p.id] = p.state || p.status;
        }
        const invoiced = new Set(['payable', 'paid']);
        return list
          .filter(w => {
            const st = w.linked_paysheet_id ? paysheetState[w.linked_paysheet_id] : null;
            return !st || !invoiced.has(String(st));
          })
          .map(w => ({
            dedup_key: `invoice-completed:${w.id}`,
            ref_id: w.id,
            title: `Invoice job: ${customerLabel(w)}`,
            description: `Work order completed ${daysSince(w.completed_at) != null ? daysSince(w.completed_at) + 'd ago' : ''} but the paysheet is not invoiced yet. Close it out so it gets billed.`,
            due_at: null,
          }));
      },
    },
    // NOTE: lead follow-up is intentionally omitted for now. Real leads live in
    // GHL (api/leads.js routes them to GHL contacts), not the near-empty Supabase
    // leads table, so a useful lead rule needs the GHL API. Tracked as a future
    // rule rather than shipping one that scans an empty table.
  ];
}

async function runScan({ tenantId, runId, dry }) {
  const result = { scanned: 0, created: 0, skipped: 0, expired: 0, byRule: {}, errors: [] };

  // Assignee resolution.
  const { data: users } = await supabaseAdmin
    .from('users').select('id, name, email, role').eq('tenant_id', tenantId).eq('active', true);
  const { data: settings } = await supabaseAdmin
    .from('tenant_settings').select('questscan_config').eq('tenant_id', tenantId).maybeSingle();
  const who = resolveAssignees(users || [], (settings && settings.questscan_config) || {});

  // Run each rule in isolation. Collect candidates + which rules succeeded
  // (only successful rules are allowed to auto-expire their stale quests).
  const rules = buildRules(tenantId, who);
  const candidates = [];          // { dedup_key, rule, category, assignedTo, title, description, due_at }
  const succeededRules = new Set();
  for (const rule of rules) {
    try {
      const found = await rule.run();
      succeededRules.add(rule.key);
      result.byRule[rule.key] = found.length;
      result.scanned += found.length;
      for (const c of found) {
        candidates.push({ ...c, rule: rule.key, category: rule.category, assignedTo: rule.assignedTo });
      }
    } catch (e) {
      result.errors.push(`${rule.key}: ${e.message}`.slice(0, 200));
      result.byRule[rule.key] = 'error';
    }
  }

  // Existing open/in-progress questscan quests, keyed by dedup_key.
  const { data: open } = await supabaseAdmin
    .from('quests').select('id, status, metadata')
    .eq('tenant_id', tenantId).eq('source_agent', 'questscan')
    .in('status', ['open', 'in_progress']);
  const openByKey = new Map();
  for (const q of (open || [])) {
    const k = q.metadata && q.metadata.dedup_key;
    if (k) openByKey.set(k, q);
  }
  const candidateKeys = new Set(candidates.map(c => c.dedup_key));

  // Insert genuinely new candidates (skip ones that already have an open quest).
  const toInsert = candidates.filter(c => !openByKey.has(c.dedup_key));
  result.skipped = candidates.length - toInsert.length;
  if (!dry && toInsert.length) {
    const rows = toInsert.map(c => ({
      tenant_id: tenantId,
      assigned_to: c.assignedTo || null,
      category: c.category,
      type: 'daily',
      title: c.title.slice(0, 200),
      description: c.description ? c.description.slice(0, 1000) : null,
      xp_reward: 15,
      status: 'open',
      source_agent: 'questscan',
      source_id: runId || null,
      due_at: c.due_at || null,
      metadata: { dedup_key: c.dedup_key, rule: c.rule, ref_id: c.ref_id },
    }));
    const { error } = await supabaseAdmin.from('quests').insert(rows);
    if (error) result.errors.push('insert: ' + error.message);
    else result.created = rows.length;
  } else if (dry) {
    result.created = toInsert.length;       // would-create
    result.plan = toInsert.map(c => ({ rule: c.rule, assignedTo: c.assignedTo, title: c.title }));
  }

  // Auto-expire: open quests whose condition cleared. ONLY for rules that ran
  // OK this tick (so a transient rule error can't wipe its real quests), and
  // only when the dedup_key is no longer a candidate.
  const toExpire = (open || []).filter(q => {
    const k = q.metadata && q.metadata.dedup_key;
    const r = q.metadata && q.metadata.rule;
    return k && r && succeededRules.has(r) && !candidateKeys.has(k);
  });
  if (!dry && toExpire.length) {
    const ids = toExpire.map(q => q.id);
    const { error } = await supabaseAdmin
      .from('quests')
      .update({ status: 'expired', metadata: { auto_expired_at: new Date().toISOString() } })
      .in('id', ids).eq('tenant_id', tenantId).eq('source_agent', 'questscan')
      .in('status', ['open', 'in_progress']);
    if (error) result.errors.push('expire: ' + error.message);
    else result.expired = ids.length;
  } else if (dry) {
    result.expired = toExpire.length;       // would-expire
  }

  return result;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const slug = (req.query.tenant || 'plus-ultra').toString().trim();
  const dry = req.query.dry === '1' || req.query.dry === 'true';
  const trigger = req.query.manual === '1' ? 'manual' : 'cron';
  const startTime = Date.now();

  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('id, slug').eq('slug', slug).maybeSingle();
  if (!tenant) return res.status(404).json({ error: `tenant '${slug}' not found` });

  // Opt-in flag. Dormant until flipped (the daily cron is a safe no-op).
  const { data: settings } = await supabaseAdmin
    .from('tenant_settings').select('questscan_agent_enabled').eq('tenant_id', tenant.id).maybeSingle();
  if (!settings?.questscan_agent_enabled && !dry) {
    // Cron stays armed on purpose: the flag is the no-deploy enable switch.
    // Log the skip so the daily no-op is visible in Vercel logs, not silent.
    console.log(`[questscan] skipped: questscan_agent_enabled=false for ${slug}`);
    return res.json({ agent: 'questscan', skipped: 'questscan_agent_enabled is false for this tenant', tenant: slug });
  }

  let runId = null, runClosed = false;
  try {
    if (!dry) {
      const { data: run } = await supabaseAdmin
        .from('agent_runs')
        .insert({ tenant_id: tenant.id, agent_slug: 'questscan', trigger, status: 'running' })
        .select('id').single();
      runId = run?.id || null;
    }

    const result = await runScan({ tenantId: tenant.id, runId, dry });
    const status = result.errors.length ? 'partial' : 'success';
    const summary = dry
      ? `[dry run] would create ${result.created}, expire ${result.expired} (scanned ${result.scanned})`
      : `created ${result.created}, expired ${result.expired}, skipped ${result.skipped} (scanned ${result.scanned})`;

    if (runId) {
      await supabaseAdmin.from('agent_runs').update({
        status,
        completed_at: new Date().toISOString(),
        summary,
        output: result,
        emitted_quests: result.created,
        duration_ms: Date.now() - startTime,
        error_message: result.errors.length ? result.errors.join(' | ').slice(0, 500) : null,
      }).eq('id', runId);
      runClosed = true;
    }

    // Snapshot section for the cockpit (best-effort; preserveKeys covers 'questscan').
    if (!dry) {
      try {
        const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://ryujin-os.vercel.app';
        await fetch(`${base}/api/snapshot`, {
          method: 'POST',
          headers: snapshotHeaders(),
          body: JSON.stringify({ questscan: { lastRun: new Date().toISOString(), created: result.created, expired: result.expired, byRule: result.byRule } }),
          signal: AbortSignal.timeout(10000),
        });
      } catch { /* snapshot is best-effort */ }
    }

    return res.json({ agent: 'questscan', tenant: slug, dry, status, ...result });
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
    return res.status(500).json({ agent: 'questscan', tenant: slug, error: e.message });
  } finally {
    if (runId && !runClosed) {
      try {
        await supabaseAdmin.from('agent_runs').update({
          status: 'partial', completed_at: new Date().toISOString(),
          error_message: 'run did not close cleanly (forced finally close)', duration_ms: Date.now() - startTime,
        }).eq('id', runId).eq('status', 'running');
      } catch { /* ignore */ }
    }
  }
}
