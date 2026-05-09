// One-shot Gamma deck generator for the Lee Baxter Pricing Audit.
// Reads the markdown, fires Gamma, polls until complete, prints share URL.

import fs from 'node:fs/promises';

const ENV_PATH = 'C:\\Users\\macke\\OneDrive\\Desktop\\Plus Ultra\\_brain-HAL\\.env';
const SOURCE_MD = 'C:\\Users\\macke\\OneDrive\\Desktop\\Plus Ultra\\Sales\\Lee Baxter Pricing Audit Deck.md';

const GAMMA_BASE = 'https://public-api.gamma.app/v1.0';
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_ATTEMPTS = 75;

async function loadEnv() {
  const raw = await fs.readFile(ENV_PATH, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

async function gammaPost(body) {
  const r = await fetch(`${GAMMA_BASE}/generations`, {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.GAMMA_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Gamma POST ${r.status}: ${text}`);
  return JSON.parse(text);
}

async function gammaPoll(id) {
  const r = await fetch(`${GAMMA_BASE}/generations/${encodeURIComponent(id)}`, {
    headers: { 'X-API-KEY': process.env.GAMMA_API_KEY }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Gamma GET ${r.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  await loadEnv();
  if (!process.env.GAMMA_API_KEY) throw new Error('GAMMA_API_KEY missing from .env');

  const inputText = (await fs.readFile(SOURCE_MD, 'utf8')).trim();
  console.log(`[gamma] Input length: ${inputText.length} chars`);

  const payload = {
    inputText,
    format: 'presentation',
    textMode: 'preserve',
    numCards: 11,
    cardSplit: 'inputTextBreaks',
    additionalInstructions: 'Plus Ultra Roofing pricing audit deck — internal use, Mac is the audience. Plus Ultra orange #ff6a00 accents on dark navy background. Direct, peer-to-peer, no fluff. Tables clean and scannable. Use roofing imagery only — asphalt shingle close-ups, metal roof panels, North American residential homes. Heading font Montserrat, body Inter. One concept per card.',
    cardOptions: { dimensions: 'fluid' },
    imageOptions: {
      source: 'aiGenerated',
      model: 'imagen-4-pro',
      style: 'cinematic photo of a North American residential roofing job, sharp detail of asphalt shingles or metal roof panels, professional roofer working, sunny day, natural light, no logos, no text overlays, photorealistic, shallow depth of field'
    },
    sharingOptions: { externalAccess: 'view' }
  };

  console.log('[gamma] Firing generation...');
  const startData = await gammaPost(payload);
  const generationId = startData.generationId || startData.id;
  if (!generationId) throw new Error('No generationId returned: ' + JSON.stringify(startData));
  console.log(`[gamma] generationId: ${generationId}`);

  for (let i = 1; i <= MAX_POLL_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    let data;
    try { data = await gammaPoll(generationId); }
    catch (e) { console.warn(`[gamma] poll ${i} error: ${e.message}`); continue; }
    const status = data.status || data.state;
    const url = data.gammaUrl || data.url || data.docUrl || data.shareUrl;
    process.stdout.write(`[gamma] poll ${i} status=${status}${url ? ' url=' + url : ''}\n`);
    if (status === 'completed' || status === 'complete' || status === 'done') {
      console.log('\n[gamma] DONE');
      console.log(`URL: ${url}`);
      return;
    }
    if (status === 'failed' || status === 'error') {
      console.error('[gamma] FAILED', data);
      process.exit(1);
    }
  }
  console.error('[gamma] timed out');
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
