// ═══════════════════════════════════════════════════════════════
// /i/:slug — short-link invite redirector with link-preview meta.
//
// Real invite URLs look like:
//   /accept-invite.html?token=4e195070762fcc678a8e1f9ad1fd457853939330
//
// That 40-char hex tail is fragile in SMS/iMessage/WhatsApp (auto-
// linkify eats trailing chars from the next line). The short form
//   /i/aj  →  /accept-invite.html?token=<live token>
// is safe to paste in chat without any wrap concerns.
//
// We RENDER HTML (not a 302) for the success path so iMessage/WhatsApp
// link unfurlers see og:* meta tags and a real preview card. Humans
// get auto-redirected via meta-refresh + JS replace.
//
// Resolution: look up users in tenant=plus-ultra where the first
// name (lowercase) matches the slug. If they still have a reset_token
// → render invite redirect. If already activated → /login.html.
// If invite expired / no token → friendly 410.
//
// Wired in vercel.json:
//   { "source": "/i/:slug", "destination": "/api/i?u=:slug" }
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';

const TENANT_SLUG = 'plus-ultra';
const APP_BASE = 'https://ryujin-os.vercel.app';
const OG_IMAGE = `${APP_BASE}/assets/textures/hero-ocean.jpg`;

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function metaHead({ title, description, url }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#060a14">
<title>${t}</title>
<meta name="description" content="${d}">
<meta property="og:type" content="website">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1168">
<meta property="og:image:height" content="784">
<meta property="og:url" content="${u}">
<meta property="og:site_name" content="Ryujin OS">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${OG_IMAGE}">`;
}

function styledBody(message) {
  return `<style>body{font-family:system-ui,sans-serif;background:#060a14;color:#d0daf0;min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;padding:24px}.card{background:rgba(20,30,50,0.85);border:1px solid rgba(34,211,238,0.16);border-radius:14px;padding:28px;max-width:420px}h1{margin:0 0 10px;font-size:1.2em;color:#22d3ee}p{margin:0;color:rgba(160,190,230,0.75);line-height:1.5}a{color:#22d3ee}</style><div class="card"><h1>Ryujin invite</h1><p>${message}</p></div>`;
}

function renderRedirect(res, { destination, name, role }) {
  const title = name ? `${name}, you're invited to Ryujin OS` : `You're invited to Ryujin OS`;
  const desc = `Tap to set your password and join the team.`;
  const head = metaHead({ title, description: desc, url: `${APP_BASE}${destination}` });
  const safeDest = escapeHtml(destination);
  const html = `<!doctype html><html><head>${head}<meta http-equiv="refresh" content="0; url=${safeDest}"><script>location.replace(${JSON.stringify(destination)});</script></head><body>${styledBody(`Redirecting to your invite… <a href="${safeDest}">Tap here if it doesn't open.</a>`)}</body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  return res.status(200).send(html);
}

function tellUser(res, status, message) {
  const head = metaHead({
    title: 'Ryujin OS invite',
    description: 'Team invite for Ryujin OS.',
    url: `${APP_BASE}/`,
  });
  const html = `<!doctype html><html><head>${head}</head><body>${styledBody(escapeHtml(message))}</body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(status).send(html);
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
    return renderRedirect(res, { destination: '/login.html', name: match.name, role: match.role });
  }

  if (!match.reset_token) {
    return tellUser(res, 410, 'No active invite for this user. Ask Mac for a fresh one.');
  }

  if (match.reset_token_expires_at && new Date(match.reset_token_expires_at) < new Date()) {
    return tellUser(res, 410, 'Invite link has expired. Ask Mac for a fresh one.');
  }

  return renderRedirect(res, {
    destination: `/accept-invite.html?token=${match.reset_token}`,
    name: match.name,
    role: match.role,
  });
}
