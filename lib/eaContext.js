// EA context — pending GHL conversations + unread important emails.

import { gmailSearch } from './google.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_LOCATION = (process.env.GHL_LOCATION_ID || '').trim();
const GHL_TOKEN = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
const GHL_VERSION = '2021-07-28';

const PROMO_NOISE = [
  'noreply@business.facebook.com',
  '@app.opus.pro',
  'curran.globalestimater',
  'steffen.plumbingestimates',
  'testflight_no_reply'
];

// Returns conversations where last message direction is INBOUND and is older
// than the threshold (4h workday / 18h overnight).
export async function pendingConversations() {
  if (!GHL_LOCATION || !GHL_TOKEN) return { count: 0, items: [], note: 'GHL not configured' };
  const url = `${GHL_BASE}/conversations/search?locationId=${GHL_LOCATION}&limit=50&sort=desc&sortBy=last_message_date`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: GHL_VERSION },
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) return { count: 0, items: [], note: `GHL ${r.status}` };
  const d = await r.json();
  const convs = d.conversations || [];
  const now = Date.now();
  const items = [];
  for (const c of convs) {
    const direction = c.lastMessageDirection || c.lastMessageType?.toLowerCase().includes('inbound') ? 'inbound' : c.lastMessageDirection;
    if (direction !== 'inbound') continue;
    const ts = new Date(c.lastMessageDate || c.dateUpdated || 0).getTime();
    if (!ts) continue;
    const ageHours = (now - ts) / 3600000;
    const atHour = ((new Date().getUTCHours() + 24 - 3) % 24);
    const isWorkday = atHour >= 8 && atHour < 18;
    const threshold = isWorkday ? 4 : 18;
    if (ageHours < threshold) continue;
    items.push({
      contactName: c.contactName || c.fullName || 'Unknown',
      contactId: c.contactId,
      lastMessageType: c.lastMessageType || 'unknown',
      ageHours: Math.round(ageHours),
      lastMessageBody: (c.lastMessageBody || '').slice(0, 100)
    });
  }
  return { count: items.length, items: items.slice(0, 5) };
}

// Returns unread emails that look like real correspondence (not promo, not partner spam).
export async function importantUnreadEmails() {
  const q = 'is:unread -category:promotions -category:social -category:updates -from:noreply@business.facebook.com';
  try {
    const r = await gmailSearch(q, 20);
    const threads = r?.threads || r?.messages || [];
    const filtered = threads.filter(t => {
      const from = (t.sender || t.from || '').toLowerCase();
      return !PROMO_NOISE.some(noise => from.includes(noise));
    });
    return {
      count: filtered.length,
      items: filtered.slice(0, 5).map(t => ({
        from: t.sender || t.from || '',
        subject: t.subject || '',
        snippet: (t.snippet || '').slice(0, 80)
      }))
    };
  } catch (e) {
    return { count: 0, items: [], note: e.message };
  }
}

// Pulls "Open" items from the most recent SESSION_CONTEXT-style block stored
// in snapshot (agents write these on save). Used as a fallback if today's
// vault daily note doesn't exist yet.
export function carryforwardFromSnapshot(snapshot) {
  const open = snapshot?.sections?.session?.openItems || [];
  return open.slice(0, 3);
}
