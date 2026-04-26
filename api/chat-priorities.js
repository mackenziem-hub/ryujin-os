// Ryujin OS — Chat Priorities
//
// GET /api/chat-priorities
//   Returns "what should I focus on right now" — surfaced as the first thing
//   the user sees when they tap the Ryujin chat fab. Lightweight proxy over
//   Shenron's snapshot so we don't duplicate the heavy aggregation job.
//
// Response shape:
//   {
//     greeting: "1 overdue · 76 stale leads · top deal $44K",
//     items: [
//       { label: "Review overdue: Metal quote for Chris", prompt: "tell me about the overdue metal roofing quote for Chris" },
//       ...
//     ],
//     timestamp: "2026-04-26T..."
//   }
//
// Public endpoint — no tenant header required (Shenron is single-tenant
// for Plus Ultra; multi-tenant proxy can come later when other tenants land).

const SHENRON_SNAPSHOT_URL = 'https://shenron-app.vercel.app/api/snapshot';
const FETCH_TIMEOUT_MS = 4000;

async function fetchSnapshot() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(SHENRON_SNAPSHOT_URL, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`snapshot ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function compose(snapshot) {
  const items = [];
  const greetParts = [];

  // 1. Overdue sales tasks (Shenron flags these as 🔴 alerts)
  const alerts = snapshot?.sales?.alerts || snapshot?.alerts || [];
  for (const a of alerts) {
    const text = typeof a === 'string' ? a : (a.text || a.message || '');
    if (!text) continue;
    if (/overdue/i.test(text)) {
      items.push({
        label: 'Review overdue: ' + text.replace(/^[^a-z0-9]+/i, '').slice(0, 90),
        prompt: 'Tell me what to do about the overdue sales task: ' + text,
        priority: 'high',
      });
      if (items.length >= 5) break;
    }
  }

  // 2. Top open deal — quote-sent state, biggest dollar amount
  const topDeal = snapshot?.sales?.topDeal || snapshot?.pipeline?.topDeal;
  if (topDeal?.name) {
    const amt = topDeal.value ? '$' + Number(topDeal.value).toLocaleString() : '';
    items.push({
      label: `Nudge top deal: ${topDeal.name} ${amt}`.trim(),
      prompt: `What's the latest on ${topDeal.name}'s ${amt} quote? Help me draft the next nudge.`,
      priority: 'medium',
    });
    if (amt) greetParts.push(`top deal ${amt}`);
  }

  // 3. Stale leads count
  const staleCount = snapshot?.sales?.staleLeadsCount ?? snapshot?.leads?.stale?.length;
  if (staleCount && staleCount > 0) {
    items.push({
      label: `Triage ${staleCount} stale leads`,
      prompt: `Show me the top 5 stale leads I should re-engage today.`,
      priority: 'medium',
    });
    greetParts.push(`${staleCount} stale leads`);
  }

  // 4. Overdue tickets (crew side)
  const overdueTickets = snapshot?.crew?.overdue ?? snapshot?.tickets?.overdue;
  if (overdueTickets && overdueTickets > 0) {
    items.push({
      label: `${overdueTickets} overdue tickets on the Action Board`,
      prompt: `List my overdue field tickets and recommend who to assign them to.`,
      priority: 'high',
    });
    greetParts.unshift(`${overdueTickets} overdue`);
  }

  // 5. Recent inbound leads — possible "new lead came in" prompts
  const newLeads = snapshot?.leads?.newToday ?? snapshot?.communications?.newConversations;
  if (newLeads && newLeads > 0 && items.length < 5) {
    items.push({
      label: `${newLeads} new conversations to review`,
      prompt: `Give me a one-line summary of each new lead from today.`,
      priority: 'medium',
    });
  }

  // Sort: high priority first, cap at 4 items so the chat panel doesn't choke
  items.sort((a, b) => (a.priority === 'high' ? -1 : 1) - (b.priority === 'high' ? -1 : 1));
  const trimmed = items.slice(0, 4);

  const greeting = greetParts.length
    ? greetParts.join(' · ')
    : 'No fires. Standing by.';

  return { greeting, items: trimmed, timestamp: new Date().toISOString() };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Cache for 60s — priorities change minute-to-minute, not second-to-second
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

  try {
    const snapshot = await fetchSnapshot();
    const composed = compose(snapshot);
    return res.json(composed);
  } catch (e) {
    // Always return a valid shape — chat widget shouldn't break on a slow snapshot
    return res.json({
      greeting: 'Snapshot offline — ask me anything.',
      items: [],
      timestamp: new Date().toISOString(),
      error: e.message,
    });
  }
}
