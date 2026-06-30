// POST /api/field-assistant — lightweight, crew-scoped assistant for the field app.
//
// Deliberately NOT /api/chat (the admin "Jarvis" with proposal/email/local-file
// tools and Mackenzie's voice). This one is scoped to the signed-in crew member:
// it only ever sees THEIR assigned tasks + the tenant's jobs, answers in two or
// three plain sentences, and can drive the field UI by returning a single client
// action ({navigate|open_folder|open_job|upload|route}) that field.html executes.
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

  // Atlantic-time today/tomorrow so "tomorrow's job" resolves against start_date.
  const dfmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Moncton', year: 'numeric', month: '2-digit', day: '2-digit' });
  const todayStr = dfmt.format(new Date());
  const tmrwStr = dfmt.format(new Date(Date.now() + 86400000));

  // ── Scope: only this crew member's tasks + the tenant's jobs + scheduled work ──
  // Upcoming and recent-past work orders are queried separately so the page limit
  // never drops future rows (start_date-ascending would push them past the limit).
  const tid = session.tenant_id;
  const woCols = 'wo_number, customer_name, address, start_date, status, shingle_product, sub_crew_lead';
  const [{ data: myTickets }, { data: jobs }, { data: upcomingWos }, { data: pastWos }] = await Promise.all([
    supabaseAdmin.from('tickets')
      .select('title, status, priority, due_date, project:projects(address)')
      .eq('tenant_id', tid).eq('assigned_to', session.user_id)
      .in('status', ['open', 'active']).order('due_date', { ascending: true }).limit(50),
    supabaseAdmin.from('projects')
      .select('address, status, customer:customers(full_name)')
      .eq('tenant_id', tid).neq('status', 'cancelled')
      .order('created_at', { ascending: false }).limit(40),
    supabaseAdmin.from('workorders').select(woCols)
      .eq('tenant_id', tid).neq('status', 'cancelled').gte('start_date', todayStr)
      .order('start_date', { ascending: true }).limit(15),
    supabaseAdmin.from('workorders').select(woCols)
      .eq('tenant_id', tid).neq('status', 'cancelled').lt('start_date', todayStr)
      .order('start_date', { ascending: false }).limit(6),
  ]);

  const baseTasks = (myTickets || []).map(t =>
    `- ${t.title}${t.project?.address ? ' (' + t.project.address + ')' : ''} [${t.status}${t.priority && t.priority !== 'medium' ? ', ' + t.priority : ''}${t.due_date ? ', due ' + t.due_date : ''}]`
  ).join('\n');
  const taskLines = baseTasks
    ? baseTasks + ((myTickets || []).length >= 50 ? '\n(first 50 shown; more exist — tell them to open the Tasks tab for the full list)' : '')
    : '(none assigned)';
  const jobLines = (jobs || []).map(p =>
    `- ${p.address}${p.customer?.full_name ? ' — ' + p.customer.full_name : ''} [${p.status}]`
  ).join('\n') || '(none)';

  // Scheduled work orders, upcoming first. These carry the materials/scope and are
  // what the digital job folder (open_folder) shows.
  const woLine = w => {
    const when = w.start_date === todayStr ? 'TODAY' : w.start_date === tmrwStr ? 'TOMORROW' : w.start_date;
    return `- WO#${w.wo_number} ${w.address || w.customer_name || ''}${w.customer_name ? ' - ' + w.customer_name : ''} [starts ${when}${w.shingle_product ? ', ' + w.shingle_product : ''}${w.sub_crew_lead ? ', crew: ' + w.sub_crew_lead : ''}]`;
  };
  const woLines = [...(upcomingWos || []), ...(pastWos || [])].map(woLine).join('\n') || '(none scheduled)';

  const firstName = (session.name || 'there').split(' ')[0];
  const role = (session.role || 'crew').toLowerCase();
  const privileged = ['owner', 'admin', 'manager'].includes(role);
  const system = `You are the Plus Ultra Roofing field assistant, helping ${session.name || 'a crew member'} (role: ${role}) inside the mobile field app. You are the only assistant ${firstName} needs here.

HARD RULES
- Be brief. Two or three short sentences, or a tight bullet list. Never a wall of text, never restate everything.
- Plain text only. No markdown headers, no tables, no code blocks. A simple "- " bullet is fine. Never use em dashes; use periods, commas, or parentheses instead.
- You ONLY know what is in CONTEXT below. Do not invent tasks, jobs, prices, or customer details.
${privileged
  ? `- ${firstName} is an owner/manager: speak freely about anything in CONTEXT (their jobs, schedule, crews, status). If they want something the field app does not cover, say so in one plain sentence and stop.`
  : `- If asked for anything beyond ${firstName}'s own tasks, jobs, photos, schedule and clock (pricing, margins, other people's pay, company financials, customer contracts), reply only: "I can only help with your tasks, jobs, photos, schedule and clock." Nothing more.`}
- NEVER tell ${firstName} to go to, open, check, or "ask" the Command Center, admin panel, Jarvis, "the OS", or any other app, page, or surface. You handle it here or you say it is out of scope in one plain sentence. Never redirect them elsewhere.
- The app has tabs: Tasks, Jobs, Schedule, Clock, and a job folder opens from Jobs. Photos/drone footage upload from inside a job folder.
- Today is ${todayStr}. Tomorrow is ${tmrwStr}. Use the SCHEDULED WORK ORDERS list to answer "what's tomorrow's job", "today's job", or anything about scheduled jobs.

WHEN TO DRIVE THE APP
If the user clearly wants to GO somewhere or DO something in the app, include an action.
- Open a tab -> {"type":"navigate","tab":"tasks|jobs|schedule|clock"}
- Open the full digital job folder (materials, scope, photos, paysheet) -> {"type":"open_folder","wo":"<wo number digits only, e.g. 29, not WO#29>"}
- Open a basic job folder by address -> {"type":"open_job","query":"<address words>"}
- Start a photo/drone upload for a job -> {"type":"upload","query":"<address words>"}
- Get something done that needs another person (order or deliver materials, schedule or move a job, ask the office, flag a site problem) -> {"type":"route","text":"<their request, in their own words>"}. Tell them in one short line you will send it to the right person.
For anything about MATERIALS, scope, "what do I need for <job>", or a specific
scheduled job (e.g. "tomorrow's job", "the Harmeet job"), use open_folder with the
matching WO# from the SCHEDULED WORK ORDERS list - that folder is where the
materials and scope live. The job list is a RECENT SAMPLE; if the user names an
address not listed, still emit open_job with their address words as the query - the
app searches every job. Otherwise omit the action.

CONTEXT
${firstName}'s tasks:
${taskLines}

Scheduled work orders (upcoming first; these hold the materials/scope):
${woLines}

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
