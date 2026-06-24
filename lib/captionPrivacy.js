// Ryujin OS — Caption privacy backstop (shared)
//
// Hard, in-code address stripper for any social caption before it is persisted
// or published. The caption prompts already forbid addresses, but the May 29
// generator launch leaked street numbers in 3 of 4 drafts (projects.name is
// usually the street address), so we never trust the prompt alone. Addresses
// only: customer names are too ambiguous to regex without nuking legit words
// like "Plus Ultra", "Riverview", or "Moncton", so the prompt handles names.
//
// Used by lib/generatorCaption.js (draft creation), api/generator.js (approve +
// regenerate). City and province stay intact; only street references are cut.

// Two suffix lists. The full list applies only when a house NUMBER precedes it
// (a number + suffix is almost certainly a real address). The named-only list
// drops words that double as neighborhood / subdivision names common in the
// Moncton area (Heights, Terrace, Route, Circle) so legit copy like "Bayview
// Heights reroof" is not mangled when there is no house number. Ambiguous
// suffixes (Way, Place, Close, Trail) are excluded from both.
const STREET_TYPES_NUMBERED = 'Street|St|Road|Rd|Avenue|Ave|Court|Lane|Ln|Drive|Dr|Crescent|Cres|Boulevard|Blvd|Circle|Cir|Terrace|Heights|Highway|Hwy|Route';
const STREET_TYPES_NAMED = 'Street|St|Road|Rd|Avenue|Ave|Court|Lane|Ln|Drive|Dr|Crescent|Cres|Boulevard|Blvd|Highway|Hwy';

// A leading "at/on/in/near" is consumed with the address so we don't leave a
// dangling preposition ("complete at  in Riverview"). The preposition before a
// CITY is untouched because a bare city has no street suffix to match.
const PREP = '(?:(?:[Aa]t|[Oo]n|[Ii]n|[Nn]ear)\\s+)?';
const NUMBERED_ADDRESS = new RegExp(`\\b${PREP}\\d{1,5}\\s+([A-Z][A-Za-z'’]+\\s+){0,3}(${STREET_TYPES_NUMBERED})\\b`, 'g');
const NAMED_STREET = new RegExp(`\\b${PREP}[A-Z][A-Za-z'’]+\\s+(${STREET_TYPES_NAMED})\\b`, 'g');

// Strip street addresses + a few obvious leftover patterns, then tidy spacing
// and orphaned punctuation. Always returns a trimmed string.
export function sanitizeCaption(input) {
  let s = String(input == null ? '' : input);
  s = s.replace(NUMBERED_ADDRESS, '');           // "at 200 Lonsdale Dr"
  s = s.replace(NAMED_STREET, '');               // "on Lonsdale Drive"
  s = s.replace(/\b(?:at|on|near)\s+\d{1,5}\b/gi, ''); // dangling "at 200"
  s = s.replace(/\s*[—–]\s*/g, ', ');            // em/en dash -> comma (AI tell)
  s = s
    .replace(/\(\s*\)/g, '')                      // empty parens
    .replace(/\s{2,}/g, ' ')                      // collapse runs of spaces
    .replace(/\s+([,.!?;:])/g, '$1')             // space before punctuation
    .replace(/([,;:])(?=[,.;:])/g, '')           // doubled punctuation
    .replace(/^[\s,;:.]+/, '')                    // leading orphan punctuation
    .trim();
  return s;
}
