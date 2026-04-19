// Ryujin OS — Marketing Clip Renderer
// Pipeline: download source → extract audio → Whisper transcribe → Haiku keyword flag
//           → generate ASS subs → ffmpeg 9:16 reframe + burn captions → upload rendered MP4
//
// Invoked by api/marketing-render.js. Stateful — mutates DB as it progresses.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { put } from '@vercel/blob';
import { supabaseAdmin } from './supabase.js';

const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const FONTS_DIR = path.resolve(process.cwd(), 'lib/assets/fonts');

const WHISPER_MODEL = 'whisper-1';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Target output: vertical 1080x1920 @ 9:16
const OUT_W = 1080;
const OUT_H = 1920;

// ─── Main entry ─────────────────────────────────────────────────
export async function renderClip(clipId) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `clip-${clipId}-`));
  try {
    await updateStatus(clipId, 'rendering');

    const { data: clip, error } = await supabaseAdmin
      .from('marketing_clips')
      .select('*, tenant:tenants(slug)')
      .eq('id', clipId)
      .single();
    if (error || !clip) throw new Error(`Clip not found: ${clipId}`);

    const brandColor = await getBrandColor(clip.tenant_id);

    // 1. Download source video
    const sourcePath = path.join(workDir, 'source.mp4');
    await downloadFile(clip.source_url, sourcePath);

    // 2. Extract audio for Whisper (mp3 mono 16kHz keeps well under 25MB)
    const audioPath = path.join(workDir, 'audio.mp3');
    await runFfmpeg([
      '-i', sourcePath,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k',
      '-y', audioPath,
    ]);

    // 3. Transcribe with Whisper (word-level timings)
    const transcript = await transcribe(audioPath);

    // 4. Flag emphasis words via Haiku
    const emphasisIndices = await flagEmphasis(transcript);

    // 5. Write ASS subtitle file
    const assPath = path.join(workDir, 'subs.ass');
    fs.writeFileSync(assPath, buildASS(transcript, new Set(emphasisIndices), hexToAss(brandColor)));

    // 6. Render final MP4 — 9:16 reframe + burn subs
    const renderedPath = path.join(workDir, 'out.mp4');
    await renderFinal(sourcePath, assPath, renderedPath);

    // 7. Thumbnail at 1s
    const thumbPath = path.join(workDir, 'thumb.jpg');
    await runFfmpeg(['-i', renderedPath, '-ss', '1', '-vframes', '1', '-q:v', '3', '-y', thumbPath]);

    // 8. Upload rendered + thumbnail to Vercel Blob
    const ts = Date.now();
    const slug = clip.tenant.slug;
    const renderedBlob = await put(
      `${slug}/marketing/${clipId}/${ts}-rendered.mp4`,
      fs.readFileSync(renderedPath),
      { access: 'public', contentType: 'video/mp4' }
    );
    const thumbBlob = await put(
      `${slug}/marketing/${clipId}/${ts}-thumb.jpg`,
      fs.readFileSync(thumbPath),
      { access: 'public', contentType: 'image/jpeg' }
    );

    // 9. Duration probe
    const duration = await probeDuration(renderedPath);

    // 10. Write result to DB
    const { error: upErr } = await supabaseAdmin
      .from('marketing_clips')
      .update({
        rendered_url: renderedBlob.url,
        thumbnail_url: thumbBlob.url,
        rendered_duration_seconds: duration,
        transcript,
        emphasis_indices: emphasisIndices,
        status: 'ready',
        error_message: null,
      })
      .eq('id', clipId);
    if (upErr) throw upErr;

    return { ok: true, clipId, rendered_url: renderedBlob.url };
  } catch (err) {
    await supabaseAdmin
      .from('marketing_clips')
      .update({ status: 'failed', error_message: err.message?.slice(0, 500) || String(err) })
      .eq('id', clipId);
    throw err;
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

// ─── Helpers ────────────────────────────────────────────────────

async function updateStatus(clipId, status) {
  await supabaseAdmin.from('marketing_clips').update({ status }).eq('id', clipId);
}

async function getBrandColor(tenantId) {
  const { data } = await supabaseAdmin
    .from('tenant_settings')
    .select('accent_color')
    .eq('tenant_id', tenantId)
    .single();
  return data?.accent_color || '#FF6B00';
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function probeDuration(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegStatic, ['-i', filePath, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (!m) return resolve(null);
      const [, h, min, s] = m;
      resolve(+h * 3600 + +min * 60 + parseFloat(s));
    });
  });
}

async function transcribe(audioPath) {
  const buf = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'audio.mp3');
  form.append('model', WHISPER_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return {
    text: json.text || '',
    words: (json.words || []).map((w) => ({
      word: (w.word || '').trim(),
      start: w.start,
      end: w.end,
    })),
  };
}

async function flagEmphasis(transcript) {
  if (!transcript.words?.length) return [];
  if (!ANTHROPIC_KEY) return heuristicEmphasis(transcript.words);

  const indexed = transcript.words.map((w, i) => `${i}:${w.word}`).join(' ');
  const prompt = `You tag emphasis words in short selfie-video captions (Hormozi-style pop).
Transcript with word indices:
${indexed}

Return ONLY a JSON array of word indices (numbers) to highlight as emphasis. Flag impactful nouns, verbs, numbers, names, strong adjectives. Skip articles, prepositions, conjunctions, filler words (um, uh, like, you know).
Aim for 25-40% of total words highlighted.
Output format: [0, 3, 5, 9]`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Haiku ${res.status}`);
    const json = await res.json();
    const text = json.content?.[0]?.text || '[]';
    const match = text.match(/\[[\d,\s]*\]/);
    if (!match) return heuristicEmphasis(transcript.words);
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.filter((n) => Number.isInteger(n) && n >= 0 && n < transcript.words.length) : [];
  } catch {
    return heuristicEmphasis(transcript.words);
  }
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'that', 'this',
  'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they', 'him', 'her', 'them', 'us',
  'my', 'your', 'his', 'their', 'our', 'me',
  'so', 'if', 'then', 'than', 'just', 'like', 'um', 'uh', 'okay', 'ok', 'yeah', 'well',
  'do', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'have', 'has', 'had',
]);

function heuristicEmphasis(words) {
  const indices = [];
  words.forEach((w, i) => {
    const clean = (w.word || '').toLowerCase().replace(/[^\w]/g, '');
    if (clean.length < 3) return;
    if (STOP_WORDS.has(clean)) return;
    indices.push(i);
  });
  return indices;
}

// ─── ASS subtitle generator (Hormozi-style) ─────────────────────

const CHUNK_SIZE = 3;

function buildASS(transcript, emphasisSet, brandColorAss) {
  const out = [];
  out.push('[Script Info]');
  out.push('ScriptType: v4.00+');
  out.push(`PlayResX: ${OUT_W}`);
  out.push(`PlayResY: ${OUT_H}`);
  out.push('WrapStyle: 0');
  out.push('');
  out.push('[V4+ Styles]');
  out.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
  // Alignment 2 = bottom-center. MarginV 480 pushes captions into lower-center (not edge).
  out.push('Style: Default,Montserrat,96,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,8,3,2,60,60,480,1');
  out.push('');
  out.push('[Events]');
  out.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  const words = transcript.words || [];
  for (let i = 0; i < words.length; i += CHUNK_SIZE) {
    const chunk = words.slice(i, i + CHUNK_SIZE);
    if (!chunk.length) continue;
    const start = formatAssTime(chunk[0].start);
    const end = formatAssTime(chunk[chunk.length - 1].end);
    const text = chunk.map((w, idx) => {
      const globalIdx = i + idx;
      const wordText = sanitizeAss((w.word || '').trim()).toUpperCase();
      if (emphasisSet.has(globalIdx)) {
        return `{\\c${brandColorAss}}${wordText}{\\c&H00FFFFFF&}`;
      }
      return wordText;
    }).join(' ');
    out.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
  }
  return out.join('\n');
}

function formatAssTime(sec) {
  if (typeof sec !== 'number' || isNaN(sec)) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec * 100) % 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function sanitizeAss(text) {
  return String(text).replace(/[{}\\]/g, '');
}

function hexToAss(hex) {
  const h = String(hex || '').replace('#', '').padStart(6, '0');
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

// ─── ffmpeg final render ────────────────────────────────────────

async function renderFinal(sourcePath, assPath, outputPath) {
  const assEsc = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  const fontsArg = fs.existsSync(FONTS_DIR) ? `:fontsdir=${FONTS_DIR.replace(/\\/g, '/').replace(/:/g, '\\:')}` : '';

  const vf = [
    // Auto-crop to 9:16 (center crop if source is wider, pad if narrower)
    `crop='min(iw,ih*9/16)':ih:'(iw-min(iw,ih*9/16))/2':0`,
    `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease`,
    `pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `ass=${assEsc}${fontsArg}`,
  ].join(',');

  await runFfmpeg([
    '-i', sourcePath,
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    '-y', outputPath,
  ]);
}
