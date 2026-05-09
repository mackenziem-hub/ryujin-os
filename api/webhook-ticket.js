// Ryujin OS — Inbound Webhook → Auto-create Action Board Ticket
//
// POST /api/webhook-ticket
//
// Designed for GHL / Automator workflows that need to create a Ryujin Crew
// Ops ticket when something happens externally (repair estimate accepted,
// inspection booked, etc.).
//
// Auth: shared secret. Pass either:
//   - header  `x-webhook-secret: <secret>`
//   - query   `?secret=<secret>`
// Secret is read from env `RYUJIN_WEBHOOK_SECRET`.
//
// Tenant: defaults to plus-ultra. Override via header `x-tenant-id` or query
// `?tenant=<slug>`.
//
// Body (JSON, all fields optional unless marked required):
// {
//   "title":        "Schedule repair · Jane Doe · 12 Pine St",   // required
//   "description":  "Repair: missing shingles. Total $1,250.",    // optional
//   "priority":     "high" | "medium" | "low",                    // default 'high'
//   "due_in_days":  7,                                            // default 7
//   "due_date":     "2026-05-14",                                 // overrides due_in_days
//   "assigned_to":  "<ryujin user id>",                           // optional
//   "tags":         ["repair","ghl_inbound"],                     // appended
//
//   // Customer linkage (any of these — webhook will resolve/create as needed)
//   "customer_id":      "<uuid>",
//   "ghl_contact_id":   "<ghl id>",
//   "customer_name":    "Jane Doe",
//   "customer_phone":   "(506) 555-0100",
//   "customer_email":   "jane@example.com",
//   "customer_address": "12 Pine St",
//   "customer_city":    "Moncton",
//
//   // Optional links
//   "estimate_id":  "<ryujin estimate uuid>",
//   "ghl_opportunity_id": "<ghl opp id>"
// }
//
// Response 201:
//   { "ok": true, "ticket": { id, ticket_number, title, status, due_date } }

import { supabaseAdmin } from '../lib/supabase.js';

const WEBHOOK_SECRET = (process.env.RYUJIN_WEBHOOK_SECRET || '').trim();

async function resolveTenant(req) {
  const slug = (req.headers['x-tenant-id'] || req.query.tenant || 'plus-ultra').toString().trim();
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, slug')
    .eq('slug', slug)
    .single();
  if (error || !data) return null;
  return data;
}

async function resolveOrCreateCustomer(tenantId, body) {
  if (body.customer_id) {
    const { data } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('id', body.customer_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (data) return data.id;
  }

  if (body.ghl_contact_id) {
    const { data } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('ghl_contact_id', body.ghl_contact_id)
      .maybeSingle();
    if (data) return data.id;
  }

  if (body.customer_name) {
    const { data } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('full_name', body.customer_name)
      .eq('address', body.customer_address || '')
      .maybeSingle();
    if (data) return data.id;

    const { data: created, error: createErr } = await supabaseAdmin
      .from('customers')
      .insert({
        tenant_id: tenantId,
        full_name: body.customer_name,
        phone: body.customer_phone || null,
        email: body.customer_email || null,
        address: body.customer_address || null,
        city: body.customer_city || null,
        province: body.customer_province || 'NB',
        ghl_contact_id: body.ghl_contact_id || null,
        source: 'ghl_webhook'
      })
      .select('id')
      .single();
    if (createErr) {
      console.error('[webhook-ticket] customer create failed', createErr);
      return null;
    }
    return created.id;
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const provided = (req.headers['x-webhook-secret'] || req.query.secret || '').toString().trim();
  if (!WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'RYUJIN_WEBHOOK_SECRET not configured on server' });
  }
  if (provided !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing webhook secret' });
  }

  const tenant = await resolveTenant(req);
  if (!tenant) return res.status(404).json({ error: 'Unknown tenant' });

  const body = req.body || {};
  if (!body.title) return res.status(400).json({ error: 'title is required' });

  const customerId = await resolveOrCreateCustomer(tenant.id, body);

  const dueDate = body.due_date
    ? body.due_date
    : new Date(Date.now() + (Number(body.due_in_days) || 7) * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);

  const tags = Array.from(new Set([
    ...(Array.isArray(body.tags) ? body.tags : []),
    'ghl_inbound',
    'auto_created'
  ]));

  const { data, error } = await supabaseAdmin
    .from('tickets')
    .insert({
      tenant_id: tenant.id,
      title: body.title,
      description: body.description || null,
      estimate_id: body.estimate_id || null,
      customer_id: customerId,
      assigned_to: body.assigned_to || null,
      priority: body.priority || 'high',
      status: 'open',
      due_date: dueDate,
      tags,
      notes: body.notes || []
    })
    .select('id, ticket_number, title, status, due_date, priority')
    .single();

  if (error) {
    console.error('[webhook-ticket] insert failed', error);
    return res.status(500).json({ error: 'Ticket insert failed', detail: error.message });
  }

  await supabaseAdmin.from('activity_log').insert({
    tenant_id: tenant.id,
    entity_type: 'ticket',
    entity_id: data.id,
    action: 'created',
    details: {
      source: 'webhook-ticket',
      ghl_contact_id: body.ghl_contact_id || null,
      ghl_opportunity_id: body.ghl_opportunity_id || null,
      via: 'inbound_webhook'
    }
  }).then(() => {}, () => {});

  return res.status(201).json({ ok: true, ticket: data });
}
