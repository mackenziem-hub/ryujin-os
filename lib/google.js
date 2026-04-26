// ═══════════════════════════════════════════════════════════════
// GOOGLE API HELPER — OAuth2 + Gmail, Calendar, Drive wrappers
// Used by /api/chat.js (tool execution) and /api/approve.js (send-gmail)
// Requires env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
// ═══════════════════════════════════════════════════════════════

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

// Cache access token for 50 minutes (tokens last 60 min)
let cachedToken = null;
let tokenExpiry = 0;

export async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google OAuth not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN in Vercel env vars.');
  }

  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google token refresh failed (${resp.status}): ${err}`);
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 50 * 60 * 1000;
  return cachedToken;
}

async function googleFetch(url, opts = {}) {
  const token = await getAccessToken();
  const resp = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google API ${resp.status}: ${err.substring(0, 500)}`);
  }
  return resp.json();
}

// ═══════════════════════════════════════════
// GMAIL
// ═══════════════════════════════════════════

export async function gmailSearch(query, maxResults = 10) {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const data = await googleFetch(`${GMAIL_API}/messages?${params}`);
  if (!data.messages || data.messages.length === 0) return [];

  // Fetch headers for each message (parallel)
  const messages = await Promise.all(
    data.messages.slice(0, maxResults).map(async (m) => {
      const msg = await googleFetch(
        `${GMAIL_API}/messages/${m.id}?format=metadata` +
        `&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Cc`
      );
      const headers = {};
      (msg.payload?.headers || []).forEach(h => { headers[h.name] = h.value; });
      return {
        id: msg.id,
        threadId: msg.threadId,
        snippet: msg.snippet,
        from: headers.From || '',
        to: headers.To || '',
        cc: headers.Cc || '',
        subject: headers.Subject || '',
        date: headers.Date || '',
        labels: msg.labelIds || []
      };
    })
  );
  return messages;
}

export async function gmailReadMessage(messageId) {
  const msg = await googleFetch(`${GMAIL_API}/messages/${messageId}?format=full`);
  const headers = {};
  (msg.payload?.headers || []).forEach(h => { headers[h.name] = h.value; });

  let body = '';
  function extractText(part) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      // Gmail returns base64url-encoded data
      const raw = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
      body += Buffer.from(raw, 'base64').toString('utf-8');
    }
    if (part.parts) part.parts.forEach(extractText);
  }
  if (msg.payload) extractText(msg.payload);

  // Fallback: strip HTML if no plain text part
  if (!body) {
    function extractHtml(part) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const raw = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
        const html = Buffer.from(raw, 'base64').toString('utf-8');
        body += html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
      }
      if (part.parts) part.parts.forEach(extractHtml);
    }
    if (msg.payload) extractHtml(msg.payload);
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: headers.From || '',
    to: headers.To || '',
    cc: headers.Cc || '',
    subject: headers.Subject || '',
    date: headers.Date || '',
    messageId: headers['Message-ID'] || '',
    body: body.substring(0, 5000),
    labels: msg.labelIds || []
  };
}

export async function gmailReadThread(threadId) {
  const thread = await googleFetch(
    `${GMAIL_API}/threads/${threadId}?format=metadata` +
    `&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
  );
  const messages = (thread.messages || []).map(msg => {
    const headers = {};
    (msg.payload?.headers || []).forEach(h => { headers[h.name] = h.value; });
    return {
      id: msg.id,
      from: headers.From || '',
      to: headers.To || '',
      subject: headers.Subject || '',
      date: headers.Date || '',
      snippet: msg.snippet
    };
  });
  return { threadId, messageCount: messages.length, messages };
}

function buildMimeMessage(to, subject, body, options = {}) {
  const { cc, bcc, inReplyTo, references } = options;
  const lines = [];
  lines.push(`To: ${to}`);
  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);
  lines.push(`Subject: ${subject}`);
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${references || inReplyTo}`);
  }
  lines.push('Content-Type: text/plain; charset=utf-8');
  lines.push('');
  lines.push(body);
  // Base64url encode: replace + with -, / with _, remove padding =
  const b64 = Buffer.from(lines.join('\r\n')).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function gmailDraft(to, subject, body, options = {}) {
  const raw = buildMimeMessage(to, subject, body, options);
  const payload = { message: { raw } };
  if (options.threadId) payload.message.threadId = options.threadId;
  return googleFetch(`${GMAIL_API}/drafts`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function gmailSend(to, subject, body, options = {}) {
  const raw = buildMimeMessage(to, subject, body, options);
  const payload = { raw };
  if (options.threadId) payload.threadId = options.threadId;
  return googleFetch(`${GMAIL_API}/messages/send`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// ═══════════════════════════════════════════
// GOOGLE CALENDAR
// ═══════════════════════════════════════════

function ensureTimezone(time) {
  if (!time) return time;
  // Already has timezone offset or Z — return as-is
  if (/[Zz]$/.test(time) || /[+-]\d{2}:\d{2}$/.test(time)) return time;
  // Default to ADT (UTC-3) for Atlantic Canada
  return time + '-03:00';
}

export async function calendarList(timeMin, timeMax, query = '') {
  const params = new URLSearchParams({
    timeMin: ensureTimezone(timeMin),
    timeMax: ensureTimezone(timeMax),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '25',
    timeZone: 'America/Moncton'
  });
  if (query) params.set('q', query);
  return googleFetch(`${CALENDAR_API}/calendars/primary/events?${params}`);
}

export async function calendarCreate(summary, startTime, endTime, options = {}) {
  const event = {
    summary,
    start: { dateTime: ensureTimezone(startTime), timeZone: 'America/Moncton' },
    end: { dateTime: ensureTimezone(endTime), timeZone: 'America/Moncton' }
  };
  if (options.description) event.description = options.description;
  if (options.location) event.location = options.location;
  if (options.attendees) event.attendees = options.attendees.map(e => ({ email: e }));

  return googleFetch(`${CALENDAR_API}/calendars/primary/events`, {
    method: 'POST',
    body: JSON.stringify(event)
  });
}

export async function calendarUpdate(eventId, updates) {
  // Get existing event first
  const existing = await googleFetch(`${CALENDAR_API}/calendars/primary/events/${eventId}`);

  // Merge updates
  const event = { ...existing };
  if (updates.summary) event.summary = updates.summary;
  if (updates.description) event.description = updates.description;
  if (updates.location) event.location = updates.location;
  if (updates.startTime) event.start = { dateTime: ensureTimezone(updates.startTime), timeZone: 'America/Moncton' };
  if (updates.endTime) event.end = { dateTime: ensureTimezone(updates.endTime), timeZone: 'America/Moncton' };

  return googleFetch(`${CALENDAR_API}/calendars/primary/events/${eventId}`, {
    method: 'PUT',
    body: JSON.stringify(event)
  });
}

// ═══════════════════════════════════════════
// GOOGLE DRIVE
// ═══════════════════════════════════════════

export async function driveSearch(query, maxResults = 10) {
  let q = 'trashed = false';
  if (query) {
    const escaped = query.replace(/'/g, "\\'");
    q = `(name contains '${escaped}' or fullText contains '${escaped}') and trashed = false`;
  }
  const params = new URLSearchParams({
    q,
    pageSize: String(maxResults),
    fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
    orderBy: 'modifiedTime desc'
  });
  return googleFetch(`${DRIVE_API}/files?${params}`);
}

export async function driveReadFile(fileId) {
  const meta = await googleFetch(`${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,size,webViewLink`);

  // Google Docs — export as plain text
  if (meta.mimeType === 'application/vnd.google-apps.document') {
    const token = await getAccessToken();
    const resp = await fetch(`${DRIVE_API}/files/${fileId}/export?mimeType=text/plain`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) throw new Error(`Drive export failed: ${resp.status}`);
    const text = await resp.text();
    return { ...meta, content: text.substring(0, 8000) };
  }

  // Google Sheets — export as CSV
  if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
    const token = await getAccessToken();
    const resp = await fetch(`${DRIVE_API}/files/${fileId}/export?mimeType=text/csv`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) throw new Error(`Drive export failed: ${resp.status}`);
    const text = await resp.text();
    return { ...meta, content: text.substring(0, 8000) };
  }

  // Other files — metadata only
  return { ...meta, note: 'Binary file — metadata only. Use webViewLink to open.' };
}
