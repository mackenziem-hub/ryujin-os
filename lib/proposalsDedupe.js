// lib/proposalsDedupe.js - pure, dependency-free helpers behind the unified
// proposal index (api/proposals-index.js). Pulled out of the handler so the
// address-normalization + cross-store dedupe can be unit-tested without loading
// supabase / ghl / portalAuth (none of which the math needs).
//
// No network, no env, no side effects. No em dashes.

export function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

export function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

// Normalize a street address for dedup: lowercase, collapse whitespace, drop
// punctuation, strip unit/apt/suite suffixes, and fold common street-type
// spellings (Drive/Dr, Street/St, ...) so the same physical roof written two
// ways ("125 Kelly Dr" vs "125 Kelly Drive", "200 Lonsdale Dr" vs
// "200 Lonsdale Drive, unit 2") collapses to one key. Conservative on purpose:
// it only folds genuinely synonymous tokens, so two distinct addresses never
// collide.
const STREET_TYPES = [
  [/\b(drive|dr)\b/g, 'dr'],
  [/\b(street|str|st)\b/g, 'st'],
  [/\b(avenue|aven|ave|av)\b/g, 'ave'],
  [/\b(road|rd)\b/g, 'rd'],
  [/\b(court|crt|ct)\b/g, 'ct'],
  [/\b(crescent|cresc|cres|cr)\b/g, 'cres'],
  [/\b(boulevard|boul|blvd|blv)\b/g, 'blvd'],
  [/\b(route|rte|rt)\b/g, 'rte'],
  [/\b(highway|hwy)\b/g, 'hwy'],
  [/\b(lane|ln)\b/g, 'ln'],
  [/\b(place|pl)\b/g, 'pl'],
  [/\b(terrace|terr|ter)\b/g, 'terr'],
  [/\b(circle|circ|cir)\b/g, 'cir'],
  [/\b(trail|trl)\b/g, 'trl'],
  [/\b(parkway|pkwy)\b/g, 'pkwy'],
  [/\b(square|sq)\b/g, 'sq']
];
// Unit / apartment / suite designators that point at the same building. Stripped
// so "200 Lonsdale Dr unit 2" and "200 Lonsdale Dr" share a key. We only strip a
// numeric unit token, never a leading street number. The word forms need a word
// boundary; the "#" form is matched separately because "\b" never fires before a
// non-word char, so "# 2" / "#2" would otherwise survive and split a deal.
const UNIT_RE = /\b(?:unit|apt|apartment|suite|ste|bldg|building)\s*[a-z]?-?\d+[a-z]?\b/g;
const HASH_UNIT_RE = /#\s*[a-z]?-?\d+[a-z]?\b/g; // "#2", "# 2", "#12B"
const TRAILING_UNIT_RE = /\s[-,]\s*[a-z]?\d+[a-z]?\s*$/; // "... - 2" or "... , 3B" tail
export function addrKey(addr) {
  let s = norm(addr).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(HASH_UNIT_RE, ' ').replace(UNIT_RE, ' ');
  for (const [re, rep] of STREET_TYPES) s = s.replace(re, rep);
  s = s.replace(/\s+/g, ' ').trim();
  // A bare trailing unit number after the city (rare formatting) gets dropped,
  // but only when the string still has a leading civic number, so we never strip
  // a one-token address down to nothing.
  if (/^\d/.test(s)) s = s.replace(TRAILING_UNIT_RE, '').trim();
  return s.replace(/\s+/g, ' ').trim();
}

// One normalized lifecycle bucket per row so the UI can default to "pending"
// (everything still in front of Mac) and tuck closed / dead behind a toggle.
// "accepted" stays pending on purpose: a signed proposal still awaiting work
// (200 Lonsdale: signed, needs color + neighbor add-on) is exactly what Mac
// asked to keep visible.
export function bucketFor(statusText) {
  const s = norm(statusText);
  if (/(lost|declined|rejected|cancelled|abandon|dnd|unresponsive|not a fit|junk|telemarketer|dead|expired|archived)/.test(s)) return 'dead';
  if (/(complete|completed|paid|invoiced|in progress|in-progress|job in progress)/.test(s)) return 'closed';
  if (/(accept|signed|deposit|contract signed|won)/.test(s)) return 'accepted';
  if (/(published|sent|viewed|client responded|video sent|inspection completed)/.test(s)) return 'sent';
  if (/(ready|proposal ready)/.test(s)) return 'ready';
  return 'draft';
}
export const PENDING_BUCKETS = new Set(['draft', 'ready', 'sent', 'accepted']);

// Merge rows that are the same physical proposal across stores into one entry.
const BUCKET_RANK = { dead: 0, draft: 1, ready: 2, sent: 3, accepted: 4, closed: 5 };
// A customer label that is really an address echo or a bare placeholder, used to
// pick the most human name when two stores spell the same deal differently.
function nameScore(name) {
  const s = String(name || '').trim();
  if (!s || s === '(no name)') return -1;
  if (/^proposal\b/i.test(s)) return 0;      // native "Proposal 1234" placeholder
  if (/^\d/.test(s)) return 1;               // starts with a civic number = address echo
  return 10 + Math.min(s.length, 40);        // a real name, longer = more complete
}
export function mergeRows(group) {
  const stores = [...new Set(group.map(r => r.store))];
  let best = group[0];
  for (const r of group) if ((BUCKET_RANK[r.bucket] ?? 1) > (BUCKET_RANK[best.bucket] ?? 1)) best = r;
  const prices = group.map(r => num(r.fromPrice)).filter(Boolean);
  const fromPrice = prices.length ? Math.max(...prices) : null;
  const withLink = group.find(r => r.openUrl);
  const lastUpdated = group.map(r => r.lastUpdated).filter(Boolean).sort().slice(-1)[0] || null;
  // Pick the most human customer name and the most complete address across the
  // group. Stores spell the same deal differently (Donna Boosamra vs Donna Jean
  // Boosamra); we keep the most informative of each rather than first-wins.
  const bestName = group.map(r => r.customer).reduce((a, b) => nameScore(b) > nameScore(a) ? b : a, group[0].customer);
  const bestAddr = group.map(r => r.address).filter(Boolean).reduce((a, b) => String(b).length > String(a).length ? b : a, '');
  const pending = PENDING_BUCKETS.has(best.bucket);
  // Follow-up signal (PR #516): how long this pending quote has sat untouched,
  // plus a value-weighted urgency score so the warm book can be worked
  // highest-dollar x most-stale first. The default sort buries stale quotes
  // (most-recent-first); ?sort=followup surfaces them. A pending quote 30+ days
  // untouched is `stale`.
  const daysSinceUpdate = lastUpdated
    ? Math.max(0, Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 86400000))
    : null;
  const stale = pending && daysSinceUpdate != null && daysSinceUpdate >= 30;
  const followUpScore = pending ? Math.round((fromPrice || 0) * (daysSinceUpdate || 0)) : 0;
  return {
    customer: bestName || best.customer,
    address: bestAddr || '',
    fromPrice,
    noPrice: !fromPrice,
    status: best.status,
    bucket: best.bucket,
    pending,
    lastUpdated,
    daysSinceUpdate,
    stale,
    followUpScore,
    stores,
    openUrl: withLink ? withLink.openUrl : null,
    sources: group.map(r => ({ store: r.store, ref: r.ref, status: r.status, fromPrice: r.fromPrice, openUrl: r.openUrl }))
  };
}

// Dedupe is ADDRESS-FIRST: the normalized address is the primary merge key so the
// same physical roof from two stores collapses to ONE row even when the customer
// name is spelled differently between stores (the old name-first grouping left
// 8 such same-address pairs split: Boosamra, Pineau, McCardle/McArdle, ...).
// Addressless rows (some GHL opps / native drafts) group by name, then fold into
// an addressed deal only when that name maps to exactly one addressed group, so
// we never guess across ambiguous matches.
export function dedupe(rows) {
  const withAddr = rows.filter(r => r._addrKey);
  const noAddr = rows.filter(r => !r._addrKey);

  // 1. Group all addressed rows by normalized address (name-agnostic).
  const addrGroups = new Map();
  for (const r of withAddr) {
    if (!addrGroups.has(r._addrKey)) addrGroups.set(r._addrKey, []);
    addrGroups.get(r._addrKey).push(r);
  }

  // 2. Index addressed groups by the customer names they contain, so an
  //    addressless row for a known customer can fold into its addressed twin.
  //    A name pointing at more than one address stays ambiguous = no fold.
  const addrKeysByName = new Map();
  for (const [ak, g] of addrGroups) {
    for (const r of g) {
      const nk = r._nameKey;
      if (!nk) continue;
      if (!addrKeysByName.has(nk)) addrKeysByName.set(nk, new Set());
      addrKeysByName.get(nk).add(ak);
    }
  }

  const standaloneNoAddr = [];
  for (const r of noAddr) {
    const keys = r._nameKey ? addrKeysByName.get(r._nameKey) : null;
    if (keys && keys.size === 1) {
      addrGroups.get([...keys][0]).push(r);
    } else {
      standaloneNoAddr.push(r);
    }
  }

  // 3. Remaining addressless rows dedupe among themselves by name only.
  const byName = new Map();
  for (const r of standaloneNoAddr) {
    const k = r._nameKey || ('__' + r.store + (r.ref || ''));
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(r);
  }

  const out = [];
  for (const g of addrGroups.values()) out.push(mergeRows(g));
  for (const g of byName.values()) out.push(mergeRows(g));
  return out;
}
