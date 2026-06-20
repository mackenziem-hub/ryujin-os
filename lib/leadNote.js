// Lead-note formatter. Turns a lead's metadata into a readable job card for the
// GHL contact note, instead of the raw JSON.stringify(metadata) dump the team
// used to see when they opened a contact. Pure + dependency-free so api/leads.js
// can import it and it can be unit-tested without the handler's env.
//
// Known Instant Estimator keys get friendly labels; any other keys fall back to
// "key: value" lines (never raw JSON), so a new source still reads cleanly.

const PITCH_LABELS = { walkable: 'walkable', moderate: 'moderate', steep: 'steep', very_steep: 'very steep' };
const CHIMNEY_LABELS = { none: 'no chimney', steel: 'steel chimney', masonry: 'masonry chimney' };

const KNOWN_KEYS = new Set([
  'sqft', 'sizePreset', 'pitch', 'complexity', 'chimneyType', 'postal', 'measured',
  'solar_sq', 'solar_pitch_band', 'solar_pitch_x12', 'solar_imagery_year', 'solar_center_dist_m',
  'wants_proposal', 'proposal_request'
]);

function squaresFrom(m) {
  if (m.solar_sq != null && !isNaN(Number(m.solar_sq))) return Number(m.solar_sq);
  if (m.sqft != null && !isNaN(Number(m.sqft))) return Math.round(Number(m.sqft) / 10) / 10; // sqft/100 -> squares, 1 decimal
  return null;
}

export function formatLeadNote(source, metadata) {
  const m = (metadata && typeof metadata === 'object') ? metadata : {};
  const lines = [`Inbound from ${source || 'unknown'}`];

  const measured = typeof m.measured === 'string' && m.measured.indexOf('solar') === 0;
  const sq = squaresFrom(m);
  const sqText = sq != null ? `${sq} sq` : null;
  const sqftText = (m.sqft != null && !isNaN(Number(m.sqft))) ? `${Number(m.sqft).toLocaleString()} sq ft` : null;

  // Roof line: size + pitch + how we know it.
  if (measured) {
    const pitch = m.solar_pitch_x12 != null ? `${m.solar_pitch_x12}/12` : '';
    const band = PITCH_LABELS[m.solar_pitch_band] || m.solar_pitch_band || '';
    const size = [sqText, sqftText ? `(${sqftText})` : null].filter(Boolean).join(' ');
    lines.push(`Roof: ${[size, [pitch, band].filter(Boolean).join(' ') + ' pitch'].filter(s => s && s.trim() !== 'pitch').join(', ')}, measured from aerial${m.solar_imagery_year ? ` (${m.solar_imagery_year})` : ''}`);
  } else if (sqText || sqftText || m.pitch) {
    const size = [sqText, sqftText ? `(${sqftText})` : null, m.sizePreset ? `${m.sizePreset} size` : null].filter(Boolean).join(' ');
    const pitch = m.pitch ? `${PITCH_LABELS[m.pitch] || m.pitch} pitch` : '';
    lines.push(`Roof: ${[size, pitch].filter(Boolean).join(', ')}, self-reported`);
  }

  // Inputs line: complexity + chimney + postal.
  const inputs = [
    m.complexity ? `${m.complexity} complexity` : null,
    m.chimneyType ? (CHIMNEY_LABELS[m.chimneyType] || m.chimneyType) : null,
    m.postal ? String(m.postal) : null
  ].filter(Boolean);
  if (inputs.length) lines.push(`Inputs: ${inputs.join(' · ')}`);

  // High-intent: the "online quote" CTA.
  if (m.wants_proposal) {
    lines.push(`> Requested an online quote${m.proposal_request ? `: ${m.proposal_request}` : ''}`);
  }

  // Anything not recognized: render as plain key/value, never raw JSON blob.
  const extra = [];
  for (const k of Object.keys(m)) {
    if (KNOWN_KEYS.has(k)) continue;
    const v = m[k];
    if (v === undefined || v === null || v === '') continue;
    let val;
    if (typeof v === 'object') {
      try { val = JSON.stringify(v).slice(0, 200); } catch { val = '[unserializable]'; }
    } else {
      val = String(v);
    }
    extra.push(`${k}: ${val}`);
  }
  if (extra.length) {
    lines.push('');
    lines.push(...extra);
  }

  return lines.join('\n');
}
