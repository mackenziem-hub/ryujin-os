// Ryujin OS - Ad Script -> Word .docx export.
//
// GET /api/ad-script-export?id=<uuid>&format=docx
//   -> builds a styled, editable Word document from one stored ad script's HTML
//      and streams it back as a browser download.
//
// Ad scripts live in proposal_blocks with block_key 'adscript:<slug>' (see api/ad-scripts.js).
// The stored HTML uses a small known vocabulary: <h2>, <h3>, <p>, <ul><li>, <blockquote>,
// <mark class="hl-hook|hl-benefit|hl-flag">, <strong>, <em>, <br>. We walk it with a
// dependency-free string parser (no DOM on the server) and map each piece to a docx element.
//
// Auth mirrors api/ad-scripts.js: requireTenant + a privileged session.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ShadingType,
} from 'docx';

// Plus Ultra ember-manuscript palette (hex, no leading #)
const CHARCOAL = '1A1512';
const EMBER = 'E2581F';
const CREAM = 'F7EFE3';
const INK = '2A231E';
const QUOTE_CREAM = 'FBF5EC';
const HL_HOOK = 'F7E0B0';
const HL_BENEFIT = 'DCEBD6';
const HL_FLAG = 'F3D9E2';

// Decode the handful of HTML entities our scripts can contain.
function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&middot;/g, '·')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

// Turn the inline portion of an element (which may contain <mark>, <strong>, <em>, <br>
// and unknown tags) into an array of docx TextRun objects. Regex/string based on purpose:
// there is no DOM here. Unknown tags are stripped but their text is kept.
function inlineRuns(html, base) {
  const baseStyle = base || {};
  const runs = [];
  // Active formatting state as we scan token by token.
  const state = { bold: false, italic: false, highlight: null };

  // Token regex: opening/closing tags we care about, plus <br>. Everything else
  // (other tags) is matched as a tag and ignored; raw text falls through.
  const tokenRe = /<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g;
  let lastIndex = 0;
  let m;

  const pushText = (text) => {
    if (!text) return;
    const decoded = decodeEntities(text);
    if (!decoded) return;
    const opts = {
      text: decoded,
      font: 'Inter',
      size: 22,
      color: baseStyle.color || INK,
    };
    if (baseStyle.bold || state.bold) opts.bold = true;
    if (baseStyle.italic || state.italic) opts.italics = true;
    if (baseStyle.font) opts.font = baseStyle.font;
    if (baseStyle.size) opts.size = baseStyle.size;
    if (state.highlight) {
      opts.shading = { type: ShadingType.CLEAR, fill: state.highlight, color: 'auto' };
    }
    runs.push(new TextRun(opts));
  };

  while ((m = tokenRe.exec(html)) !== null) {
    // Text before this tag
    pushText(html.slice(lastIndex, m.index));
    lastIndex = tokenRe.lastIndex;

    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';

    if (tag === 'br') {
      runs.push(new TextRun({ break: 1 }));
      continue;
    }
    if (tag === 'strong' || tag === 'b') { state.bold = !closing; continue; }
    if (tag === 'em' || tag === 'i') { state.italic = !closing; continue; }
    if (tag === 'mark') {
      if (closing) { state.highlight = null; continue; }
      const cls = (attrs.match(/class\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
      if (/hl-hook/.test(cls)) state.highlight = HL_HOOK;
      else if (/hl-benefit/.test(cls)) state.highlight = HL_BENEFIT;
      else if (/hl-flag/.test(cls)) state.highlight = HL_FLAG;
      else state.highlight = HL_HOOK;
      continue;
    }
    // Unknown tag: strip it, keep going (its text falls through as later text).
  }
  // Trailing text after the last tag
  pushText(html.slice(lastIndex));

  if (runs.length === 0) runs.push(new TextRun({ text: '', font: 'Inter', size: 22, color: INK }));
  return runs;
}

// A charcoal-shaded band paragraph (used for h2 section bands + the cover).
function bandParagraph(runs, opts) {
  const o = opts || {};
  return new Paragraph({
    children: runs,
    heading: o.heading,
    alignment: o.alignment,
    shading: { type: ShadingType.CLEAR, fill: o.fill || CHARCOAL, color: 'auto' },
    spacing: { before: o.before == null ? 180 : o.before, after: o.after == null ? 120 : o.after },
  });
}

// Walk the block-level HTML into an array of docx Paragraph objects.
function htmlToParagraphs(html) {
  const paras = [];
  const src = String(html || '');

  // Block-level regex: capture the element name + inner content for the blocks we know,
  // scanning left to right. <ul> is expanded into its <li> children.
  const blockRe = /<\s*(h2|h3|p|blockquote|ul)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi;
  let m;
  let matchedAny = false;

  while ((m = blockRe.exec(src)) !== null) {
    matchedAny = true;
    const tag = m[1].toLowerCase();
    const inner = m[2] || '';

    if (tag === 'h2') {
      paras.push(bandParagraph(
        inlineRuns(inner, { bold: true, color: CREAM, size: 30 }),
        { heading: HeadingLevel.HEADING_1, fill: CHARCOAL },
      ));
    } else if (tag === 'h3') {
      paras.push(new Paragraph({
        children: inlineRuns(inner, { bold: true, color: EMBER, size: 26 }),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 160, after: 80 },
      }));
    } else if (tag === 'blockquote') {
      paras.push(new Paragraph({
        children: inlineRuns(inner, { italic: true, font: 'Georgia', color: INK, size: 24 }),
        shading: { type: ShadingType.CLEAR, fill: QUOTE_CREAM, color: 'auto' },
        spacing: { before: 140, after: 140 },
        indent: { left: 240, right: 240 },
      }));
    } else if (tag === 'ul') {
      const liRe = /<\s*li\b[^>]*>([\s\S]*?)<\s*\/\s*li\s*>/gi;
      let li;
      while ((li = liRe.exec(inner)) !== null) {
        const runs = inlineRuns(li[1], { color: INK });
        runs.unshift(new TextRun({ text: '- ', font: 'Inter', size: 22, color: EMBER, bold: true }));
        paras.push(new Paragraph({
          children: runs,
          spacing: { after: 60 },
          indent: { left: 240 },
        }));
      }
    } else { // p
      paras.push(new Paragraph({
        children: inlineRuns(inner, { color: INK }),
        spacing: { after: 120 },
      }));
    }
  }

  // If the HTML had no recognized block wrappers but does have text, emit it as one paragraph.
  if (!matchedAny) {
    const stripped = src.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (stripped) {
      paras.push(new Paragraph({
        children: inlineRuns(src, { color: INK }),
        spacing: { after: 120 },
      }));
    }
  }

  return paras;
}

// Cover block: a charcoal band with the brand line (ember) + the script name (large cream).
function coverParagraphs(name) {
  return [
    bandParagraph(
      [new TextRun({ text: 'PLUS ULTRA ROOFING', font: 'Inter', size: 24, bold: true, color: EMBER })],
      { fill: CHARCOAL, alignment: AlignmentType.LEFT, before: 0, after: 60 },
    ),
    bandParagraph(
      [new TextRun({ text: name, font: 'Inter', size: 44, bold: true, color: CREAM })],
      { fill: CHARCOAL, alignment: AlignmentType.LEFT, before: 0, after: 240 },
    ),
  ];
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Privileged gate; tenant from the SESSION, never the client x-tenant-id header.
  const session = await resolveSession(req);
  if (!isPrivileged(session)) {
    return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  }
  const tenantId = session.tenant_id;

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'id required' });

  const { data, error } = await supabaseAdmin
    .from('proposal_blocks')
    .select('name, content')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .like('block_key', 'adscript:%')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'not found' });

  const name = data.name || 'Ad Script';
  const html = (data.content && data.content.html) || '';

  try {
    const body = htmlToParagraphs(html);
    const children = coverParagraphs(name);
    if (body.length === 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'No content yet.', font: 'Inter', size: 22, color: INK, italics: true })],
        spacing: { before: 120 },
      }));
    } else {
      children.push(...body);
    }

    const doc = new Document({
      creator: 'Ryujin OS',
      title: name,
      sections: [{
        properties: {
          page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } },
        },
        children,
      }],
    });

    const buf = await Packer.toBuffer(doc);
    const safe = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'ad-script';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.docx"`);
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || 'docx build failed' });
  }
}

export default requireTenant(handler);
