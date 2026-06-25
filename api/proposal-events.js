// Ryujin OS — Proposal Analytics Events
//
// POST /api/proposal-events
// Body: { estimateId?, shareToken, refId?, type, payload, at }
//
// Types: proposal_opened | tier_selected | video_played | scope_expanded | signature_started | ...
//
// Writes to activity_log with entity_type='proposal_event'. Public endpoint (share token is auth).
// Fire-and-forget from client — return 204 on success, don't block the page.
//
// On first proposal_opened per estimate, also emails the owner (NOTIFY_EMAIL).
// Idempotency is gated by an 'owner:open_notified' tag on the estimate; subsequent
// opens skip the email so the inbox doesn't get hammered by refreshes.

import { supabaseAdmin } from '../lib/supabase.js';
import { gmailSend } from '../lib/google.js';
import { publicBase } from '../lib/publicUrl.js';

const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL || 'mackenzie.m@plusultraroofing.com').trim();
const OPEN_NOTIFIED_TAG = 'owner:open_notified';

function fmtMoney(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

async function maybeNotifyFirstOpen(estId) {
  const { data: est } = await supabaseAdmin
    .from('estimates')
    .select('id, tenant_id, estimate_number, share_token, calculated_packages, selected_package, tags, customer:customers(full_name, address, phone, email)')
    .eq('id', estId)
    .single();
  if (!est) return;

  const tags = Array.isArray(est.tags) ? est.tags : [];
  if (tags.includes(OPEN_NOTIFIED_TAG)) return;

  // Atomic claim: filter on `not.cs.` so only the first concurrent request
  // wins the row update. Subsequent ones get 0 rows back and bail before
  // sending the gmailSend, defeating the duplicate-email race.
  const newTags = [...tags, OPEN_NOTIFIED_TAG];
  const { data: claimed, error: tagErr } = await supabaseAdmin
    .from('estimates')
    .update({ tags: newTags })
    .eq('id', est.id)
    .eq('tenant_id', est.tenant_id)
    .not('tags', 'cs', `{${OPEN_NOTIFIED_TAG}}`)
    .select('id');
  if (tagErr) {
    console.error('[proposal-events] tag flag write failed', tagErr.message);
    return;
  }
  if (!claimed || claimed.length === 0) return; // Lost the race; another invocation is sending

  const customer = est.customer || {};
  const refId = 'PU-' + (est.estimate_number || est.id.slice(0, 8));
  const shareToken = est.share_token || '';
  const proposalUrl = `${publicBase()}/proposal-client.html?share=${encodeURIComponent(shareToken)}`;
  const backofficeUrl = `https://ryujin-os.vercel.app/sales-proposal.html?estimate_id=${encodeURIComponent(est.id)}`;

  const pkgs = est.calculated_packages || {};
  const selectedKey = est.selected_package || 'gold';
  const tier = pkgs[selectedKey];
  const tierLine = tier
    ? `Expected tier: ${selectedKey} · ${fmtMoney(tier.total)} pre-HST · ${fmtMoney(tier.totalWithTax)} incl HST`
    : '';

  const subject = `PROPOSAL OPENED · ${customer.full_name || 'Customer'} · ${refId}`;
  const lines = [
    `${customer.full_name || 'A customer'} just opened proposal ${refId} for the first time.`,
    ``,
    `Customer: ${customer.full_name || '—'}`,
    `Address:  ${customer.address || '—'}`,
    `Phone:    ${customer.phone || '—'}`,
    `Email:    ${customer.email || '—'}`,
    tierLine,
    `Opened:   ${new Date().toISOString()}`,
    ``,
    `Client view: ${proposalUrl}`,
    `Back office: ${backofficeUrl}`,
    ``,
    `Subsequent opens from this customer will NOT re-notify — first-touch signal only.`,
    `— Ryujin OS`
  ].filter(Boolean);

  await gmailSend(NOTIFY_EMAIL, subject, lines.join('\n'));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { estimateId, shareToken, refId, type, payload, at } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type required' });
  if (!shareToken && !estimateId) return res.status(400).json({ error: 'shareToken or estimateId required' });

  // Resolve the estimate cheaply (share_token is indexed)
  let est = null;
  if (shareToken) {
    const { data } = await supabaseAdmin
      .from('estimates')
      .select('id, tenant_id')
      .eq('share_token', shareToken)
      .maybeSingle();
    est = data;
  } else if (estimateId) {
    const { data } = await supabaseAdmin
      .from('estimates')
      .select('id, tenant_id')
      .eq('id', estimateId)
      .maybeSingle();
    est = data;
  }

  if (!est) return res.status(204).end(); // Silently swallow unknown share tokens — don't leak info

  await supabaseAdmin.from('activity_log').insert({
    tenant_id: est.tenant_id,
    entity_type: 'proposal_event',
    entity_id: est.id,
    action: String(type).slice(0, 64),
    details: {
      payload: payload || null,
      share_token: shareToken || null,
      ref_id: refId || null,
      at: at || new Date().toISOString()
    }
  });

  if (type === 'proposal_opened') {
    await maybeNotifyFirstOpen(est.id).catch(e => console.error('[proposal-events] first-open notify failed', e?.message));
  }

  return res.status(204).end();
}

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };
