// Fire a Manus task to generate ONE consolidated Gamma deck for Casey Realty.
// Source markdown at Plus Ultra/Proposals/_GAMMA_SOURCE_casey_realty_consolidated_2026-05-12.md
// Returns the new Gamma URL once Manus reports complete.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load Plus Ultra env (Manus key lives there)
const envPath = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/_brain/.env';
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}

const MANUS_KEY = (process.env.MANUS_API_KEY || '').trim();
if (!MANUS_KEY) { console.error('MANUS_API_KEY missing'); process.exit(1); }

const SOURCE_PATH = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Proposals/_GAMMA_SOURCE_casey_realty_consolidated_2026-05-12.md';
const sourceMd = readFileSync(SOURCE_PATH, 'utf8');

const BASE = 'https://api.manus.ai/v2';

async function manusFetch(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'x-manus-api-key': MANUS_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = { _raw: t }; }
  if (!r.ok) throw new Error(`Manus ${path} ${r.status}: ${typeof j === 'object' ? JSON.stringify(j) : t}`);
  return j;
}

const brief = `Generate ONE Gamma slide-deck presentation from the source document below. Use Gamma's API or your slide-generation tool to produce a polished, presentable deck.

CRITICAL CONTEXT — Customer-facing commercial roof inspection bundle:
- Prepared for David Creese, GM at Casey Realty (commercial property manager in Amherst, Nova Scotia)
- Covers THREE properties: 32 Church St (food bank, commercial flat), 21 Dickey St (commercial flat), 48-50 Albion St (asphalt shingle residential-style)
- Will be linked from a customer-facing proposal page and reviewed alongside a Loom video Mac will record reading off the deck

INSTRUCTIONS FOR THE DECK:
- ONE concept per slide. Do not cram. Mac will narrate, so the slide is reference / visual hierarchy.
- Minimal text, large hierarchy. Designed to be VIEWED at-a-glance.
- Professional, clean, trustworthy. No emoji.
- Brand: Plus Ultra Roofing (Riverview / Moncton, New Brunswick). Owner-operated commercial+residential roofer.
- Brand colors: navy #1a3a8c primary, yellow #fdcc02 accent, cream / off-white backgrounds.
- Typography: Montserrat for headings, Inter for body.
- Construction / roofing / contractor imagery only. No stock-office cliches.
- Use comparison tables for tiered options (Slide 4, 6, 8, 9 have explicit tables).

HARD RULES — REMOVE FROM DECK IF PRESENT:
- NO insurance language (no "GL cancelled", no "WCB out of good standing", no "currently restoring", no broker names like Guilherme or Sébastien)
- NO claims about Plus Ultra carrying or not carrying any specific insurance policy
- NO references to PU being "uninsured" or "underinsured" or "in the process of restoring coverage"
- The deck must read as a confident, professional inspection bundle — not a process explanation about why we can't sign yet

WHAT TO RETURN:
- The Gamma URL (https://gamma.app/docs/<id>) once the deck is generated
- The Gamma generation ID for tracking

Source document follows below. Generate the deck from it exactly — do not invent properties, prices, or findings not in the source.

---

${sourceMd}`;

console.log('Firing Manus task...');
const created = await manusFetch('/task.create', {
  message: { content: [{ type: 'text', text: brief }] },
  agent_profile: 'manus-1.6-max',
  interactive_mode: false,
  hide_in_task_list: false,
  share_visibility: 'private'
});

console.log(JSON.stringify(created, null, 2));

const taskId = created?.data?.task_id || created?.task_id;
const taskUrl = created?.data?.task_url || created?.task_url;
const shareUrl = created?.data?.share_url || created?.share_url;

if (!taskId) { console.error('No task_id returned'); process.exit(1); }

console.log('');
console.log('Task ID:', taskId);
console.log('Task URL:', taskUrl);
console.log('Share URL:', shareUrl);
console.log('');
console.log('Now polling task.listMessages until agent_status=stopped...');

// Save task metadata for resume / inspection
writeFileSync(
  'C:/Users/macke/.claude/projects/C--Users-macke/62e341ac-744e-4c4e-9722-251a60294feb/tool-results/casey_gamma_task.json',
  JSON.stringify({ taskId, taskUrl, shareUrl, created_at: new Date().toISOString() }, null, 2)
);
console.log('Task metadata saved.');
