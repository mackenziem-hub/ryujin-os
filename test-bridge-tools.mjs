// Verify the Ryujin chat.js bridge tool wiring against a real running bridge.
// This is a one-shot integration check — not committed.
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const SECRET = crypto.randomBytes(32).toString('hex');
const PORT = 18475;
const BRIDGE_URL = `http://127.0.0.1:${PORT}`;

// Boot bridge
const bridgeDir = path.resolve(os.homedir(), 'OneDrive', 'Desktop', 'Shenron', 'desktop-bridge');
const child = spawn(process.execPath, [path.join(bridgeDir, 'src', 'server.js')], {
  env: { ...process.env, BRIDGE_HMAC_SECRET: SECRET, PORT: String(PORT), BRIDGE_MACHINE: 'desktop' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
child.stdout.on('data', d => log += d.toString());
child.stderr.on('data', d => log += d.toString());
await new Promise(r => setTimeout(r, 700));

// Inject env vars Ryujin chat.js will read
process.env.BRIDGE_HMAC_SECRET = SECRET;
process.env.BRIDGE_URL_DESKTOP = BRIDGE_URL;

// Stub the Google + Anthropic deps that chat.js won't touch
process.env.ACTION_BOARD_KEY = 'fake';
process.env.ESTIMATOR_KEY = 'fake';

// Pull executeTool out of chat.js — but it's not exported. We'll re-implement the
// fetch path in this test instead of importing it. This validates the bridge URL
// parsing + signing logic Ryujin uses, end to end.

function sign(method, urlPath, bodyStr) {
  const ts = Date.now();
  const bodyHash = crypto.createHash('sha256').update(bodyStr || '').digest('hex');
  const canonical = `${method}|${urlPath}|${ts}|${bodyHash}`;
  const sig = crypto.createHmac('sha256', SECRET).update(canonical).digest('hex');
  return { ts, sig };
}

let pass = 0, fail = 0;
function assert(c, m) { if (c) { pass++; console.log('PASS:', m); } else { fail++; console.log('FAIL:', m); } }

// Replicate the exact code path from executeTool (read_local_file with as=text)
async function callBridge(routePath, bodyObj) {
  const bodyStr = JSON.stringify(bodyObj);
  const { ts, sig } = sign('POST', routePath, bodyStr);
  const resp = await fetch(BRIDGE_URL + routePath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Bridge-Timestamp': String(ts),
      'X-Bridge-Signature': sig
    },
    body: bodyStr
  });
  return { status: resp.status, body: await resp.json() };
}

// 1. glob_local equivalent — find Chartersville folder
{
  const HOME = os.homedir();
  const pattern = (path.resolve(HOME, 'OneDrive', 'Desktop', 'Plus Ultra', 'Jobs', '*Chartersville*', '*')).replace(/\\/g, '/');
  const r = await callBridge('/glob', { pattern });
  assert(r.status === 200, 'glob returns 200');
  assert(r.body.matches.length > 0, 'glob found Chartersville files');
  console.log('  matches:', r.body.matches.length);
}

// 2. list_local_dir equivalent
{
  const HOME = os.homedir();
  const dir = path.resolve(HOME, 'OneDrive', 'Desktop', 'Plus Ultra', 'Jobs', '24 Chartersville Road');
  const r = await callBridge('/list', { path: dir });
  assert(r.status === 200, 'list returns 200');
  console.log('  entries:', r.body.entries.map(e => `${e.name} (${e.type})`).join(', '));
}

// 3. read_local_file with as=text on the docx
{
  const HOME = os.homedir();
  const file = path.resolve(HOME, 'OneDrive', 'Desktop', 'Plus Ultra', 'Jobs', '24 Chartersville Road', '24 Chartiersville Road job description.docx');
  const r = await callBridge('/read?as=text', { path: file, as: 'text' });
  assert(r.status === 200, 'read?as=text returns 200');
  assert(r.body.encoding === 'utf8', 'docx as=text returns utf8');
  assert(r.body.content.includes('Chartersville'), 'docx text contains expected phrase');
  console.log('  text preview:', r.body.content.slice(0, 80));
}

console.log(`\n${pass} passed, ${fail} failed`);

child.kill('SIGTERM');
await new Promise(r => setTimeout(r, 200));

if (fail > 0) {
  console.log('\nbridge log:\n' + log);
  process.exit(1);
}
process.exit(0);
