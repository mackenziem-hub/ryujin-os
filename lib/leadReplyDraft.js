// ═══════════════════════════════════════════════════════════════
// LEAD REPLY DRAFT. Pure, deterministic first-touch composer for new
// inbound leads. The speed-to-lead lever: a reply written in Mackenzie's
// voice is ready the instant the lead lands, so the human can fire a
// first touch inside minutes instead of hours.
//
// HARD RULE: this NEVER sends. No IO, no LLM, no network, no DB. It only
// returns text. Sending stays a human action (Mac is sole sign-off, root
// CLAUDE.md). The "speed" is in the draft being ready + surfaced on the
// inbox row, not in any auto-send.
//
// Voice: _brain/ai-clone/voice-skill.md (warm same-day coordination mode):
// "Hey [Name]" opener, Mac here, contractions, one concrete next step
// (a call), the door left open ("better time"), no em dashes, no AI tells,
// no hope-you-are-well preamble, signs "-Mackenzie". Template, not generated,
// so it is instant in the lead-capture hot path and deterministic to test.
// ═══════════════════════════════════════════════════════════════

const BUSINESS_LINE = '(506) 616-4607';

function firstNameOf(name) {
  const t = String(name == null ? '' : name).trim();
  if (!t) return '';
  return t.split(/\s+/)[0];
}

function money(n) {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return '$' + Math.round(v).toLocaleString('en-CA');
}

/**
 * Compose the first-touch reply drafts for a new inbound lead.
 * Pure. Returns text only; nothing is sent.
 *
 * @param {object} lead
 * @param {string} [lead.name]       Customer name (first name is extracted).
 * @param {string} [lead.address]    Street address shown to make it personal.
 * @param {string} [lead.city]
 * @param {object} [lead.estimator]  { material, low, high, size } the IE returned.
 * @param {boolean} [lead.deduped]   True when this matched an existing contact (returning).
 * @returns {{ sms: string, email: {subject:string, body:string}, businessLine: string }}
 */
export function buildLeadReplyDraft({ name, address, city, estimator, deduped } = {}) {
  const fn = firstNameOf(name);
  const greet = fn ? `Hey ${fn},` : 'Hey there,';
  const est = (estimator && typeof estimator === 'object') ? estimator : {};
  const lo = money(est.low);
  const hi = money(est.high);
  const pkg = String(est.material == null ? '' : est.material).trim();
  const place = String(address == null ? '' : address).trim();

  const sawLine = deduped
    ? (place ? `Good to hear from you again, just saw your new estimate request come in for ${place}.`
             : `Good to hear from you again, just saw your new estimate request come in.`)
    : (place ? `Just saw your estimate request come in for ${place}.`
             : `Just saw your estimate request come in.`);

  // SMS first-touch: short, warm, one concrete next step, door left open.
  const sms = [
    `${greet} Mac here from Plus Ultra Roofing.`,
    sawLine,
    `I'll give you a quick call shortly.`,
    `If now's a bad time just text me back a better window and we'll go from there.`,
    `-Mackenzie`,
  ].join(' ');

  // Email follow-up: SMS for speed, email for detail (spec Part B, channel order).
  const emailLines = [greet, ''];
  emailLines.push(deduped
    ? (place ? `Good to hear from you again, just saw your new roof estimate request come in for ${place}.`
             : `Good to hear from you again, just saw your new roof estimate request come in.`)
    : (place ? `Just saw your roof estimate request come in for ${place}, thanks for reaching out.`
             : `Just saw your roof estimate request come in, thanks for reaching out.`));

  if (pkg && (lo || hi)) {
    const range = (lo && hi) ? `${lo} to ${hi}` : (lo || hi);
    emailLines.push('');
    emailLines.push(`Looks like the ${pkg} option came back around ${range} for a roof your size. That's a starting point, the real number comes once we confirm the details.`);
  }

  emailLines.push('');
  emailLines.push(`I'll give you a quick call shortly to walk through it and answer anything. If now's a bad time just reply with a better window and we'll line it up.`);
  emailLines.push('');
  emailLines.push('Talk soon :)');
  emailLines.push('');
  emailLines.push('-Mackenzie');
  emailLines.push('Plus Ultra Roofing');
  emailLines.push(BUSINESS_LINE);

  return {
    sms,
    email: { subject: 'Your Plus Ultra roof estimate', body: emailLines.join('\n') },
    businessLine: BUSINESS_LINE,
  };
}
