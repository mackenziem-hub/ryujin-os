// Ryujin OS — Generator caption voice (shared)
//
// Short, plain, human captions for Plus Ultra's auto-posted roof photos. No
// LLM: rotating phrasings keep the feed varied without AI mannerisms or an API
// dependency, and the photo does the talking. Used by BOTH the weekly agent
// (api/agents/generator.js) and the backlog backfill so the voice is identical.
//
// `i` drives the phrasing rotation AND the CTA cadence so a batch varies and a
// soft call-to-action lands on only ~1 in CTA_EVERY posts (not every one).

import { sanitizeCaption } from './captionPrivacy.js';

const OPENERS = [
  (c) => `New roof in ${c}.`,
  (c, m) => (m ? `Fresh ${m} roof in ${c}.` : `Fresh roof in ${c}.`),
  (c) => `Another one wrapped up in ${c}.`,
  (c) => `Roof complete in ${c}.`,
  (c) => `All done in ${c}.`,
  (c) => `Finished up another in ${c}.`,
];

export const CTA_EVERY = 4;

// Pull the persisted vision grade fields out of a media_pool tags array.
export function vmatFromTags(tags) {
  const t = (tags || []).find((x) => x.startsWith('vmat:'));
  return t ? t.slice(5) : null;
}
export function vscoreFromTags(tags) {
  const t = (tags || []).find((x) => x.startsWith('vscore:'));
  return t ? Number(t.slice(7)) || 0 : 0;
}

// Returns the caption text (string). Pass the photo's city + tags + batch index.
export function shortCaption({ city, tags, i = 0, website }) {
  const c = city || 'the Moncton area';
  const mat = vmatFromTags(tags);
  const matWord = mat && mat !== 'unknown' && mat !== 'other' ? mat : null;
  let text = OPENERS[i % OPENERS.length](c, matWord);
  if (i % CTA_EVERY === 0) text += ` Free inspections at ${website || 'plusultraroofing.com'}.`;
  return sanitizeCaption(text);
}
