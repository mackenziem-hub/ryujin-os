// Poll Manus task fa5hWyguroGytz8V5xSNt8 until done, extract Gamma URL,
// PATCH both Casey Realty proposal pages with the URL.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const envPath = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/_brain/.env';
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
// Also load Ryujin env for Supabase
for (const line of readFileSync('C:/Users/macke/OneDrive/Desktop/Ryujin/ryujin-os/.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}

const MANUS_KEY = (process.env.MANUS_API_KEY || '').trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const TASK_ID = 'ntdx7hqBpsyBTXJSxYnF2w';

const LOG = 'C:/Users/macke/.claude/projects/C--Users-macke/62e341ac-744e-4c4e-9722-251a60294feb/tool-results/casey_gamma_poll.log';
const log = (s) => { console.log(s); appendFileSync(LOG, s + '\n'); };

async function listMessages(cursor) {
  const body = { task_id: TASK_ID };
  if (cursor) body.cursor = cursor;
  const r = await fetch('https://api.manus.ai/v2/task.listMessages', {
    method: 'POST',
    headers: { 'x-manus-api-key': MANUS_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { _raw: t }; }
  if (!r.ok) throw new Error(`Manus listMessages ${r.status}: ${typeof j === 'object' ? JSON.stringify(j).slice(0, 400) : t.slice(0, 400)}`);
  return j;
}

function findGammaUrl(messages) {
  const blob = JSON.stringify(messages);
  const matches = blob.match(/https:\/\/gamma\.app\/docs\/[A-Za-z0-9_-]+/g);
  if (!matches) return null;
  // Most recent (last) match — should be the freshly generated deck
  return matches[matches.length - 1];
}

async function patchEstimate(shareToken, gammaUrl) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/estimates?share_token=eq.${shareToken}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'authorization': `Bearer ${SUPABASE_KEY}`,
      'content-type': 'application/json',
      'prefer': 'return=representation'
    },
    body: JSON.stringify({
      custom_prices: {
        _gamma_deck_url: gammaUrl,
        _gamma_deck_label: 'View Casey Realty Inspection Bundle'
      }
    })
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`PATCH ${shareToken} ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

log(`[${new Date().toISOString()}] starting poll for ${TASK_ID}`);
let status = null;
let gammaUrl = null;
let elapsed = 0;
const MAX_MINUTES = 25;

while (elapsed < MAX_MINUTES * 60_000) {
  let msgs;
  try {
    msgs = await listMessages();
  } catch (e) {
    log(`  poll error: ${e.message}`);
    await new Promise(r => setTimeout(r, 20_000));
    elapsed += 20_000;
    continue;
  }

  const items = msgs?.data?.messages || msgs?.messages || msgs?.data?.items || [];
  status = msgs?.data?.agent_status || msgs?.agent_status || (items[0] && (items[0].agent_status || items[0].status));
  log(`  t+${Math.floor(elapsed/1000)}s  status=${status}  items=${items.length}`);

  // Check for gamma URL in any message
  const found = findGammaUrl(items);
  if (found) {
    gammaUrl = found;
    log(`  GAMMA URL FOUND: ${gammaUrl}`);
  }

  if (status === 'stopped' || status === 'completed' || status === 'finished') {
    log('  task complete');
    if (!gammaUrl) gammaUrl = findGammaUrl(msgs);  // last-ditch in full payload
    break;
  }
  if (status === 'error' || status === 'failed') {
    log('  task FAILED');
    log(JSON.stringify(items.slice(-3), null, 2));
    break;
  }

  await new Promise(r => setTimeout(r, 30_000));
  elapsed += 30_000;
}

if (!gammaUrl) {
  log('NO GAMMA URL FOUND in completed task. Manual recovery needed.');
  log('Task URL: https://manus.im/app/' + TASK_ID);
  process.exit(2);
}

log(`Final Gamma URL: ${gammaUrl}`);
log('PATCHing both estimates...');
const r56 = await patchEstimate('plus-ultra-56', gammaUrl);
log(`  #56 patched: ${r56[0]?.share_token}`);
const r57 = await patchEstimate('plus-ultra-57', gammaUrl);
log(`  #57 patched: ${r57[0]?.share_token}`);

writeFileSync(
  'C:/Users/macke/.claude/projects/C--Users-macke/62e341ac-744e-4c4e-9722-251a60294feb/tool-results/casey_gamma_final.json',
  JSON.stringify({ taskId: TASK_ID, gammaUrl, patched: ['plus-ultra-56', 'plus-ultra-57'], completed_at: new Date().toISOString() }, null, 2)
);
log('DONE.');
