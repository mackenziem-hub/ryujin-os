// Ryujin OS — Action Board proxy (read-only)
// Proxies to ultra-task-manager.replit.app (the canonical crew ticket system)
// using the server-side API key so the browser doesn't need it.
const ACTION_BOARD_URL = 'https://ultra-task-manager.replit.app';
const KEY = (process.env.ACTION_BOARD_KEY || '').trim();

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!KEY) return res.status(500).json({ error: 'ACTION_BOARD_KEY not configured' });

  try {
    const limit = req.query.limit || '50';
    const r = await fetch(`${ACTION_BOARD_URL}/api/tickets?limit=${encodeURIComponent(limit)}`, {
      headers: { 'x-api-key': KEY }
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    const items = Array.isArray(data) ? data : (data.tickets || []);
    return res.json({ tickets: items, total: items.length, source: 'action-board' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
