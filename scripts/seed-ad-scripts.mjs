// Seed the Ad Script Studio library by POSTing to the DEPLOYED /api/ad-scripts
// with the Ryujin service token (no local Supabase creds needed; the deployed app
// writes proposal_blocks with its own env creds).
//
// Usage:
//   RYUJIN_BASE=https://ryujin-os.vercel.app node scripts/seed-ad-scripts.mjs
// Token is read from _brain/.env (RYUJIN_SERVICE_TOKEN). Idempotent: explicit slugs
// upsert on (tenant, block_key), so re-running updates instead of duplicating.
import { readFileSync } from 'node:fs';

const BASE = (process.env.RYUJIN_BASE || 'https://ryujin-os.vercel.app').replace(/\/$/, '');
const TENANT = 'plus-ultra';
const MKT = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Marketing';
const ENVF = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/_brain/.env';

function readToken() {
  const m = readFileSync(ENVF, 'utf8').match(/^RYUJIN_SERVICE_TOKEN=(.*)$/m);
  if (!m) throw new Error('RYUJIN_SERVICE_TOKEN not in _brain/.env');
  return m[1].trim().replace(/^["']|["']$/g, '');
}
const TOKEN = readToken();

function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function inline(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>'); }

// Light markdown -> editor HTML. subOpts.hookHl wraps Hook-section bullets in hl-hook;
// subOpts.voQuote turns VO-section paragraphs into blockquotes.
function mdToHtml(md) {
  const lines = md.split('\n');
  let html = '', inList = false, para = [], curSub = '';
  const flush = () => { if (para.length) { const t = para.join(' ').trim(); if (t) { html += voActive() ? `<blockquote>${inline(t)}</blockquote>` : `<p>${inline(t)}</p>`; } para = []; } };
  const closeL = () => { if (inList) { html += '</ul>'; inList = false; } };
  const voActive = () => /\bVO\b|spoken/i.test(curSub);
  const hookActive = () => /hook/i.test(curSub);
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '');
    if (!l.trim() || l.trim() === '---') { flush(); closeL(); continue; }
    let m;
    if ((m = l.match(/^###\s+(.*)/))) { flush(); closeL(); curSub = m[1]; html += `<h3>${inline(m[1])}</h3>`; continue; }
    if ((m = l.match(/^#{1,2}\s+(.*)/))) { flush(); closeL(); curSub = ''; html += `<h2>${inline(m[1])}</h2>`; continue; }
    if ((m = l.match(/^\s*[-*]\s+(.*)/)) || (m = l.match(/^\s*\d+\.\s+(.*)/))) {
      flush(); if (!inList) { html += '<ul>'; inList = true; }
      const body = inline(m[1]);
      html += hookActive() ? `<li><mark class="hl-hook">${body}</mark></li>` : `<li>${body}</li>`;
      continue;
    }
    if ((m = l.match(/^>\s?(.*)/))) { flush(); closeL(); html += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
    if (l.trim().startsWith('|')) { flush(); closeL(); if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue; html += `<p>${inline(l.replace(/^\||\|$/g, '').split('|').map(s => s.trim()).join(' · '))}</p>`; continue; }
    para.push(l.trim());
  }
  flush(); closeL();
  return html;
}

function splitSections(md) {
  // returns [{heading, body}] split on '## '
  const parts = md.split(/^## /m).slice(1);
  return parts.map(p => { const nl = p.indexOf('\n'); return { heading: p.slice(0, nl).trim(), body: p.slice(nl + 1) }; });
}

async function post(entry) {
  const r = await fetch(`${BASE}/api/ad-scripts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT, Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(entry),
  });
  const t = await r.text();
  console.log(`  ${entry.slug}: HTTP ${r.status} ${r.ok ? 'ok' : t.slice(0, 160)}`);
  return r.ok;
}

const SCRIPTS_MD = readFileSync(`${MKT}/AD_SHOOT_SCRIPTS_2026-06-23.md`, 'utf8');
const INV_MD = readFileSync(`${MKT}/ACTIVE_COPY_INVENTORY_2026-06-23.md`, 'utf8');

// ---- 3 editable scripts (from the offer sections) ----
const offerMap = [
  { key: 'INSTANT ESTIMATOR', slug: 'script-instant-estimator', name: 'Instant Estimator' },
  { key: '10 COSTLY MISTAKES', slug: 'script-10-costly-mistakes', name: '10 Costly Mistakes' },
  { key: 'REVIVE REJUVENATION', slug: 'script-revive-rejuvenation', name: 'Revive Rejuvenation' },
];
const scriptSections = splitSections(SCRIPTS_MD).filter(s => /^OFFER/i.test(s.heading));

// ---- reference entries (from inventory sections) ----
function catFor(h) {
  const x = h.toLowerCase();
  if (x.includes('meta')) return 'meta_ad';
  if (x.includes('google')) return 'google_ad';
  if (x.includes('nurture') || x.includes('sequence')) return 'nurture';
  if (x.includes('funnel') || x.includes('landing') || x.includes('lead')) return 'funnel';
  return 'general';
}
const invSections = splitSections(INV_MD);

(async () => {
  console.log(`Seeding -> ${BASE} (tenant ${TENANT})`);
  console.log('Scripts:');
  let order = 0;
  for (const om of offerMap) {
    const sec = scriptSections.find(s => s.heading.toUpperCase().includes(om.key));
    if (!sec) { console.log(`  (missing ${om.key})`); continue; }
    await post({ slug: om.slug, name: om.name, kind: 'script', category: 'script', sort_order: order++, content: mdToHtml(sec.body), meta: { source: 'AD_SHOOT_SCRIPTS_2026-06-23' } });
  }
  console.log('Reference:');
  let ri = 0;
  for (const sec of invSections) {
    // skip the TL;DR table-only section, keep the substantive ones
    if (/^tl;?dr/i.test(sec.heading) || sec.body.trim().length < 80) continue;
    const cat = catFor(sec.heading);
    const slug = 'ref-' + sec.heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    await post({ slug, name: sec.heading.replace(/\s*\(.*?\)\s*$/, '').slice(0, 80), kind: 'reference', category: cat, sort_order: ri++, content: mdToHtml(sec.body), meta: { source: 'ACTIVE_COPY_INVENTORY_2026-06-23' } });
  }
  console.log('Done.');
})();
