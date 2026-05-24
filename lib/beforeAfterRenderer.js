// Ryujin OS - Before/After static image renderer
//
// Composites a before + an after photo side-by-side with brand overlay,
// BEFORE / AFTER badges, address + product label, and the tenant logo
// in the top-right corner. Returns a JPEG Buffer ready to upload to
// Vercel Blob (api/before-after-generate.js handles the upload).
//
// Output formats:
//   square    -> 1080 x 1080 (Instagram square)
//   landscape -> 1920 x 1080 (Facebook landscape + general web)
//
// Each side is fitted with cover-crop (fill, no letterbox). EXIF
// orientation is auto-applied via sharp's .rotate() default. Inputs
// are downsampled before composite so peak memory stays well under
// Vercel's 1024 MB function ceiling even on 10 MB+ phone uploads.
//
// All burned text is sanitized of em-dashes / en-dashes since this
// is customer-facing output.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import TextToSVG from 'text-to-svg';

const DEFAULT_BRAND_COLOR = '#fb923c';
const FETCH_TIMEOUT_MS = 5000;

// Pre-render text glyphs into SVG <path> data via text-to-svg (uses
// opentype.js under the hood). Vercel's serverless librsvg ignores
// @font-face data URLs, which produced tofu rectangles for every label
// in the prior version. Converting text -> path at module init removes
// the font-resolution dependency entirely: librsvg just draws shapes.
const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(__dirname, 'assets', 'fonts');
const ttsBold = TextToSVG.loadSync(join(FONT_DIR, 'Roboto-ExtraBold.ttf'));
const ttsMedium = TextToSVG.loadSync(join(FONT_DIR, 'Roboto-Medium.ttf'));

function pathFor(tts, text, { x, y, fontSize, anchor, letterSpacing = 0 }) {
  return tts.getD(text, { x, y, fontSize, anchor, letterSpacing });
}

const FORMATS = {
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
};

// Build the dash-class regex from code points so the source file itself
// stays clean of literal em-dash / en-dash glyphs (repo style rule).
// U+2014 em-dash, U+2013 en-dash, U+2012 figure-dash, U+2011 non-breaking hyphen.
const DASH_CLASS = new RegExp('[\\u2014\\u2013\\u2012\\u2011]', 'g');

function stripEmDash(s) {
  if (s == null) return '';
  return String(s).replace(DASH_CLASS, '-');
}

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Detect common image formats from their magic bytes. Returns a short label
// (jpeg|png|webp|gif|heic|unknown) so the renderer can fail loudly with a
// helpful message instead of feeding garbage into sharp under failOn:'none'.
function sniffImageFormat(buf) {
  if (!buf || buf.length < 12) return 'unknown';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  // WEBP: "RIFF....WEBP"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  // HEIC/HEIF: bytes 4..11 are "ftypheic", "ftypheix", "ftypmif1", "ftyphevc", "ftyphevx"
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.slice(8, 12).toString('ascii');
    if (['heic', 'heix', 'mif1', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'heic';
  }
  return 'unknown';
}

async function fetchImageBuffer(url, label) {
  if (!url) throw new Error(label + ': url required');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error(label + ': source image fetch failed (HTTP ' + r.status + ')');
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab);
    const fmt = sniffImageFormat(buf);
    if (fmt === 'unknown') {
      throw new Error(label + ': source URL did not return a recognized image (content-type "' + ct + '", ' + buf.length + ' bytes)');
    }
    if (fmt === 'heic') {
      throw new Error(label + ': HEIC source not supported by the renderer. Re-save the photo as JPEG or PNG and upload again.');
    }
    return buf;
  } finally {
    clearTimeout(timeout);
  }
}

// SVG-based text + badge overlay. Sharp composites SVG over the canvas
// (vector, sharp text, no font binary required). Returns a Buffer.
function buildOverlay({ width, height, address, product, brandColor }) {
  const halfW = Math.floor(width / 2);
  const badgeY = 40;
  const badgeH = 44;
  const badgeFontSize = 28;
  const stripH = Math.min(96, Math.floor(height * 0.11));
  const stripY = height - stripH;
  const addrFont = Math.floor(stripH * 0.42);
  const prodFont = Math.floor(stripH * 0.26);

  const addr = stripEmDash(address || 'Plus Ultra Roofing').trim();
  const prod = stripEmDash(product || '').trim();

  // Pre-render each text string into an SVG path. paint-order=stroke
  // draws the black outline first, then the colored fill on top, so
  // every label stays legible on any photo background.
  // text-to-svg's letterSpacing is in em (fraction of fontSize), not
  // pixels. Convert the pixel-equivalent spacing we want into ems so
  // each badge keeps the same visual tracking the old <text> overlay had.
  const badgeLsEm = 3 / badgeFontSize;
  const plusUltraLsEm = 2 / 16;
  const roofingLsEm = 2 / 11;
  const beforePath = pathFor(ttsBold, 'BEFORE', { x: 130, y: badgeY + badgeH / 2 + 10, fontSize: badgeFontSize, anchor: 'center baseline', letterSpacing: badgeLsEm });
  const afterPath = pathFor(ttsBold, 'AFTER', { x: halfW + 120, y: badgeY + badgeH / 2 + 10, fontSize: badgeFontSize, anchor: 'center baseline', letterSpacing: badgeLsEm });
  const plusUltraPath = pathFor(ttsBold, 'PLUS ULTRA', { x: width - 120, y: badgeY + 22, fontSize: 16, anchor: 'center baseline', letterSpacing: plusUltraLsEm });
  const roofingPath = pathFor(ttsBold, 'ROOFING', { x: width - 120, y: badgeY + 38, fontSize: 11, anchor: 'center baseline', letterSpacing: roofingLsEm });
  const addrPath = pathFor(ttsBold, addr, { x: 40, y: stripY + stripH * 0.55, fontSize: addrFont, anchor: 'left baseline' });
  const prodPath = prod ? pathFor(ttsMedium, prod, { x: 40, y: stripY + stripH * 0.55 + addrFont + 6, fontSize: prodFont, anchor: 'left baseline' }) : '';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="strip" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.78"/>
    </linearGradient>
  </defs>

  <!-- Vertical divider -->
  <rect x="${halfW - 3}" y="0" width="6" height="${height}" fill="${brandColor}"/>

  <!-- BEFORE label (path, stroked) -->
  <path d="${beforePath}" fill="${brandColor}" stroke="#000" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>

  <!-- AFTER label -->
  <path d="${afterPath}" fill="#4ade80" stroke="#000" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>

  <!-- Bottom strip -->
  <rect x="0" y="${stripY}" width="${width}" height="${stripH}" fill="url(#strip)"/>
  <path d="${addrPath}" fill="#ffffff"/>
  ${prod ? `<path d="${prodPath}" fill="#e0e6f0"/>` : ''}

  <!-- PLUS ULTRA wordmark top-right -->
  <path d="${plusUltraPath}" fill="#ffffff" stroke="#000" stroke-width="2.5" stroke-linejoin="round" paint-order="stroke"/>
  <path d="${roofingPath}" fill="${brandColor}" stroke="#000" stroke-width="2" stroke-linejoin="round" paint-order="stroke"/>
</svg>`;

  return Buffer.from(svg);
}

export async function renderBeforeAfterPair({
  beforeUrl,
  afterUrl,
  address,
  product,
  brandLogoUrl, // reserved for future raster logo overlay; SVG wordmark used today
  format = 'square',
  brandColor = DEFAULT_BRAND_COLOR,
} = {}) {
  if (!beforeUrl) throw new Error('beforeUrl required');
  if (!afterUrl) throw new Error('afterUrl required');
  const dims = FORMATS[format] || FORMATS.square;
  const halfWidth = Math.floor(dims.width / 2);

  // Pull both images in parallel, downsample to half-canvas with cover crop.
  // Label each fetch so an unsupported / broken source surfaces clearly in
  // the frontend error string ("before: ..." vs "after: ...") instead of
  // sharp silently producing a black panel under failOn:'none'.
  const [beforeBuf, afterBuf] = await Promise.all([
    fetchImageBuffer(beforeUrl, 'before'),
    fetchImageBuffer(afterUrl, 'after'),
  ]);

  async function panel(buf, label) {
    try {
      return await sharp(buf, { failOn: 'warning' })
        .rotate() // apply EXIF orientation
        .resize(halfWidth, dims.height, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
    } catch (e) {
      throw new Error(label + ': sharp decode failed (' + e.message + ')');
    }
  }

  const [beforePanel, afterPanel] = await Promise.all([panel(beforeBuf, 'before'), panel(afterBuf, 'after')]);

  // Stitch side-by-side onto a black canvas.
  const baseCanvas = await sharp({
    create: {
      width: dims.width,
      height: dims.height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      { input: beforePanel, top: 0, left: 0 },
      { input: afterPanel, top: 0, left: halfWidth },
    ])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  // Burn the SVG overlay on top.
  const overlay = buildOverlay({
    width: dims.width,
    height: dims.height,
    address,
    product,
    brandColor,
  });

  const final = await sharp(baseCanvas)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  return { buffer: final, width: dims.width, height: dims.height, mime: 'image/jpeg' };
}
