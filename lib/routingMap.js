// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Canonical intent → recipient routing map.
//
// Single source of truth for "when an operator says X, who needs to
// know?" Used by lib/router.js to resolve concrete user_ids and post
// to /api/messages. Verified with Mac on 2026-05-10 — see
// _brain/SESSION_CONTEXT.md and the plan file in
// ~/.claude/plans/let-s-go-over-current-zesty-lampson.md.
//
// Each entry:
//   intent              canonical slug
//   primary_roles       roles[] to ping (resolved to all users with that role)
//   primary_user_slugs  optional preferred user slugs (e.g. 'aj' for service)
//                       — short-circuits role lookup when set
//   copy_owner          true → also ping the owner role (Mac)
//   urgency_escalation  'mac' | null — when intent is flagged urgent
//   one_liner_template  template for the system-message body. Tokens:
//                       {operator}, {customer}, {ref}, {operator_msg}
// ═══════════════════════════════════════════════════════════════

export const INTENTS = {
  sale_signed:         { primary_roles: ['owner', 'admin'], copy_owner: false, one_liner_template: '🎉 {operator} closed a deal — {customer}. Original message: "{operator_msg}"' },
  quote_requested:     { primary_roles: ['owner'], one_liner_template: '{operator} needs pricing on {customer}. Message: "{operator_msg}"' },
  quote_question:      { primary_roles: ['owner'], one_liner_template: '{operator} has a quote question on {customer}. Message: "{operator_msg}"' },
  lead_followup_help:  { primary_roles: ['owner'], one_liner_template: '{operator} wants follow-up help on {customer}. Message: "{operator_msg}"' },
  customer_complaint:  { primary_roles: ['owner'], copy_owner: false, urgency_escalation: 'mac', one_liner_template: '⚠ {operator} flagged a complaint from {customer}. Message: "{operator_msg}"' },

  // AJ left the company (Jun 26). Production-side requests now go to Pavanjot,
  // scheduling/paysheet to Cat. Cat is copied on the production ones as the
  // confirmation hub (Mac's confirmation-first doctrine).
  install_scheduled:   { primary_user_slugs: ['catherine'], one_liner_template: '{operator} scheduled an install for {customer}. Details: "{operator_msg}"' },
  install_reschedule:  { primary_user_slugs: ['catherine'], one_liner_template: '{customer} is rescheduling. Originator: {operator}. Details: "{operator_msg}"' },
  material_request:    { primary_user_slugs: ['pavanjot', 'catherine'], one_liner_template: '{operator} needs materials. Details: "{operator_msg}"' },
  crew_dispatch_change:{ primary_user_slugs: ['pavanjot', 'catherine'], one_liner_template: '{operator} flagged a crew dispatch change. Details: "{operator_msg}"' },
  paysheet_question:   { primary_user_slugs: ['catherine'], one_liner_template: '{operator} has a paysheet question. Details: "{operator_msg}"' },
  equipment_issue:     { primary_user_slugs: ['pavanjot', 'catherine'], one_liner_template: '{operator} flagged an equipment issue. Details: "{operator_msg}"' },

  repair_request:      { primary_user_slugs: ['diego', 'catherine'], one_liner_template: 'Repair request for {customer}. Originator: {operator}. Details: "{operator_msg}"' },
  color_dropoff:       { primary_user_slugs: ['diego', 'catherine'], one_liner_template: '{customer} is dropping by for samples / pickup. Originator: {operator}. Details: "{operator_msg}"' },
  inspection_request:  { primary_user_slugs: ['diego', 'catherine'], one_liner_template: 'Inspection request for {customer}. Originator: {operator}. Details: "{operator_msg}"' },
  complex_job_consult: { primary_user_slugs: ['diego'], copy_owner: true, one_liner_template: '{operator} wants a consult on {customer}. Details: "{operator_msg}"' },

  warranty_claim:      { primary_user_slugs: ['diego', 'catherine'], one_liner_template: 'Warranty claim flagged for {customer}. Originator: {operator}. Details: "{operator_msg}"' },

  supplier_order:      { primary_user_slugs: ['catherine'], one_liner_template: 'Supplier order needed. Originator: {operator}. Details: "{operator_msg}"' },
  payment_question:    { primary_roles: ['owner', 'admin'], one_liner_template: 'Payment question on {customer}. Originator: {operator}. Details: "{operator_msg}"' },
  late_invoice:        { primary_roles: ['owner', 'admin'], one_liner_template: 'Late invoice for {customer}. Originator: {operator}. Details: "{operator_msg}"' },
  pricing_dispute:     { primary_roles: ['owner'], one_liner_template: 'Pricing dispute flagged on {customer}. Originator: {operator}. Details: "{operator_msg}"' },

  review_request_followup: { primary_roles: ['admin'], one_liner_template: 'Review request follow-up needed for {customer}. Originator: {operator}.' },
  hiring:              { primary_roles: ['owner'], copy_owner: false, one_liner_template: 'Hiring topic from {operator}: "{operator_msg}"' },

  // Fallthroughs
  unknown:             { primary_roles: [], copy_owner: false, one_liner_template: '' },
};

export const INTENT_SLUGS = Object.keys(INTENTS);

// Render the recipient list from an intent + a tenant's user roster.
// Returns { user_ids: [], reasons: { [user_id]: 'role:owner' | 'slug:aj' | 'urgency_escalation' } }
export function resolveRecipients(intent, urgency, usersInTenant) {
  const cfg = INTENTS[intent] || INTENTS.unknown;
  const recipients = new Map();

  // Primary user slugs (short-circuit — preferred specific people).
  for (const slug of cfg.primary_user_slugs || []) {
    const u = usersInTenant.find(x => x.slug === slug || (x.name || '').toLowerCase() === slug);
    if (u && !recipients.has(u.id)) recipients.set(u.id, `slug:${slug}`);
  }

  // Primary roles. Only fall back to role-based if no slug match found
  // OR slug + role both wanted (most rows want both).
  for (const role of cfg.primary_roles || []) {
    const matches = usersInTenant.filter(u => u.role === role);
    for (const u of matches) {
      if (!recipients.has(u.id)) recipients.set(u.id, `role:${role}`);
    }
  }

  // Owner copy.
  if (cfg.copy_owner) {
    const owners = usersInTenant.filter(u => u.role === 'owner');
    for (const u of owners) if (!recipients.has(u.id)) recipients.set(u.id, 'copy_owner');
  }

  // Urgency escalation.
  if (urgency === 'urgent' && cfg.urgency_escalation === 'mac') {
    const owners = usersInTenant.filter(u => u.role === 'owner');
    for (const u of owners) if (!recipients.has(u.id)) recipients.set(u.id, 'urgency_escalation');
  }

  return {
    user_ids: [...recipients.keys()],
    reasons: Object.fromEntries(recipients),
  };
}

export function renderMessageBody(intent, ctx) {
  const cfg = INTENTS[intent] || INTENTS.unknown;
  let tmpl = cfg.one_liner_template || '{operator}: {operator_msg}';
  return tmpl
    .replace(/\{operator\}/g, ctx.operator || 'Someone')
    .replace(/\{customer\}/g, ctx.customer || 'a customer')
    .replace(/\{ref\}/g, ctx.ref || '')
    .replace(/\{operator_msg\}/g, ctx.operator_msg || '');
}
