// ═══════════════════════════════════════════════════════════════
// UNIFIED INBOX WATCH LIST (tenant_settings.inbox_config.watches)
//
// One list answers "ping me when X gets back to me" across BOTH inbound
// surfaces:
//   - GHL conversations: api/agents/inbox.js merges watches[].match into its
//     contact-name allowlist (whole-word match, always-notify).
//   - Gmail: api/feeders/gmail-watch.js surfaces every email from
//     watches[].email. Exact address only -- a domain watch would drown in
//     marketing blasts (e.g. noreply@qxo.com newsletters vs the rep you are
//     actually waiting on).
//
// Entry shape: { match?, email?, note?, expires_at? }
//   match       GHL contact-name token (whole word, case-insensitive)
//   email       exact email address, matched lowercased
//   note        context, shown in the notify reason + the Watches panel
//   expires_at  ISO timestamp; both consumers ignore the watch after this.
//               Watches are usually temporary ("waiting on a vendor this
//               week") -- expiry keeps the list from rotting into notify
//               fatigue. Absent = never expires.
//
// Managed from the Watches panel on /inbox.html via
// PATCH /api/settings?field=inbox_config  body { watches: [...full array] }.
// ═══════════════════════════════════════════════════════════════

// Non-expired, well-formed watches. A malformed expires_at counts as
// non-expiring rather than silently killing the watch.
export function activeWatches(cfg) {
  const list = Array.isArray(cfg?.watches) ? cfg.watches : [];
  const now = Date.now();
  return list.filter(w => {
    if (!w || typeof w !== 'object') return false;
    if (!String(w.match || '').trim() && !String(w.email || '').trim()) return false;
    if (w.expires_at) {
      const t = new Date(w.expires_at).getTime();
      if (Number.isFinite(t) && t <= now) return false;
    }
    return true;
  });
}

const MAX_WATCHES = 50;

// Validate + normalize a client-supplied watches array (the PATCH boundary).
// Returns { ok: true, watches } with trimmed strings + lowercased emails,
// or { ok: false, error }.
export function validateWatches(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'watches must be an array' };
  if (input.length > MAX_WATCHES) return { ok: false, error: `watches capped at ${MAX_WATCHES}` };
  const watches = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'each watch must be an object' };
    }
    const match = String(raw.match || '').trim().slice(0, 80);
    const email = String(raw.email || '').trim().toLowerCase().slice(0, 160);
    const note = String(raw.note || '').trim().slice(0, 160);
    if (!match && !email) {
      return { ok: false, error: 'each watch needs a contact name (match) or an email' };
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: `invalid watch email: ${email}` };
    }
    const entry = {};
    if (match) entry.match = match;
    if (email) entry.email = email;
    if (note) entry.note = note;
    if (raw.expires_at) {
      const t = new Date(raw.expires_at).getTime();
      if (!Number.isFinite(t)) return { ok: false, error: `invalid expires_at: ${raw.expires_at}` };
      entry.expires_at = new Date(t).toISOString();
    }
    watches.push(entry);
  }
  return { ok: true, watches };
}
