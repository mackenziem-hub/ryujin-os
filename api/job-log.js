// Ryujin OS — Per-Job Log Entries
//
// GET    /api/job-log?workorder_id=X          — entries for a WO
// GET    /api/job-log?sub_id=X&status=pending — entries by sub (used by sub portal)
// GET    /api/job-log?status=pending          — owner approval queue
// POST   /api/job-log                         — create entry (sub or owner)
// PUT    /api/job-log                         — update entry (owner: approve/deny, editor: edit)
// DELETE /api/job-log?id=X                    — owner delete
//
// Auto-approval (v2): on POST, if entry_type is in HARD_GATE_TYPES OR amount >=
// the sub's auto_approve_threshold_cad → status='pending' + email-alert to Mac.
// Otherwise → auto-approved (status='approved', auto_approved_at stamped).

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { gmailSend } from '../lib/google.js';

const HARD_GATE_TYPES = new Set(['scope_change', 'advance_payout', 'rate_suggestion', 'change_order']);
const ALERT_EMAIL = (process.env.NOTIFY_EMAIL || 'mackenzie.m@plusultraroofing.com').trim();

// Fire-and-forget alert. Routes through Gmail (the working notification path
// in this codebase — proposal-accept.js uses the same). When an Automator/SMS
// webhook is wired up, swap the body of this function to POST there too.
async function fireAlert(entry, wo, sub) {
  try {
    const addr = wo?.address || 'Unknown address';
    const desc = String(entry.description || '').slice(0, 240);
    const amt = Number(entry.amount) || 0;
    const subName = sub?.name || (entry.created_by_sub ? 'Sub' : 'Owner');
    const reviewUrl = `https://ryujin-os.vercel.app/admin-job-log.html`;
    const woUrl = `https://ryujin-os.vercel.app/admin-job-log.html?wo=${encodeURIComponent(wo?.id || '')}`;

    const subject = `[SUB PORTAL] ${subName} ${entry.entry_type} · ${addr} · $${amt.toFixed(2)}`;
    const body = [
      `${subName} just submitted a ${entry.entry_type.replace('_', ' ')} that needs your review.`,
      ``,
      `Address: ${addr}`,
      `Customer: ${wo?.customer_name || '—'}`,
      `Amount: $${amt.toFixed(2)}`,
      `Description: ${desc}`,
      entry.vendor ? `Vendor: ${entry.vendor}` : '',
      entry.entry_type === 'rate_suggestion' && entry.rate_suggestion_item
        ? `Suggested change: ${entry.rate_suggestion_item} from $${entry.rate_suggestion_current ?? '?'} → $${entry.rate_suggestion_proposed ?? '?'}`
        : '',
      ``,
      `Review: ${reviewUrl}`,
      `Direct link: ${woUrl}`,
      ``,
      `— Ryujin OS sub portal`
    ].filter(Boolean).join('\n');

    await gmailSend(ALERT_EMAIL, subject, body);
    return { sent: true, channel: 'gmail' };
  } catch (e) {
    console.error('[job-log] alert send failed:', e?.message);
    return { sent: false, error: e?.message };
  }
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { workorder_id, sub_id, paysheet_id, status, limit = 100 } = req.query;
    let q = supabaseAdmin
      .from('job_log_entries')
      .select('*, workorder:workorders(id, wo_number, address, customer_name), subcontractor:subcontractors(id, name, company)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));
    if (workorder_id) q = q.eq('workorder_id', workorder_id);
    if (sub_id) q = q.eq('subcontractor_id', sub_id);
    if (paysheet_id) q = q.eq('paysheet_id', paysheet_id);
    if (status) q = q.eq('status', status);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ entries: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.workorder_id || !body.entry_type || !body.description) {
      return res.status(400).json({ error: 'workorder_id, entry_type, description required' });
    }

    // Pull WO + sub in parallel so we can: (a) auto-link paysheet, (b) get sub's
    // auto-approve threshold, (c) build the alert email content.
    const [{ data: wo }, { data: subRow }] = await Promise.all([
      supabaseAdmin
        .from('workorders')
        .select('id, address, customer_name, linked_paysheet_id')
        .eq('tenant_id', tenantId).eq('id', body.workorder_id)
        .maybeSingle(),
      body.subcontractor_id
        ? supabaseAdmin
            .from('subcontractors')
            .select('id, name, company, auto_approve_threshold_cad, portal_visibility')
            .eq('tenant_id', tenantId).eq('id', body.subcontractor_id)
            .maybeSingle()
        : Promise.resolve({ data: null })
    ]);

    const paysheet_id = body.paysheet_id || wo?.linked_paysheet_id || null;
    const threshold = Number(subRow?.auto_approve_threshold_cad ?? 250);
    const amount = Number(body.amount) || 0;

    // Hard gate types always require approval; otherwise check threshold.
    const isHardGate = HARD_GATE_TYPES.has(body.entry_type) || amount >= threshold;

    const explicitStatus = body.status; // honor explicit status if owner posts
    const computedStatus = explicitStatus || (isHardGate ? 'pending' : 'approved');

    const row = {
      tenant_id: tenantId,
      workorder_id: body.workorder_id,
      paysheet_id,
      subcontractor_id: body.subcontractor_id || null,
      entry_type: body.entry_type,
      description: body.description,
      amount,
      vendor: body.vendor || null,
      photos: Array.isArray(body.photos) ? body.photos : [],
      status: computedStatus,
      created_by_sub: !!body.created_by_sub
    };

    // Rate suggestion fields (only relevant when entry_type='rate_suggestion')
    if (body.entry_type === 'rate_suggestion') {
      row.rate_suggestion_item = body.rate_suggestion_item || null;
      row.rate_suggestion_current = body.rate_suggestion_current != null ? Number(body.rate_suggestion_current) : null;
      row.rate_suggestion_proposed = body.rate_suggestion_proposed != null ? Number(body.rate_suggestion_proposed) : null;
    }

    // Stamp auto_approved_at if we auto-approved (and owner didn't override status)
    if (!explicitStatus && computedStatus === 'approved') {
      row.auto_approved_at = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from('job_log_entries').insert(row).select('*').single();
    if (error) return res.status(500).json({ error: error.message });

    // Fire-and-forget alert if pending (don't block the response)
    let alert_status = null;
    if (data.status === 'pending') {
      alert_status = await fireAlert(data, wo, subRow);
    }

    return res.status(201).json({
      ...data,
      _routing: {
        threshold_cad: threshold,
        is_hard_gate: isHardGate,
        auto_approved: data.status === 'approved' && !!data.auto_approved_at,
        alert: alert_status
      }
    });
  }

  if (req.method === 'PUT') {
    const { id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    updates.updated_at = new Date().toISOString();

    // If status is flipping to approved, stamp reviewed_at
    if (updates.status === 'approved' || updates.status === 'denied') {
      updates.reviewed_at = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from('job_log_entries')
      .update(updates)
      .eq('tenant_id', tenantId).eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabaseAdmin
      .from('job_log_entries').delete()
      .eq('tenant_id', tenantId).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
