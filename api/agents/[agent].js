// Z Fighter Individual Agent Endpoint
// GET /api/agents/vegeta — runs Vegeta on demand
// GET /api/agents/piccolo — runs Piccolo on demand
// etc.
//
// Query params:
//   ?format=json|text (default: json)
//   ?action=quote (Vegeta only — runs quote engine)
//   ?spec={JSON} (quote spec for Vegeta)
//
// POST /api/agents/vegeta with body { action: 'quote', spec: {...} }
//   Also supported for quote calculations (easier to pass complex specs)

import { AGENTS, calculateQuote } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const { agent } = req.query;
  const agentName = (agent || '').toLowerCase();
  const agentConfig = AGENTS[agentName];

  if (!agentConfig) {
    return res.status(404).json({
      error: `Unknown agent: ${agentName}`,
      available: Object.keys(AGENTS),
      usage: 'GET /api/agents/{name} — e.g., /api/agents/vegeta'
    });
  }

  // ── VEGETA QUOTE ENGINE ──
  const action = req.query.action || req.body?.action;
  if (agentName === 'vegeta' && action === 'quote') {
    let spec;
    if (req.method === 'POST' && req.body?.spec) {
      spec = req.body.spec;
    } else if (req.query.spec) {
      try { spec = JSON.parse(req.query.spec); } catch (e) {
        return res.status(400).json({ error: 'Invalid spec JSON', example: { squareFeet: 1600, pitch: '6/12' } });
      }
    } else {
      return res.status(400).json({
        error: 'Missing spec for quote calculation',
        usage: 'POST /api/agents/vegeta with { action: "quote", spec: { squareFeet, pitch, ... } }',
        specFields: {
          required: { squareFeet: 'number — 2D roof area in sq ft' },
          optional: {
            pitch: 'string — e.g. "6/12" (default: "5/12")',
            complexity: '"simple" | "medium" | "complex" (default: "medium")',
            newConstruction: 'boolean (default: false)',
            extraLayers: 'number — additional layers to remove',
            chimneys: 'number — brick chimneys needing reflashing',
            valleysLF: 'number — linear feet of valleys',
            wallsLF: 'number — linear feet of wall step flashing',
            eavesLF: 'number — linear feet of eaves',
            rakesLF: 'number — linear feet of rakes',
            ridgesLF: 'number — linear feet of ridges',
            outOfTown: 'boolean (default: false)',
            distanceKM: 'number — distance from Riverview',
            groundThrow: 'boolean — steep + debris to ground',
            stories: 'number — building stories (height fee if 2+)',
            porch: 'string — "LxW" e.g. "10x8"',
            dormers: 'number',
            dormerSize: 'string — "LxW" e.g. "6x4"'
          }
        }
      });
    }

    console.log(`[Vegeta Quote] Calculating quote for ${spec.squareFeet} SF at ${spec.pitch || '5/12'}...`);
    const quote = calculateQuote(spec);

    if (quote.error) {
      return res.status(400).json({ agent: 'vegeta', action: 'quote', error: quote.error });
    }

    return res.json({
      agent: 'vegeta',
      role: 'Sales & Pipeline',
      action: 'quote',
      invocation: 'on-demand',
      timestamp: new Date().toISOString(),
      data: quote,
      errors: []
    });
  }

  // ── STANDARD AGENT RUN ──
  const startTime = Date.now();
  console.log(`[Z Fighter] Running ${agentName} on-demand...`);

  try {
    const report = await agentConfig.fn();
    const duration = Date.now() - startTime;

    console.log(`[Z Fighter] ${agentName} complete in ${duration}ms — ${report.findings?.length || 0} findings`);

    const recommendations = (report.tasks || []).map(t => ({
      agent: agentName,
      title: t.title,
      priority: t.priority,
      description: t.description
    }));

    return res.json({
      agent: agentName,
      role: agentConfig.role,
      schedule: agentConfig.schedule,
      invocation: 'on-demand',
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      data: report,
      recommendations,
      errors: []
    });
  } catch (err) {
    console.error(`[Z Fighter] ${agentName} FAILED:`, err.message);
    return res.status(500).json({
      agent: agentName,
      role: agentConfig.role,
      timestamp: new Date().toISOString(),
      data: null,
      errors: [err.message]
    });
  }
}
