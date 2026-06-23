// Ryujin OS — Invoice Studio API (build + send + track customer invoices).
//
// Backed by the existing proposal_blocks table (no new migration): each invoice
// is one row with block_type='custom_html', audience='internal', is_library=false,
// block_key='invoice:<slug>'. The 'invoice:' prefix keeps these fully isolated
// from proposal sections and ad scripts. The full invoice lives in content JSONB
// (frozen snapshot the public page renders verbatim). Mirrors api/ad-scripts.js.
//
// PUBLIC (share token is the auth — no session):
//   GET    /api/invoices?token=<shareToken>            - render data for the customer page
//   POST   /api/invoices?event=opened&token=<token>    - open beacon -> activity_log + sent->viewed
//
// PRIVILEGED (resolveSession + isPrivileged; tenant from the SESSION, never the
// client x-tenant-id header — same cross-tenant posture as api/settings.js):
//   GET    /api/invoices                  - list invoices for tenant
//   GET    /api/invoices?slug=<slug>      - single (also accepts ?id=<uuid>)
//   POST   /api/invoices  { estimateId }  - materialize from an accepted estimate
//   POST   /api/invoices  { customer, lineItems, ... }  - blank/manual invoice
//   PATCH  /api/invoices?id=<uuid>        - edit content | { status } | { markPaid, paymentMethod, amount }
//   POST   /api/invoices?action=send&id=<uuid>   - email the customer the link, status->sent
//   DELETE /api/invoices?id=<uuid>        - delete
//
// Outbound send is allowed for any privileged session (Cat builds AND sends
// invoices, the same scoped exception as proposals). Pricing is engine-set.

import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';
import { gmailSend } from '../lib/google.js';

const PREFIX = 'invoice:';
const DEFAULT_TAX_RATE = 0.15;
const APP_BASE = (process.env.APP_BASE_URL || 'https://ryujin-os.vercel.app').trim();
const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL || 'mackenzie.m@plusultraroofing.com').trim();

const PU_PAYMENT_DEFAULTS = {
  etransfer: 'plusultraroofing@gmail.com',
  chequePayableTo: 'Plus Ultra Roofing',
  cash: true,
  financeitLink: null,
  squareLink: null,
};

// ── helpers ──────────────────────────────────────────────────────
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function kebab(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'invoice';
}
function titleCase(s) {
  return String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
}
function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function resolveTaxRate(tenantId) {
  if (!tenantId) return DEFAULT_TAX_RATE;
  try {
    const { data } = await supabaseAdmin
      .from('tenant_settings').select('tax_rate').eq('tenant_id', tenantId).single();
    const rate = Number(data?.tax_rate);
    return rate > 0 && rate < 1 ? rate : DEFAULT_TAX_RATE;
  } catch { return DEFAULT_TAX_RATE; }
}

// Recompute money fields from lineItems + depositApplied. Source of truth on every
// create/edit so totals can never drift from the lines the customer sees.
function recomputeTotals(content) {
  const rate = Number(content.taxRate) > 0 ? Number(content.taxRate) : DEFAULT_TAX_RATE;
  const items = Array.isArray(content.lineItems) ? content.lineItems : [];
  let subtotal = 0;
  for (const li of items) {
    const price = Number(li.price) || 0;
    const qty = Number(li.qty) || 1;
    const amount = round2(price * qty);
    li.amount = amount;
    subtotal += amount;
  }
  subtotal = round2(subtotal);
  const hst = round2(subtotal * rate);
  const total = round2(subtotal + hst);
  const depositApplied = round2(content.depositApplied || 0);
  content.taxRate = rate;
  content.subtotal = subtotal;
  content.hst = hst;
  content.total = total;
  content.depositApplied = depositApplied;
  content.balanceDue = round2(total - depositApplied);
  return content;
}

async function nextSeq(tenantId) {
  const { data } = await supabaseAdmin
    .from('proposal_blocks').select('content').eq('tenant_id', tenantId).like('block_key', `${PREFIX}%`);
  let max = 0;
  (data || []).forEach((r) => { const s = Number(r?.content?.seq) || 0; if (s > max) max = s; });
  return max + 1;
}

// Resolve the customer-facing job-photo gallery URL for a customer. The gallery
// (photos-share.html) is keyed to a project share_token and unions
// estimate_photos + project_files for that customer, so any project belonging to
// the customer surfaces the whole job's photos. Returns null when the customer
// has no project with a live share_token (button simply won't render).
async function resolvePhotoShareUrl(tenantId, customerId) {
  if (!customerId) return null;
  try {
    const { data } = await supabaseAdmin
      .from('projects')
      .select('share_token, created_at')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .not('share_token', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data || !data.share_token) return null;
    return `${APP_BASE}/photos-share.html?share=${encodeURIComponent(data.share_token)}`;
  } catch {
    return null; // a gallery-link lookup hiccup must never block invoice creation
  }
}

// proposal_blocks row -> the invoice object the frontend speaks
function toInvoice(row) {
  const c = (row.content && typeof row.content === 'object') ? row.content : {};
  return {
    id: row.id,
    slug: String(row.block_key || '').replace(PREFIX, ''),
    name: row.name || c.number || 'Invoice',
    updated_at: row.updated_at,
    ...c,
  };
}

// Public-safe projection (drops nothing sensitive today, but the single seam to
// strip internal-only fields later lives here).
function toPublic(row) {
  const inv = toInvoice(row);
  return inv;
}

// ── public token resolution ──────────────────────────────────────
async function findByToken(token) {
  if (!token) return null;
  const { data } = await supabaseAdmin
    .from('proposal_blocks')
    .select('id, tenant_id, block_key, name, content, updated_at')
    .like('block_key', `${PREFIX}%`)
    .eq('content->>shareToken', token)
    .maybeSingle();
  return data || null;
}

// Record an open and, on the FIRST open only, email the owner. A single
// conditional update (filtered on notifiedOpen=false) both persists the open
// AND atomically claims the email, so concurrent opens never double-send and
// the open-tracking write is never clobbered by a separate stale write.
async function recordOpen(row) {
  const c = row.content || {};
  const nowIso = new Date().toISOString();
  const firstOpen = !c.notifiedOpen;
  const patch = { ...c };
  patch.viewedAt = patch.viewedAt || nowIso;
  if (patch.status === 'sent') patch.status = 'viewed';
  patch.history = [...(Array.isArray(c.history) ? c.history : []), { at: nowIso, event: 'opened' }];

  let claimed = true;
  if (firstOpen) {
    patch.notifiedOpen = true;
    const { data } = await supabaseAdmin.from('proposal_blocks')
      .update({ content: patch }).eq('id', row.id)
      .eq('content->notifiedOpen', false).select('id');
    claimed = !!(data && data.length);
  } else {
    await supabaseAdmin.from('proposal_blocks').update({ content: patch }).eq('id', row.id).then(() => {}, () => {});
  }
  if (!(firstOpen && claimed)) return;

  const subject = `INVOICE OPENED · ${c.customer?.name || 'Customer'} · ${c.number || ''}`.trim();
  const lines = [
    `${c.customer?.name || 'A customer'} just opened invoice ${c.number || ''} for the first time.`,
    ``,
    `Property:    ${c.property || c.customer?.address || '—'}`,
    `Balance due: $${Number(c.balanceDue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    `Opened:      ${nowIso}`,
    ``,
    `View: ${APP_BASE}/invoice-view.html?token=${c.shareToken}`,
    `— Ryujin OS`,
  ];
  await gmailSend(NOTIFY_EMAIL, subject, lines.join('\n')).catch(() => {});
}

// ══════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── PUBLIC: open beacon ──
  if (req.method === 'POST' && req.query.event) {
    const row = await findByToken(req.query.token);
    if (!row) return res.status(204).end(); // don't leak unknown tokens
    const c = row.content || {};
    await supabaseAdmin.from('activity_log').insert({
      tenant_id: row.tenant_id,
      entity_type: 'invoice_event',
      entity_id: row.id,
      action: String(req.query.event).slice(0, 64),
      details: { number: c.number || null, share_token: c.shareToken || null, at: new Date().toISOString() },
    }).then(() => {}, () => {});
    if (req.query.event === 'opened') {
      await recordOpen(row).catch(() => {});
    }
    return res.status(204).end();
  }

  // ── PUBLIC: render data by token ──
  if (req.method === 'GET' && req.query.token) {
    const row = await findByToken(req.query.token);
    if (!row) return res.status(404).json({ error: 'not_found' });
    return res.json({ invoice: toPublic(row) });
  }

  // ── PRIVILEGED gate (tenant from session, not client header) ──
  const session = await resolveSession(req);
  if (!isPrivileged(session)) {
    return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  }
  const tenantId = session.tenant_id;

  // ── GET list / single ──
  if (req.method === 'GET') {
    const { id, slug } = req.query;
    if (id || slug) {
      let q = supabaseAdmin.from('proposal_blocks')
        .select('id, block_key, name, content, updated_at')
        .eq('tenant_id', tenantId).like('block_key', `${PREFIX}%`);
      q = id ? q.eq('id', id) : q.eq('block_key', `${PREFIX}${slug}`);
      const { data, error } = await q.maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'not_found' });
      return res.json({ invoice: toInvoice(data) });
    }
    const { data, error } = await supabaseAdmin.from('proposal_blocks')
      .select('id, block_key, name, content, updated_at')
      .eq('tenant_id', tenantId).like('block_key', `${PREFIX}%`)
      .order('updated_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ invoices: (data || []).map(toInvoice) });
  }

  // ── POST send ──
  if (req.method === 'POST' && req.query.action === 'send') {
    const id = req.query.id || (req.body || {}).id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { data: row } = await supabaseAdmin.from('proposal_blocks')
      .select('id, content').eq('tenant_id', tenantId).eq('id', id).like('block_key', `${PREFIX}%`).maybeSingle();
    if (!row) return res.status(404).json({ error: 'not_found' });
    const c = row.content || {};
    const to = (req.body && req.body.to) || c.customer?.email;
    if (!to) return res.status(400).json({ error: 'no_customer_email' });
    const link = `${APP_BASE}/invoice-view.html?token=${c.shareToken}`;
    const subject = `Invoice ${c.number || ''} from Plus Ultra Roofing`.replace(/\s+/g, ' ').trim();
    const balance = Number(c.balanceDue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const body = [
      `Hi ${c.customer?.name || 'there'},`,
      ``,
      `Here is your invoice from Plus Ultra Roofing${c.property ? ` for ${c.property}` : ''}.`,
      `Balance due: $${balance} CAD.`,
      ``,
      `View and pay: ${link}`,
      ``,
      `Payment options are on the invoice (e-transfer, cheque, cash, financing, or card).`,
      `Questions? Call or text (506) 540-1052.`,
      ``,
      `Thank you,`,
      `Plus Ultra Roofing`,
    ].join('\n');
    try {
      await gmailSend(to, subject, body); // resolves on 2xx, throws on send failure
    } catch (e) {
      return res.status(502).json({ error: 'send_failed', detail: e?.message || 'unknown' });
    }
    const patch = { ...c };
    patch.status = patch.status === 'paid' ? 'paid' : 'sent';
    patch.sentAt = new Date().toISOString();
    patch.history = [...(Array.isArray(c.history) ? c.history : []), { at: patch.sentAt, event: `sent to ${to}` }];
    const { data: updated } = await supabaseAdmin.from('proposal_blocks')
      .update({ content: patch, updated_at: new Date().toISOString() }).eq('id', id).eq('tenant_id', tenantId)
      .select('id, block_key, name, content, updated_at').single();
    return res.json({ sent: true, to, invoice: toInvoice(updated) });
  }

  // ── POST create ──
  if (req.method === 'POST') {
    const b = req.body || {};
    const taxRate = await resolveTaxRate(tenantId);
    let content;

    if (b.estimateId) {
      const { data: est, error: estErr } = await supabaseAdmin.from('estimates')
        .select('id, tenant_id, estimate_number, customer_id, final_accepted_total, deposit_amount, deposit_status, selected_package, calculated_packages, customer:customers(full_name, address, city, email, phone, ghl_contact_id)')
        .eq('id', b.estimateId).eq('tenant_id', tenantId).maybeSingle();
      if (estErr) return res.status(500).json({ error: estErr.message });
      if (!est) return res.status(404).json({ error: 'estimate_not_found' });
      const pkgs = (est.calculated_packages && typeof est.calculated_packages === 'object') ? est.calculated_packages : {};
      const tierKey = est.selected_package || 'gold';
      const pkg = pkgs[tierKey] || {};
      const preTax = round2(Number(est.final_accepted_total) || Number(pkg.total) || Number(pkg.summary?.sellingPrice) || 0);
      const depositCents = Number(est.deposit_amount) || 0;
      const depositApplied = est.deposit_status === 'cleared' ? round2(depositCents / 100) : 0;
      const cust = est.customer || {};
      content = {
        estimateId: est.id,
        ghlContactId: cust.ghl_contact_id || null,
        customer: { name: cust.full_name || '', address: cust.address || '', email: cust.email || '', phone: cust.phone || '' },
        property: cust.address || '',
        taxRate,
        depositApplied,
        photoShareUrl: await resolvePhotoShareUrl(tenantId, est.customer_id),
        lineItems: [{
          name: `${titleCase(tierKey)} · Roof Replacement`,
          desc: '',
          price: preTax, qty: 1, taxable: true,
        }],
      };
    } else {
      // Blank / manual invoice
      const cust = (b.customer && typeof b.customer === 'object') ? b.customer : {};
      content = {
        estimateId: null,
        ghlContactId: b.ghlContactId || null,
        customer: { name: cust.name || '', address: cust.address || '', email: cust.email || '', phone: cust.phone || '' },
        property: b.property || cust.address || '',
        taxRate,
        depositApplied: round2(b.depositApplied || 0),
        photoShareUrl: typeof b.photoShareUrl === 'string' ? b.photoShareUrl : null,
        lineItems: Array.isArray(b.lineItems) && b.lineItems.length
          ? b.lineItems.map((li) => ({ name: String(li.name || ''), desc: String(li.desc || ''), price: Number(li.price) || 0, qty: Number(li.qty) || 1, taxable: li.taxable !== false }))
          : [{ name: '', desc: '', price: 0, qty: 1, taxable: true }],
      };
    }

    recomputeTotals(content);
    const seq = await nextSeq(tenantId);
    const nowIso = new Date().toISOString();
    content.seq = seq;
    content.number = `PU-INV-${String(seq).padStart(4, '0')}`;
    content.status = 'draft';
    content.shareToken = crypto.randomBytes(16).toString('hex');
    content.issueDate = nowIso.slice(0, 10);
    content.dueDate = b.dueDate || 'Upon receipt';
    content.paymentOptions = { ...PU_PAYMENT_DEFAULTS, ...(b.paymentOptions && typeof b.paymentOptions === 'object' ? b.paymentOptions : {}) };
    content.sentAt = null; content.viewedAt = null; content.paidAt = null; content.paymentMethod = null;
    content.notifiedOpen = false;
    content.history = [{ at: nowIso, event: 'created' }];

    const slug = `${kebab(content.property || content.customer.name)}-${seq}`;
    const row = {
      tenant_id: tenantId,
      block_key: `${PREFIX}${slug}`,
      block_type: 'custom_html',
      audience: 'internal',
      is_library: false,
      active: true,
      name: content.number,
      content,
      updated_at: nowIso,
    };
    const { data, error } = await supabaseAdmin.from('proposal_blocks')
      .upsert(row, { onConflict: 'tenant_id,block_key' })
      .select('id, block_key, name, content, updated_at').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ invoice: toInvoice(data) });
  }

  // ── PATCH edit / status / markPaid ──
  if (req.method === 'PATCH') {
    const id = req.query.id || (req.body || {}).id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { data: row } = await supabaseAdmin.from('proposal_blocks')
      .select('id, content').eq('tenant_id', tenantId).eq('id', id).like('block_key', `${PREFIX}%`).maybeSingle();
    if (!row) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const c = { ...(row.content || {}) };

    // Field edits (merge, then recompute money)
    if (b.customer && typeof b.customer === 'object') c.customer = { ...c.customer, ...b.customer };
    if (typeof b.property === 'string') c.property = b.property;
    if (typeof b.dueDate === 'string') c.dueDate = b.dueDate;
    if (Array.isArray(b.lineItems)) {
      c.lineItems = b.lineItems.map((li) => ({ name: String(li.name || ''), desc: String(li.desc || ''), price: Number(li.price) || 0, qty: Number(li.qty) || 1, taxable: li.taxable !== false }));
    }
    if (b.depositApplied != null) c.depositApplied = round2(b.depositApplied);
    if (b.paymentOptions && typeof b.paymentOptions === 'object') c.paymentOptions = { ...c.paymentOptions, ...b.paymentOptions };
    // Photo-gallery link: set to a string, or pass null/'' to clear it.
    if (b.photoShareUrl !== undefined) c.photoShareUrl = (typeof b.photoShareUrl === 'string' && b.photoShareUrl.trim()) ? b.photoShareUrl.trim() : null;
    recomputeTotals(c);

    // Mark paid (also records a manual payment ledger row — non-fatal if it fails).
    // Only act on the transition into paid so a double-click can't double-insert.
    const wasPaid = (row.content || {}).status === 'paid';
    if (b.markPaid && !wasPaid) {
      const nowIso = new Date().toISOString();
      c.status = 'paid';
      c.paidAt = nowIso;
      c.paymentMethod = b.paymentMethod || c.paymentMethod || 'other';
      c.history = [...(Array.isArray(c.history) ? c.history : []), { at: nowIso, event: `marked paid (${c.paymentMethod})` }];
      const amount = round2(b.amount != null ? b.amount : c.balanceDue);
      await supabaseAdmin.from('payments').insert({
        tenant_id: tenantId,
        payment_date: nowIso,
        customer_name: c.customer?.name || null,
        matched_estimate_id: isUuid(c.estimateId) ? c.estimateId : null,
        amount,
        invoice_description: c.number || 'Invoice',
        payment_method: c.paymentMethod,
        source: 'manual',
        status: isUuid(c.estimateId) ? 'matched' : 'unmatched',
        raw_meta: { invoice_number: c.number, invoice_share_token: c.shareToken, via: 'invoice-markpaid' },
      }).then(() => {}, () => {});
    } else if (typeof b.status === 'string' && ['draft', 'sent', 'viewed', 'paid', 'void'].includes(b.status)) {
      c.status = b.status;
    }

    const { data, error } = await supabaseAdmin.from('proposal_blocks')
      .update({ content: c, updated_at: new Date().toISOString() }).eq('id', id).eq('tenant_id', tenantId)
      .select('id, block_key, name, content, updated_at').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ invoice: toInvoice(data) });
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabaseAdmin.from('proposal_blocks')
      .delete().eq('tenant_id', tenantId).eq('id', id).like('block_key', `${PREFIX}%`);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export const config = { api: { bodyParser: { sizeLimit: '128kb' } } };
