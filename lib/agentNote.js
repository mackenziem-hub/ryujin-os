// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Agent note helper.
//
// One-call writer for "the agent registered something" entries.
// Lands in activity_log so it shows up on the entity's history view
// (customer profile, estimate detail, ticket list) without needing
// per-table notes columns.
//
// Usage:
//   import { attachNoteToEntity } from './agentNote.js';
//   await attachNoteToEntity({
//     tenantId: req.tenant.id,
//     userId: session?.user_id || null,
//     entityType: 'customer',         // 'customer' | 'estimate' | 'service_ticket' | 'workorder' | 'tenant'
//     entityId: customerId,
//     action: 'agent_note',           // canonical actions: agent_note, agent_routed, agent_intent_unclear
//     details: {
//       source: 'agent_chat',
//       pillar: 'sales',
//       operator_message: '...',      // what the operator said
//       agent_reply: '...',           // what the agent replied
//       intent: 'install_reschedule', // extracted intent if any
//       confidence: 0.85,
//       conversation_id: '...',
//     },
//   });
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from './supabase.js';

export async function attachNoteToEntity({
  tenantId,
  userId = null,
  entityType,
  entityId,
  action = 'agent_note',
  details = {},
}) {
  if (!tenantId || !entityType || !entityId) {
    return { ok: false, error: 'tenantId, entityType, entityId required' };
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('activity_log')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        entity_type: entityType,
        entity_id: entityId,
        action,
        details,
      })
      .select('id, created_at')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data.id, created_at: data.created_at };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
