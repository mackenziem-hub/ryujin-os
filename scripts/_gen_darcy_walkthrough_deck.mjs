// One-shot Gamma deck generator for Darcy Walkthrough v1.1
// Reads the markdown from Plus Ultra/Sales/, strips speaker notes,
// fires Gamma generation, polls until complete, prints URL.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENV_PATH = 'C:\\Users\\macke\\OneDrive\\Desktop\\Plus Ultra\\_brain\\.env';
const SOURCE_MD = 'C:\\Users\\macke\\OneDrive\\Desktop\\Plus Ultra\\Sales\\Darcy Walkthrough Gamma Deck v1.md';

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

function extractDeckMarkdown(raw) {
  // Drop the Mac-only header (everything before SLIDE 1) and the speaker notes (everything after Resource index ends)
  const startIdx = raw.indexOf('# SLIDE 1');
  const endMarker = '## Speaker notes for Mac';
  const endIdx = raw.indexOf(endMarker);
  let body = startIdx >= 0 ? raw.slice(startIdx) : raw;
  if (endIdx >= 0) body = raw.slice(startIdx, endIdx);

  // Convert "# SLIDE N — Title" headers into clean Gamma slide markers.
  // Gamma uses `---` as slide separators (already present between slides).
  // Replace the prefix with just the title for cleaner generation.
  body = body.replace(/^# SLIDE \d+\s*[—-]\s*(.*)$/gm, '# $1');

  return body.trim();
}

async function gammaPost(body) {
  const r = await fetch(`${GAMMA_BASE}/generations`, {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.GAMMA_API_KEY,
      'Content-Type': 'application/json'
    },
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

  const raw = await fs.readFile(SOURCE_MD, 'utf8');
  const inputText = extractDeckMarkdown(raw);
  console.log(`[gamma] Input length: ${inputText.length} chars`);

  const payload = {
    inputText,
    format: 'presentation',
    textMode: 'preserve',
    numCards: 15,
    cardSplit: 'inputTextBreaks',
    additionalInstructions: 'Brand: Plus Ultra Roofing. Plus Ultra orange #ff6a00 accent on dark background. Modern, clean, peer-to-peer tone — this is a written-to-talk-through deck, not corporate. Construction and roofing imagery only, no stock office photos. Heading font Montserrat, body Inter. Use clear comparison tables for commission tiers. One concept per slide.',
    themeId: undefined,
    cardOptions: { dimensions: 'fluid' },
    imageOptions: {
      source: 'aiGenerated',
      model: 'imagen-4-pro',
      style: 'cinematic photo of a North American residential roofing job, asphalt shingle roof, professional roofer on a sunny day, natural light, no logos, no text overlays, photorealistic, shallow depth of field'
    },
    sharingOptions: { externalAccess: 'view' }
  };

  console.log('[gamma] Firing generation...');
  const startData = await gammaPost(payload);
  const generationId = startData.generationId || startData.id;
  if (!generationId) {
    console.error('[gamma] Unexpected response:', startData);
    throw new Error('No generationId returned');
  }
  console.log(`[gamma] generationId: ${generationId}`);

  for (let i = 1; i <= MAX_POLL_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    let data;
    try {
      data = await gammaPoll(generationId);
    } catch (e) {
      console.warn(`[gamma] poll ${i} error: ${e.message}`);
      continue;
    }
    const status = data.status || data.state;
    const url = data.gammaUrl || data.url || data.docUrl || data.shareUrl;
    process.stdout.write(`[gamma] poll ${i} status=${status}${url ? ' url=' + url : ''}\n`);

    if (status === 'completed' || status === 'complete' || status === 'done') {
      console.log('\n[gamma] DONE');
      console.log(`URL: ${url}`);
      console.log(`generationId: ${generationId}`);
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
