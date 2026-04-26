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

// Strip the leading emoji + spaces so labels render cleanly in the chat chip
function cleanAction(s) {
  return String(s || '').replace(/^[\p{Extended_Pictographic}\u200d\uFE0F\s]+/u, '').trim();
}

function compose(snapshot) {
  const sec = snapshot?.sections || {};
  const items = [];
  const greetParts = [];

  // Pick the freshest briefing — morning runs at 7AM AT, evening at 5PM AT.
  // Use whichever has a more recent timestamp.
  const morn = sec.briefing_morning;
  const eve = sec.briefing_evening;
  const briefing = (morn?.timestamp && eve?.timestamp)
    ? (new Date(morn.timestamp) > new Date(eve.timestamp) ? morn : eve)
    : (morn || eve);

  const top3 = briefing?.top3;
  if (Array.isArray(top3) && top3.length) {
    for (const t of top3) {
      const label = cleanAction(t.action).slice(0, 90);
      if (!label) continue;
      const promptParts = [t.action];
      if (t.context) promptParts.push('Context: ' + String(t.context).slice(0, 400));
      promptParts.push('What should I do about this right now?');
      items.push({
        label,
        prompt: promptParts.join('\n\n'),
        priority: t.priority === 'top_priority' ? 'high' : 'medium',
      });
    }
  }

  // Greeting line — short, factual, no questions.
  const overdueTickets = sec.tickets?.overdueCount;
  const overdueTasks = sec.salesTasks?.overdue;
  const stale = sec.leads?.total && sec.leads?.thisWeek != null
    ? Math.max(0, sec.leads.total - sec.leads.thisWeek)
    : null;

  if (overdueTickets) greetParts.push(`${overdueTickets} overdue tickets`);
  if (overdueTasks) greetParts.push(`${overdueTasks} overdue task${overdueTasks > 1 ? 's' : ''}`);
  if (sec.pipeline?.length) {
    // Find biggest pipeline deal by .value
    const big = [...sec.pipeline].sort((a, b) => (b.value || 0) - (a.value || 0))[0];
    if (big?.value > 0) greetParts.push(`top deal $${Math.round(big.value / 1000)}K`);
  }

  // If briefing didn't surface anything, hand-roll fallback items so the chat
  // is never empty.
  if (!items.length) {
    if (overdueTasks) {
      items.push({
        label: `Review ${overdueTasks} overdue sales task${overdueTasks > 1 ? 's' : ''}`,
        prompt: 'Show me my overdue sales tasks and recommend the next move on each.',
        priority: 'high',
      });
    }
    if (overdueTickets) {
      items.push({
        label: `${overdueTickets} overdue crew ticket${overdueTickets > 1 ? 's' : ''}`,
        prompt: 'List my overdue Action Board tickets and recommend who to assign them to.',
        priority: 'high',
      });
    }
    if (stale && stale > 5) {
      items.push({
        label: `Triage ${stale} stale leads`,
        prompt: 'Show me the top 5 stale leads I should re-engage today.',
        priority: 'medium',
      });
    }
  }

  // Cap at 4 chips so the chat panel doesn't get cluttered.
  const trimmed = items.slice(0, 4);

  const greeting = greetParts.length ? greetParts.join(' · ') : 'No fires. Standing by.';
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
