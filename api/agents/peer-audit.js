// ═══════════════════════════════════════════════════════════════
// PEER-AUDIT AGENT — second-opinion sweep over recently-touched estimates.
//
// Pulls estimates updated in the last 24h and runs the `pricing` lens
// against each. Aggregates verdicts of needs_changes / fail into a
// findings list. Read-only — never modifies estimates. Results land
// in the JSON response and (if cron) get persisted to snapshot for
// the morning briefing to pick up.
//
// Schedule: 6:30 AM AT (10:30 UTC) daily — between Z-Fighters (6:03)
// and the morning briefing (7:00). Also callable on-demand at
// GET /api/agents/peer-audit.
//
// Cost target: ~$0.012/estimate × ~5–15 reviewable/day = $0.05–0.20/day.
// ═══════════════════════════════════════════════════════════════

import { peerReview } from '../../lib/peer_review.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';

const RYUJIN_BASE = 'https://ryujin-os.vercel.app';
const TENANT = 'plus-ultra';

const TERMINAL_STATUSES = new Set(['signed', 'accepted', 'lost', 'cancelled', 'archived']);

function summarizeEstimate(e) {
  // Compact string the pricing lens can review without choking on noise.
  const pkg = e.calculated_packages || {};
  const customerName = e.customer_name || e.customer?.name || `customer ${e.customer_id?.slice(0, 8)}`;
  const lines = [
    `Estimate #${e.estimate_number} — ${customerName}`,
    `Proposal mode: ${e.proposal_mode || '(unset)'}`,
    `Pricing model: ${e.pricing_model || 'Local'}`,
    `Roof: ${e.roof_area_sqft || 0} sqft, ${e.roof_pitch || '?'} pitch, complexity ${e.complexity || '?'}`,
    e.planes ? `Planes: ${JSON.stringify(e.planes)}` : null,
    e.distance_km ? `Distance: ${e.distance_km} km` : null,
    e.extra_layers ? `Extra layers: ${e.extra_layers}` : null,
    e.redeck_sheets ? `Redeck: ${e.redeck_sheets} sheets` : null,
    e.chimneys ? `Chimneys: ${e.chimneys} (${e.chimney_size || '?'})` : null,
    e.skylights ? `Skylights: ${e.skylights}` : null,
    e.remediation_allowance ? `Remediation: $${e.remediation_allowance}` : null,
    `Status: ${e.status || 'open'}${e.locked ? ' (LOCKED)' : ''}`,
    `Tags: ${(e.tags || []).join(', ') || '(none)'}`,
    '',
    'Calculated packages:',
    Object.entries(pkg).map(([k, v]) => `  ${k}: total $${v?.total ?? '?'} (per-SQ $${v?.persq ?? '?'}, tax $${v?.tax ?? '?'})`).join('\n'),
  ].filter(Boolean);
  return lines.join('\n');
}

export async function runPeerAudit({ sinceHours = 24, limit = 50 } = {}) {
  const startedAt = Date.now();
  const report = {
    agent: 'peer-audit',
    role: 'QA / second-opinion',
    timestamp: new Date().toISOString(),
    sinceHours,
    reviewed: 0,
    findings: [],
    skipped: [],
    errors: [],
    totalCostUSD: 0,
  };

  // 1) Pull recent estimates
  let estimates = [];
  try {
    const r = await fetch(`${RYUJIN_BASE}/api/estimates?tenant=${TENANT}&limit=${limit}`, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'x-tenant-id': TENANT,
        ...(process.env.RYUJIN_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.RYUJIN_SERVICE_TOKEN.trim()}` } : {})
      }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    estimates = j.estimates || j.data || [];
  } catch (e) {
    report.errors.push(`Failed to fetch estimates: ${e.message}`);
    return report;
  }

  // 2) Filter to recently-touched + non-terminal
  const cutoff = Date.now() - sinceHours * 3600 * 1000;
  const candidates = estimates.filter(e => {
    if (TERMINAL_STATUSES.has((e.status || '').toLowerCase())) return false;
    const updated = new Date(e.updated_at || e.created_at || 0).getTime();
    return updated >= cutoff;
  });

  // 3) Run pricing lens on each
  for (const est of candidates) {
    const label = `#${est.estimate_number} ${est.customer_name || est.customer_id?.slice(0, 6)}`;
    try {
      const result = await peerReview({
        artifact: summarizeEstimate(est),
        lens: 'pricing',
        context: `Daily peer audit. Estimate ${label}, status=${est.status || 'open'}.`,
      });
      report.reviewed += 1;
      if (!result.ok) {
        report.errors.push(`${label}: ${result.error}`);
        continue;
      }
      // Cost track
      if (result.usage) {
        const inTok = result.usage.input_tokens || 0;
        const outTok = result.usage.output_tokens || 0;
        report.totalCostUSD += (inTok / 1_000_000) * 3 + (outTok / 1_000_000) * 15;
      }
      // Only surface non-pass verdicts — pass = silent good
      if (result.verdict === 'pass') {
        continue;
      }
      report.findings.push({
        estimate: label,
        estimate_id: est.id,
        verdict: result.verdict,
        summary: result.summary,
        issues: result.issues,
      });
    } catch (e) {
      report.errors.push(`${label}: crashed — ${e.message}`);
    }
  }

  // 4) Skipped count for visibility
  const totalRecent = estimates.filter(e => {
    const updated = new Date(e.updated_at || e.created_at || 0).getTime();
    return updated >= cutoff;
  }).length;
  report.skipped = {
    terminal_status: totalRecent - candidates.length,
    older_than_window: estimates.length - totalRecent,
  };

  report.elapsedMs = Date.now() - startedAt;
  report.totalCostUSD = Number(report.totalCostUSD.toFixed(4));
  return report;
}

// ─── HANDLER (on-demand + cron entry point) ──────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }
  const auth = requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  try {
    const sinceHours = Number(req.query?.since_hours) || 24;
    const limit = Number(req.query?.limit) || 50;
    const report = await runPeerAudit({ sinceHours, limit });
    return res.json({
      agent: 'peer-audit',
      role: 'QA / second-opinion',
      invocation: req.method === 'GET' ? 'on-demand' : 'cron',
      timestamp: new Date().toISOString(),
      data: report,
    });
  } catch (err) {
    console.error('[PeerAudit] FAILED:', err.message);
    return res.status(500).json({ agent: 'peer-audit', error: err.message });
  }
}
