// ═══════════════════════════════════════════════════════════════
// ONE-TIME SETUP — Create proper custom conversions in Meta
// Run once: GET /api/setup-conversions
// Safe to re-run (checks for existing conversions first)
// ═══════════════════════════════════════════════════════════════

import { listCustomConversions, createCustomConversion } from '../lib/meta.js';
import { requireCronOrOwner } from '../lib/cronAuth.js';

const CONVERSIONS_TO_CREATE = [
  {
    name: 'PU — 10CM PDF Download',
    eventType: 'LEAD',
    rule: JSON.stringify({
      and: [
        { event: { eq: 'Lead' } },
        { or: [
          { URL: { i_contains: '10-costly' } },
          { URL: { i_contains: 'costly-mistakes' } },
          { URL: { i_contains: '10cm' } }
        ]}
      ]
    }),
    defaultValue: 5
  },
  {
    name: 'PU — Inspection Booked',
    eventType: 'SCHEDULE',
    rule: JSON.stringify({
      and: [
        { or: [
          { event: { eq: 'Schedule' } },
          { event: { eq: 'SubmitApplication' } }
        ]},
        { or: [
          { URL: { i_contains: 'inspection' } },
          { URL: { i_contains: 'booking' } },
          { URL: { i_contains: 'appointment' } },
          { URL: { i_contains: 'schedule' } }
        ]}
      ]
    }),
    defaultValue: 50
  },
  {
    name: 'PU — Quote Request',
    eventType: 'SUBMIT_APPLICATION',
    rule: JSON.stringify({
      and: [
        { event: { eq: 'SubmitApplication' } },
        { or: [
          { URL: { i_contains: 'quote' } },
          { URL: { i_contains: 'estimate' } },
          { URL: { i_contains: 'roof-estimate' } }
        ]}
      ]
    }),
    defaultValue: 25
  },
  {
    name: 'PU — Website Form Submit (All)',
    eventType: 'SUBMIT_APPLICATION',
    rule: JSON.stringify({
      and: [
        { event: { eq: 'SubmitApplication' } }
      ]
    }),
    defaultValue: 10
  },
  {
    name: 'PU — CAPI Lead (Server-Side)',
    eventType: 'LEAD',
    rule: JSON.stringify({
      and: [
        { event: { eq: 'Lead' } }
      ]
    }),
    defaultValue: 10
  }
];

export default async function handler(req, res) {
  const auth = requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const startTime = Date.now();
  console.log('[Setup Conversions] Starting...');

  try {
    // Check existing conversions
    const existing = await listCustomConversions();
    const existingNames = existing.map(c => c.name);
    console.log(`[Setup Conversions] Found ${existing.length} existing: ${existingNames.join(', ')}`);

    const results = [];

    for (const conv of CONVERSIONS_TO_CREATE) {
      if (existingNames.includes(conv.name)) {
        results.push({ name: conv.name, status: 'already_exists', skipped: true });
        continue;
      }

      try {
        const created = await createCustomConversion({
          name: conv.name,
          rule: conv.rule,
          eventType: conv.eventType,
          defaultValue: conv.defaultValue
        });
        results.push({ name: conv.name, status: 'created', id: created.id });
        console.log(`[Setup Conversions] Created: ${conv.name} (${created.id})`);
      } catch (e) {
        results.push({ name: conv.name, status: 'error', error: e.message });
        console.error(`[Setup Conversions] Failed: ${conv.name} — ${e.message}`);
      }
    }

    const duration = Date.now() - startTime;
    res.json({
      status: 'ok',
      duration: `${duration}ms`,
      existingConversions: existing.map(c => ({ id: c.id, name: c.name, lastFired: c.last_fired_time })),
      results,
      created: results.filter(r => r.status === 'created').length,
      skipped: results.filter(r => r.skipped).length,
      errors: results.filter(r => r.status === 'error').length
    });

  } catch (e) {
    console.error(`[Setup Conversions] Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
}
