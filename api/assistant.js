// Ryujin OS — AI Assistant API
// POST /api/assistant — Chat with Ryujin AI
// Context-aware: knows current page, tenant data, recent actions
// Can execute actions: run quotes, look up data, navigate
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

const RYUJIN_PERSONA = `You are Ryujin — the AI brain of Ryujin OS, a contractor business operating system. You are named after the Japanese dragon god of the sea.

PERSONALITY:
- Calm, confident, slightly mysterious. You speak with quiet authority.
- Brief and direct — never ramble. 1-3 sentences max unless explaining something complex.
- Occasional ocean/storm metaphors, but subtle — don't overdo it.
- You address the user as "Commander" occasionally, but not every message.
- You're helpful and proactive — suggest next steps.
- You know the business deeply: roofing, siding, pricing, crew management.

CAPABILITIES:
- You can answer questions about the system, pricing, offers, customers, estimates.
- You can guide users through the quote builder step by step.
- You can explain what different packages include and why pricing is what it is.
- You can suggest the right package for a job based on the description.
- You understand roofing terminology: SQ, pitch, tearoff, ice & water, etc.
- You know the Performance Shell wall assembly: strip → inspect → OSB → Tyvek → EPS → VentiGrid → siding.

CONTEXT: You'll receive the current page, tenant info, and recent data. Use it to give contextual help.

FORMATTING:
- Keep responses short. This is a chat widget, not a document.
- Use bold for emphasis sparingly.
- No markdown headers or bullet lists unless the user asks for a breakdown.
- If you suggest an action, describe it in one line.`;

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const tenantId = req.tenant.id;
  const { message, context = {}, history = [] } = req.body || {};

  if (!message) return res.status(400).json({ error: 'Message required' });

  // Build context summary for the AI
  let contextSummary = '';

  if (context.page) {
    contextSummary += `\nUser is currently on: ${context.page} page.`;
  }

  if (context.quoteResult) {
    const q = context.quoteResult;
    contextSummary += `\nActive quote: ${q.offer?.name || 'Unknown'} package.`;
    contextSummary += ` Selling price: $${q.summary?.sellingPrice?.toLocaleString() || '?'}.`;
    contextSummary += ` Margin: ${q.summary?.netMargin || '?'}.`;
    contextSummary += ` Hard cost: $${q.summary?.hardCost?.toLocaleString() || '?'}.`;
  }

  // Fetch some live context
  try {
    const [offersRes, estRes, custRes] = await Promise.all([
      supabaseAdmin.from('offers').select('name, slug, system, badge').eq('tenant_id', tenantId).eq('active', true),
      supabaseAdmin.from('estimates').select('id, status, total_price, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(5),
      supabaseAdmin.from('customers').select('id').eq('tenant_id', tenantId)
    ]);

    const offers = offersRes.data || [];
    const estimates = estRes.data || [];
    const customerCount = (custRes.data || []).length;

    contextSummary += `\n\nTenant data snapshot:`;
    contextSummary += `\n- ${offers.length} active offers: ${offers.map(o => o.name).join(', ')}`;
    contextSummary += `\n- ${estimates.length} recent estimates (${estimates.filter(e => e.status === 'accepted').length} accepted)`;
    contextSummary += `\n- ${customerCount} customers in database`;

    if (estimates.length > 0) {
      const totalPipeline = estimates.reduce((s, e) => s + (e.total_price || 0), 0);
      contextSummary += `\n- Pipeline value: $${totalPipeline.toLocaleString()}`;
    }
  } catch (e) {
    // Continue without context
  }

  // Build messages array for Claude
  const messages = [];

  // Add history (last 10 exchanges)
  for (const h of history.slice(-10)) {
    messages.push({ role: h.role, content: h.content });
  }

  // Add current message
  messages.push({ role: 'user', content: message });

  // Call Claude API
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!anthropicKey) {
    // Fallback: return a helpful static response
    return res.json({
      response: getStaticResponse(message, context),
      source: 'static',
      action: detectAction(message)
    });
  }

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: RYUJIN_PERSONA + contextSummary,
        messages
      })
    });

    const data = await claudeRes.json();

    if (data.content && data.content[0]) {
      return res.json({
        response: data.content[0].text,
        source: 'ai',
        action: detectAction(message)
      });
    }

    return res.json({
      response: getStaticResponse(message, context),
      source: 'static',
      action: detectAction(message)
    });
  } catch (e) {
    return res.json({
      response: getStaticResponse(message, context),
      source: 'static',
      action: detectAction(message)
    });
  }
}

// Detect if the user wants to trigger an action
function detectAction(message) {
  const m = message.toLowerCase();
  if (m.includes('new quote') || m.includes('create quote') || m.includes('build quote') || m.includes('run a quote'))
    return { type: 'navigate', target: 'quote' };
  if (m.includes('show estimates') || m.includes('recent estimates') || m.includes('my estimates'))
    return { type: 'navigate', target: 'estimates' };
  if (m.includes('show customers') || m.includes('customer list'))
    return { type: 'navigate', target: 'customers' };
  if (m.includes('settings') || m.includes('configure'))
    return { type: 'navigate', target: 'settings' };
  if (m.includes('show offers') || m.includes('packages') || m.includes('what offers'))
    return { type: 'navigate', target: 'offers' };
  if (m.includes('dashboard') || m.includes('home') || m.includes('command center'))
    return { type: 'navigate', target: 'dashboard' };
  return null;
}

// Static responses when Claude API isn't available
function getStaticResponse(message, context) {
  const m = message.toLowerCase();

  if (m.includes('hello') || m.includes('hi') || m.includes('hey'))
    return "Commander. Ryujin OS is online. All systems operational. What do you need?";

  if (m.includes('help') || m.includes('what can you do'))
    return "I can guide you through quotes, explain packages, look up customers, or navigate the system. Just ask — I'm always watching the currents.";

  if (m.includes('quote') || m.includes('price') || m.includes('estimate'))
    return "Ready to build a quote. Head to the Quote Builder — I'll walk you through the guided flow. What system are we working with? Residential, metal, flat, exterior, or combined?";

  if (m.includes('performance shell') || m.includes('shell'))
    return "The Performance Shell is the full wall rebuild: strip existing siding → inspect sheathing → OSB substrate → housewrap → EPS insulation → VentiGrid rain screen → new siding. It's the premium exterior package.";

  if (m.includes('gold') || m.includes('platinum') || m.includes('diamond'))
    return "Gold is CertainTeed Landmark (15-year). Platinum upgrades to Landmark PRO with Grace ice shield and metal valleys (20-year). Diamond is Presidential luxury (25-year). Each tier increases material quality and warranty.";

  if (m.includes('offer') || m.includes('package'))
    return "We have 17 active offers across residential, commercial, flat, metal, and custom shell categories. Check the Offers page for the full breakdown.";

  if (context.page === 'quote')
    return "I see you're in the Quote Builder. Pick a system and fill in the guided questions — I'll calculate everything from there. Need help choosing a package?";

  if (context.page === 'dashboard')
    return "Dashboard is looking good. All systems online. Need me to pull up anything specific?";

  return "I'm here. Ask me anything about the system, pricing, or your next move.";
}

export default requireTenant(handler);
