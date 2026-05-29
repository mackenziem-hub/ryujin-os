// ═══════════════════════════════════════════════════════════════
// /api/google-cal: read-only window into Mac's consolidated
// Google Calendar via its secret ICS (iCal) URL. Phase 1 of the
// /calendar.html build (see PR feat/calendar-v1). Hard appointments
// like vendor calls, lunches, customer site visits already live in
// Google Calendar; this exposes them alongside Ryujin's own data
// (installs, GHL inspection bookings) without writing back.
//
//   GET /api/google-cal?days=7
//   Headers: Authorization: Bearer <session token>, x-tenant-id
//
// Config:
//   GOOGLE_CALENDAR_ICS_URL: Google Calendar's "Secret address in
//   iCal format". Set in Vercel env. Single-tenant for now. If we
//   ever onboard a second tenant that needs this, move to a
//   per-tenant column (see migration slot 075+).
//
// Why ICS and not OAuth: zero auth dance, no refresh tokens, the
// URL itself is the secret. Trade-off: Google propagates ICS
// changes with ~1h lag, so brand-new events may not show up for
// up to an hour.
// ═══════════════════════════════════════════════════════════════

import { resolveSession } from '../lib/portalAuth.js';

// Unfold per RFC 5545 §3.1: any line that starts with a space or tab
// is a continuation of the prior line and must be joined without the
// leading whitespace. Without unfolding, long SUMMARYs/DESCRIPTIONs
// get truncated mid-line.
function unfold(text) {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

// Parse one VEVENT block (lines between BEGIN:VEVENT / END:VEVENT)
// into a normalized object. Returns null if start/end can't be parsed.
function parseEvent(lines) {
  const ev = {};
  for (const line of lines) {
    const colonAt = line.indexOf(':');
    if (colonAt < 0) continue;
    const keyPart = line.slice(0, colonAt);
    const value = line.slice(colonAt + 1);
    const [key, ...paramsArr] = keyPart.split(';');
    const params = {};
    for (const p of paramsArr) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq)] = p.slice(eq + 1);
    }
    switch (key) {
      case 'UID': ev.uid = value; break;
      case 'SUMMARY': ev.summary = unescapeIcs(value); break;
      case 'DESCRIPTION': ev.description = unescapeIcs(value); break;
      case 'LOCATION': ev.location = unescapeIcs(value); break;
      case 'STATUS': ev.status = value; break;
      case 'DTSTART': ev.startTime = parseIcsDate(value, params); ev.allDay = params.VALUE === 'DATE'; break;
      case 'DTEND': ev.endTime = parseIcsDate(value, params); break;
      case 'ORGANIZER': ev.organizer = (value.match(/mailto:([^;]+)/i) || [])[1] || null; break;
    }
  }
  if (!ev.startTime) return null;
  return ev;
}

// SUMMARY:Some \, escaped text\nwith newline → "Some , escaped text\nwith newline"
function unescapeIcs(s) {
  return String(s || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// DTSTART forms we handle:
//   20260601T130000Z          → UTC timestamp
//   20260601T130000           → floating local (treat as Halifax for Plus Ultra v1)
//   20260601                  → all-day (VALUE=DATE)
//   TZID=America/Halifax + 20260601T130000 → use TZID
// Returns ISO 8601 string in UTC, or null if unparseable.
function parseIcsDate(value, params) {
  const m = String(value || '').trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) {
    // All-day. Anchor to noon UTC so day-bucketing on either coast
    // resolves to the calendar day the user intended.
    return new Date(`${y}-${mo}-${d}T12:00:00Z`).toISOString();
  }
  if (z) return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`).toISOString();
  // Floating or TZID. Without a proper IANA tz library we approximate
  // by treating the wall time as Halifax (Mac's home tz). This is good
  // enough for display; off by 1h during DST transitions twice a year.
  // GOOGLE_CALENDAR_TZ_OFFSET_HOURS env can override (e.g. -3 for ADT).
  const offset = parseFloat(process.env.GOOGLE_CALENDAR_TZ_OFFSET_HOURS || '-3');
  const local = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  return new Date(local - offset * 3600 * 1000).toISOString();
}

function parseIcs(text) {
  const lines = unfold(text);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = []; continue; }
    if (line === 'END:VEVENT') {
      if (cur) {
        const ev = parseEvent(cur);
        if (ev) events.push(ev);
      }
      cur = null;
      continue;
    }
    if (cur) cur.push(line);
  }
  return events;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required' });

  const icsUrl = (process.env.GOOGLE_CALENDAR_ICS_URL || '').trim();
  if (!icsUrl) {
    return res.json({
      configured: false,
      message: 'GOOGLE_CALENDAR_ICS_URL not set in Vercel env. Paste your Google Calendar secret iCal URL there to enable.',
      events: [],
      total: 0,
      timestamp: new Date().toISOString()
    });
  }

  const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 7));
  const now = new Date();
  const startMs = now.getTime();
  const endMs = startMs + days * 86400000;

  let text;
  try {
    const r = await fetch(icsUrl, { headers: { 'User-Agent': 'Ryujin-OS/1.0 (+calendar feed reader)' } });
    if (!r.ok) {
      return res.status(502).json({ error: 'ics_fetch_failed', status: r.status, configured: true });
    }
    text = await r.text();
  } catch (err) {
    return res.status(502).json({ error: 'ics_fetch_failed', detail: err.message, configured: true });
  }

  const all = parseIcs(text);
  // Filter to window. Use startTime, or treat events with only DTSTART (no
  // DTEND, e.g. some all-day) as 24h long.
  const inWindow = all.filter(ev => {
    if (!ev.startTime) return false;
    const startT = new Date(ev.startTime).getTime();
    if (!Number.isFinite(startT)) return false;
    return startT >= startMs - 86400000 && startT <= endMs;
  });

  // Drop cancelled. Sort ascending.
  const events = inWindow
    .filter(ev => ev.status !== 'CANCELLED')
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)))
    .map(ev => ({
      uid: ev.uid || null,
      summary: ev.summary || '(untitled)',
      location: ev.location || null,
      description: ev.description || null,
      startTime: ev.startTime,
      endTime: ev.endTime || null,
      allDay: !!ev.allDay,
      organizer: ev.organizer || null
    }));

  return res.json({
    configured: true,
    window: { startMs, endMs, days },
    events,
    total: events.length,
    timestamp: new Date().toISOString()
  });
}

export default handler;
