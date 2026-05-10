// ═══════════════════════════════════════════════════════════════
// /i/:slug — short-link invite redirector.
//
// Real invite URLs look like:
//   /accept-invite.html?token=4e195070762fcc678a8e1f9ad1fd457853939330
//
// That 40-char hex tail is fragile in SMS/iMessage/WhatsApp (auto-
// linkify eats trailing chars from the next line). The short form
//   /i/aj  →  302 → /accept-invite.html?token=<live token>
// is safe to paste in chat without any wrap concerns.
//
// Resolution: look up users in tenant=plus-ultra where the first
// name (lowercase) matches the slug. If they still have a reset_token
// → redirect to accept-invite. If already activated → /login.html.
// If invite expired / no token → 410 with a friendly note.
//
// Wired in vercel.json:
//   { "source": "/i/:slug", "destination": "/api/i?u=:slug" }
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';

const TENANT_SLUG = 'plus-ultra';

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function tellUser(res, status, message) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(status).send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ryujin invite</title><style>body{font-family:system-ui,sans-serif;background:#060a14;color:#d0daf0;min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;padding:24px}.card{background:rgba(20,30,50,0.85);border:1px solid rgba(34,211,238,0.16);border-radius:14px;padding:28px;max-width:420px}h1{margin:0 0 10px;font-size:1.2em;color:#22d3ee}p{margin:0;color:rgba(160,190,230,0.75);line-height:1.5}</style><div class="card"><h1>Ryujin invite</h1><p>${escapeHtml(message)}</p></div>`);
}

export default async function handler(req, res) {
  const slug = String(req.query.u || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!slug) return tellUser(res, 400, 'Missing user — link should look like /i/aj.');

  const { data: tenant, error: tErr } = await supabaseAdmin
    .from('tenants').select('id').eq('slug', TENANT_SLUG).single();
  if (tErr || !tenant) return tellUser(res, 500, 'Tenant lookup failed.');

  const { data: users, error: uErr } = await supabaseAdmin
    .from('users')
    .select('id, name, role, reset_token, reset_token_expires_at, password_hash')
    .eq('tenant_id', tenant.id);
  if (uErr) return tellUser(res, 500, 'User lookup failed.');

  const match = (users || []).find(u => {
    const first = (u.name || '').toLowerCase().split(/\s+/)[0];
    return first === slug;
  });
  if (!match) return tellUser(res, 404, `No teammate matches "${slug}". Ask Mac for a fresh link.`);

  if (match.password_hash && !match.reset_token) {
    res.setHeader('Location', '/login.html');
    return res.status(302).end();
  }

  if (!match.reset_token) {
    return tellUser(res, 410, 'No active invite for this user. Ask Mac for a fresh one.');
  }

  if (match.reset_token_expires_at && new Date(match.reset_token_expires_at) < new Date()) {
    return tellUser(res, 410, 'Invite link has expired. Ask Mac for a fresh one.');
  }

  res.setHeader('Location', `/accept-invite.html?token=${match.reset_token}`);
  return res.status(302).end();
}
