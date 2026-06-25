// POST /api/field-assistant — lightweight, crew-scoped assistant for the field app.
//
// Deliberately NOT /api/chat (the admin "Jarvis" with proposal/email/local-file
// tools and Mackenzie's voice). This one is scoped to the signed-in crew member:
// it only ever sees THEIR assigned tasks + the tenant's jobs, answers in two or
// three plain sentences, and can drive the field UI by returning a single client
// action ({navigate|open_job|upload}) that field.html executes.
import { supabaseAdmin } from '../lib/supabase.js';
import { resolveSession } from '../lib/portalAuth.js';

const MODEL = 'claude-haiku-4-5';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await resolveSession(req);
  if (!session || !session.user_id || session.user_id === 'service-internal') {
    return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  }
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return res.status(500).json({ error: 'Assistant not configured' });

  const message = String((req.body && req.body.message) || '').trim();
  if (!message) return res.status(400).json({ error: 'message required' });
  const history = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-6) : [];

  // ── Scope: only this crew member's tasks + the tenant's jobs ──
  const tid = session.tenant_id;
  const [{ data: myTickets }, { data: jobs }] = await Promise.all([
    supabaseAdmin.from('tickets')
      .select('title, status, priority, due_date, project:projects(address)')
      .eq('tenant_id', tid).eq('assigned_to', session.user_id)
      .in('status', ['open', 'active']).order('due_date', { ascending: true }).limit(20),
    supabaseAdmin.from('projects')
      .select('address, status, customer:customers(full_name)')
      .eq('tenant_id', tid).neq('status', 'cancelled')
      .order('created_at', { ascending: false }).limit(20),
  ]);

  const taskLines = (myTickets || []).map(t =>
    `- ${t.title}${t.project?.address ? ' (' + t.project.address + ')' : ''} [${t.status}${t.priority && t.priority !== 'medium' ? ', ' + t.priority : ''}${t.due_date ? ', due ' + t.due_date : ''}]`
  ).join('\n') || '(none assigned)';
  const jobLines = (jobs || []).map(p =>
    `- ${p.address}${p.customer?.full_name ? ' — ' + p.customer.full_name : ''} [${p.status}]`
  ).join('\n') || '(none)';

  const firstName = (session.name || 'there').split(' ')[0];
  const system = `You are the Plus Ultra Roofing field assistant, helping ${session.name || 'a crew member'} (role: ${session.role || 'crew'}) inside the mobile field app.

HARD RULES
- Be brief. Two or three short sentences, or a tight bullet list. Never a wall of text, never restate everything.
- Plain text only. No markdown headers, no tables, no code blocks. A simple "- " bullet is fine.
- You ONLY know what is in CONTEXT below: ${firstName}'s own assigned tasks and the job list. Do not invent tasks, jobs, prices, or customer details. If asked something outside this, say you can only help with their tasks, jobs, photos, schedule and clock.
- The app has tabs: Tasks, Jobs, Schedule, Clock, and a job folder opens from Jobs. Photos/drone footage upload from inside a job folder.

WHEN TO DRIVE THE APP
If the user clearly wants to GO somewhere or DO something in the app, include an action. Match a job by its address text from the job list.
- Open a tab -> {"type":"navigate","tab":"tasks|jobs|schedule|clock"}
- Open a job folder -> {"type":"open_job","query":"<address words>"}
- Start a photo/drone upload for a job -> {"type":"upload","query":"<address words>"}
Otherwise omit the action.

CONTEXT
${firstName}'s tasks:
${taskLines}

Jobs (newest first):
${jobLines}

RESPONSE FORMAT
Reply with ONLY a JSON object, nothing else:
{"reply": "<your short answer>", "action": <one action object or null>}`;

  const messages = [];
  for (const m of history) {
    if (m && (m.role === 'user' || m.role === 'assistant') && m.content) {
      messages.push({ role: m.role, content: String(m.content).slice(0, 2000) });
    }
  }
  messages.push({ role: 'user', content: message });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, system, messages }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || 'assistant upstream error' });
    const text = (data.content && data.content[0] && data.content[0].text) || '';
    let reply = text.trim(), action = null;
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        if (parsed && typeof parsed.reply === 'string') {
          reply = parsed.reply.trim();
          if (parsed.action && typeof parsed.action === 'object' && parsed.action.type) action = parsed.action;
        }
      } catch { /* fall back to raw text as reply */ }
    }
    return res.json({ reply: reply || 'Not sure on that one.', action });
  } catch (e) {
    return res.status(502).json({ error: 'assistant unreachable' });
  }
}
