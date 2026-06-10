#!/usr/bin/env node
// Post-deploy smoke for the Jarvis voice loop. Fails loud, exits non-zero on any failure.
//
// Usage: node --env-file=.env.local scripts/smoke-jarvis.mjs [base-url]
//   base-url defaults to https://ryujin-os.vercel.app (or SMOKE_BASE env)
//
// Asserts against the live deployment:
//   1. POST /api/tts unauthenticated     -> 401 (credit-burn gate closed)
//   2. POST /api/tts with service token  -> 200 audio/mpeg, body > 5KB
//   3. GET  /api/metrics unauthenticated -> 401
//   4. GET  /api/metrics with token      -> 200, contract v1, numeric signed.mtd.value
//   5. POST /api/chat mode:'speech'      -> SSE stream with a text frame and done:true

const BASE = process.argv[2] || process.env.SMOKE_BASE || 'https://ryujin-os.vercel.app';
const TOKEN = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
const TENANT = (process.env.SMOKE_TENANT || 'plus-ultra').trim();

if (!TOKEN) {
  console.error('[FAIL] RYUJIN_SERVICE_TOKEN missing from env. Run with --env-file=.env.local');
  process.exit(1);
}

const auth = { Authorization: `Bearer ${TOKEN}`, 'x-tenant-id': TENANT };
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' :: ' + detail : ''}`);
}

console.log(`Jarvis smoke vs ${BASE} (tenant ${TENANT})\n`);

// 1. tts unauthenticated must 401
try {
  const r = await fetch(`${BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'gate check' })
  });
  record('tts unauth -> 401', r.status === 401, `status ${r.status}`);
} catch (e) { record('tts unauth -> 401', false, e.message); }

// 2. tts with service token must return real audio
try {
  const r = await fetch(`${BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ text: 'Jarvis online. All systems nominal and the smoke test is running.' })
  });
  const ct = r.headers.get('content-type') || '';
  if (r.status === 200 && ct.includes('audio/mpeg')) {
    const buf = await r.arrayBuffer();
    record('tts authed -> audio/mpeg > 5KB', buf.byteLength > 5000, `${buf.byteLength} bytes, voice ${r.headers.get('x-voice-id')}`);
  } else {
    record('tts authed -> audio/mpeg > 5KB', false, `status ${r.status}, ct ${ct}, body ${(await r.text()).slice(0, 200)}`);
  }
} catch (e) { record('tts authed -> audio/mpeg > 5KB', false, e.message); }

// 3. metrics unauthenticated must 401
try {
  const r = await fetch(`${BASE}/api/metrics`);
  record('metrics unauth -> 401', r.status === 401, `status ${r.status}`);
} catch (e) { record('metrics unauth -> 401', false, e.message); }

// 4. metrics with token must return contract v1
try {
  const r = await fetch(`${BASE}/api/metrics`, { headers: auth });
  const j = await r.json().catch(() => null);
  const ok = r.status === 200 && !!j && j.contract === 'v1' && typeof j.signed?.mtd?.value === 'number';
  record('metrics authed -> contract v1', ok,
    ok ? `signed.mtd = ${j.signed.mtd.value}` : `status ${r.status}, body ${JSON.stringify(j).slice(0, 200)}`);
} catch (e) { record('metrics authed -> contract v1', false, e.message); }

// 4b. memory store unauthenticated must 401 (holds prefs, session logs, facts)
try {
  const r = await fetch(`${BASE}/api/memory?type=facts`);
  record('memory unauth -> 401', r.status === 401, `status ${r.status}`);
} catch (e) { record('memory unauth -> 401', false, e.message); }

// 4c. memory facts readable with service token
try {
  const r = await fetch(`${BASE}/api/memory?type=facts`, { headers: auth });
  const j = await r.json().catch(() => null);
  const ok = r.status === 200 && !!j && Array.isArray(j.facts);
  record('memory authed -> facts array', ok, ok ? `${j.count} facts` : `status ${r.status}`);
} catch (e) { record('memory authed -> facts array', false, e.message); }

// 5. chat speech mode must stream SSE text and terminate with done:true
try {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ message: 'How many open tickets do we have right now?', mode: 'speech' }),
    signal: ctrl.signal
  });
  if (r.status !== 200) {
    clearTimeout(timer);
    record('chat speech -> SSE text + done', false, `status ${r.status}, body ${(await r.text()).slice(0, 200)}`);
  } else {
    let sawText = false, sawDone = false, raw = '';
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += dec.decode(value, { stream: true });
      let idx;
      while ((idx = raw.indexOf('\n\n')) >= 0) {
        const frame = raw.slice(0, idx);
        raw = raw.slice(idx + 2);
        const line = frame.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        try {
          const obj = JSON.parse(line.slice(6));
          if (typeof obj.text === 'string' && obj.text.length) sawText = true;
          if (obj.done === true) sawDone = true;
        } catch { /* partial or non-JSON frame, keep reading */ }
      }
      if (sawDone) break;
    }
    clearTimeout(timer);
    record('chat speech -> SSE text + done', sawText && sawDone, `text=${sawText} done=${sawDone}`);
  }
} catch (e) { record('chat speech -> SSE text + done', false, e.message); }

const failed = results.filter(x => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error('SMOKE FAILED: ' + failed.map(f => f.name).join(' | '));
  process.exit(1);
}
console.log('SMOKE GREEN');
