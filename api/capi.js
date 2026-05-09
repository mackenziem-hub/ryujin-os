// ═══════════════════════════════════════════════════════════════
// CONVERSIONS API (CAPI) BRIDGE
// Receives webhook events from GHL and forwards them to Meta's
// Conversions API for server-side tracking + deduplication.
//
// Usage:
//   POST /api/capi — receive GHL webhook, send to Meta CAPI
//   GET  /api/capi — test endpoint + view recent events log
//
// GHL Workflow Setup:
//   In GHL Automator, create a workflow trigger on:
//   - Form Submission → POST to https://ryujin-os.vercel.app/api/capi
//   - Appointment Booked → POST to https://ryujin-os.vercel.app/api/capi
//   - Opportunity Created → POST to https://ryujin-os.vercel.app/api/capi
//
// The webhook body should include:
//   { event: "pdf_download"|"inspection_booked"|"quote_request"|"lead",
//     contact: { email, phone, firstName, lastName, city, state, zip },
//     source: "10cm_v2"|"website"|"referral",
//     url: "https://plusultraroofing.com/thank-you" }
//
// Or GHL's native webhook format (auto-detected).
//
// Requires: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID
// Optional: CAPI_WEBHOOK_SECRET (for verifying GHL webhook signatures)
// ═══════════════════════════════════════════════════════════════

import { sendCAPIEvent } from '../lib/meta.js';

// Map our event names to Meta standard events
const EVENT_MAP = {
  'pdf_download': 'Lead',
  'lead': 'Lead',
  'form_submission': 'Lead',
  'inspection_booked': 'Schedule',
  'appointment_booked': 'Schedule',
  'quote_request': 'SubmitApplication',
  'quote_sent': 'SubmitApplication',
  'proposal_viewed': 'ViewContent',
  'opportunity_created': 'Lead',
  'contact_created': 'Lead',
  'client_signed': 'Purchase',
  'contract_signed': 'Purchase',
  'job_won': 'Purchase'
};

// Keep a small in-memory log of recent events (last 50)
const recentEvents = [];

function logEvent(entry) {
  recentEvents.unshift(entry);
  if (recentEvents.length > 50) recentEvents.pop();
}

// Extract contact data from GHL's native webhook format
function parseGHLWebhook(body) {
  // GHL Automator "Send data webhook" sends different shapes:
  // 1. Structured: { contact: { email, phone, ... } } or { email, phone, ... }
  // 2. Custom mapped: { email: "...", first_name: "...", event_type: "..." }
  // 3. Raw form fields: { "Would you like a quote?": "Yes", "full_name": "John" }
  //    — keys are form question labels, not field names

  const contact = body.contact || body;

  // Try structured fields first, then fall back to scanning all values
  let email = contact.email || body.email || null;
  let phone = contact.phone || body.phone || null;
  let firstName = contact.firstName || contact.first_name || body.first_name || null;
  let lastName = contact.lastName || contact.last_name || body.last_name || null;
  let fullName = contact.fullName || contact.full_name || body.full_name || body.name || null;

  // If no structured fields found, scan all values for email/phone patterns
  if (!email || !phone || !firstName) {
    for (const [key, value] of Object.entries(body)) {
      if (!value || typeof value !== 'string') continue;
      const v = value.trim();
      const k = key.toLowerCase();
      if (!email && v.includes('@') && v.includes('.')) email = v;
      if (!phone && /^\+?[\d\s\-()]{7,}$/.test(v)) phone = v;
      if (!fullName && (k.includes('name') || k.includes('full_name'))) fullName = v;
      if (!firstName && (k.includes('first') && k.includes('name'))) firstName = v;
      if (!lastName && (k.includes('last') && k.includes('name'))) lastName = v;
    }
  }

  // Split full name if we have it but no first/last
  if (fullName && !firstName) {
    const parts = fullName.trim().split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.slice(1).join(' ') || null;
  }

  return {
    email,
    phone,
    firstName,
    lastName,
    city: contact.city || body.city || null,
    state: contact.state || body.state || null,
    zip: contact.postalCode || contact.zip || body.zip || null,
    contactId: contact.id || contact.contactId || body.contactId || body.contact_id || null
  };
}

export default async function handler(req, res) {
  // GET = status + recent events log
  if (req.method === 'GET') {
    return res.json({
      status: 'ok',
      endpoint: 'Shenron CAPI Bridge',
      description: 'POST webhook events from GHL to forward to Meta Conversions API',
      recentEvents: recentEvents.slice(0, 20),
      totalProcessed: recentEvents.length,
      supportedEvents: Object.keys(EVENT_MAP),
      webhookUrl: 'https://ryujin-os.vercel.app/api/capi',
      examplePayload: {
        event: 'pdf_download',
        contact: { email: 'john@example.com', phone: '+15061234567', firstName: 'John', lastName: 'Doe' },
        source: '10cm_v2',
        url: 'https://plusultraroofing.com/thank-you'
      }
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const startTime = Date.now();
  const body = req.body || {};

  try {
    // Determine event type
    let eventType = body.event || body.type || body.workflow_action || null;

    // Auto-detect from GHL webhook shape
    if (!eventType) {
      if (body.appointment || body.calendarId) eventType = 'appointment_booked';
      else if (body.opportunity || body.pipelineId) eventType = 'opportunity_created';
      else if (body.formId || body.form_id) eventType = 'form_submission';
      else if (body.contactId || body.contact_id) eventType = 'contact_created';
      else eventType = 'lead'; // fallback
    }

    const metaEvent = EVENT_MAP[eventType] || 'Lead';
    const contactData = parseGHLWebhook(body);
    const sourceUrl = body.url || body.source_url || body.pageUrl || 'https://plusultraroofing.com';
    const source = body.source || body.utm_campaign || body.campaign || null;

    // Build user data for CAPI (will be hashed by sendCAPIEvent)
    const userData = {};
    if (contactData.email) userData.em = contactData.email;
    if (contactData.phone) userData.ph = contactData.phone;
    if (contactData.firstName) userData.fn = contactData.firstName;
    if (contactData.lastName) userData.ln = contactData.lastName;
    if (contactData.city) userData.ct = contactData.city;
    if (contactData.state) userData.st = contactData.state;
    if (contactData.zip) userData.zp = contactData.zip;
    if (contactData.contactId) userData.external_id = contactData.contactId;

    // IP and user agent from request (for matching — passed through unhashed by meta.js)
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
    const clientUa = req.headers['user-agent'] || null;
    if (clientIp) userData.ip = clientIp;
    if (clientUa) userData.userAgent = clientUa;

    // Custom data for Meta
    const customData = {};
    if (source) customData.content_name = source;
    if (body.value || body.amount || body.monetaryValue) {
      customData.value = parseFloat(body.value || body.amount || body.monetaryValue);
      customData.currency = body.currency || 'CAD';
    }
    customData.content_category = 'roofing';

    // For Purchase events (signed jobs), auto-detect from GHL opportunity shape
    if (metaEvent === 'Purchase' && !customData.value) {
      const oppValue = body.opportunity?.monetaryValue || body.monetaryValue || body.opportunity_value;
      if (oppValue) {
        customData.value = parseFloat(oppValue);
        customData.currency = customData.currency || 'CAD';
      }
    }

    // Generate a deterministic event ID for deduplication
    // If the browser pixel also fires, using the same event_id prevents double-counting
    const eventId = body.event_id || `ghl_${eventType}_${contactData.contactId || contactData.email || Date.now()}`;

    // Send to Meta CAPI
    const result = await sendCAPIEvent({
      eventName: metaEvent,
      eventTime: Math.floor(Date.now() / 1000),
      eventId,
      sourceUrl,
      userData,
      customData
    });

    const entry = {
      timestamp: new Date().toISOString(),
      incomingEvent: eventType,
      metaEvent,
      eventId,
      contact: contactData.email || contactData.phone || contactData.contactId || 'unknown',
      source,
      success: true,
      metaResponse: result,
      duration: `${Date.now() - startTime}ms`
    };
    logEvent(entry);

    console.log(`[CAPI] ${metaEvent} sent — ${contactData.email || contactData.phone || 'unknown'} (${eventType}, ${source || 'no source'})`);

    res.json({
      status: 'ok',
      eventSent: metaEvent,
      eventId,
      originalEvent: eventType,
      contact: contactData.email || contactData.phone || 'unknown',
      metaResponse: result,
      duration: `${Date.now() - startTime}ms`
    });

  } catch (e) {
    const entry = {
      timestamp: new Date().toISOString(),
      error: e.message,
      body: JSON.stringify(body).slice(0, 200),
      duration: `${Date.now() - startTime}ms`
    };
    logEvent(entry);

    console.error(`[CAPI] Error: ${e.message}`);
    res.status(500).json({ error: e.message, duration: `${Date.now() - startTime}ms` });
  }
}
