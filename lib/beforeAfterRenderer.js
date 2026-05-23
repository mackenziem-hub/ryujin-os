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

const DEFAULT_BRAND_COLOR = '#fb923c';
const FETCH_TIMEOUT_MS = 5000;

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

async function fetchImageBuffer(url) {
  if (!url) throw new Error('url required');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error('source image fetch failed: HTTP ' + r.status);
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
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

  <!-- BEFORE badge -->
  <rect x="40" y="${badgeY}" width="180" height="${badgeH}" rx="6" fill="rgba(0,0,0,0.78)" stroke="${brandColor}" stroke-width="2"/>
  <text x="130" y="${badgeY + badgeH / 2 + 10}" font-family="Arial, sans-serif" font-size="${badgeFontSize}" font-weight="700" letter-spacing="3" fill="${brandColor}" text-anchor="middle">BEFORE</text>

  <!-- AFTER badge -->
  <rect x="${halfW + 40}" y="${badgeY}" width="160" height="${badgeH}" rx="6" fill="rgba(0,0,0,0.78)" stroke="#4ade80" stroke-width="2"/>
  <text x="${halfW + 120}" y="${badgeY + badgeH / 2 + 10}" font-family="Arial, sans-serif" font-size="${badgeFontSize}" font-weight="700" letter-spacing="3" fill="#4ade80" text-anchor="middle">AFTER</text>

  <!-- Bottom strip -->
  <rect x="0" y="${stripY}" width="${width}" height="${stripH}" fill="url(#strip)"/>
  <text x="40" y="${stripY + stripH * 0.55}" font-family="Arial, sans-serif" font-size="${addrFont}" font-weight="800" fill="#ffffff">${escapeXml(addr)}</text>
  ${prod ? `<text x="40" y="${stripY + stripH * 0.55 + addrFont + 6}" font-family="Arial, sans-serif" font-size="${prodFont}" font-weight="500" fill="#e0e6f0">${escapeXml(prod)}</text>` : ''}

  <!-- PLUS ULTRA wordmark top-right with dark backplate for legibility on bright photos -->
  <rect x="${width - 200}" y="${badgeY}" width="160" height="${badgeH}" rx="6" fill="rgba(0,0,0,0.78)" stroke="${brandColor}" stroke-width="2"/>
  <text x="${width - 120}" y="${badgeY + 22}" font-family="Arial, sans-serif" font-size="16" font-weight="800" letter-spacing="3" fill="#ffffff" text-anchor="middle">PLUS ULTRA</text>
  <text x="${width - 120}" y="${badgeY + 38}" font-family="Arial, sans-serif" font-size="11" font-weight="500" letter-spacing="3" fill="${brandColor}" text-anchor="middle">ROOFING</text>
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
  const [beforeBuf, afterBuf] = await Promise.all([
    fetchImageBuffer(beforeUrl),
    fetchImageBuffer(afterUrl),
  ]);

  async function panel(buf) {
    return sharp(buf, { failOn: 'none' })
      .rotate() // apply EXIF orientation
      .resize(halfWidth, dims.height, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  }

  const [beforePanel, afterPanel] = await Promise.all([panel(beforeBuf), panel(afterBuf)]);

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
