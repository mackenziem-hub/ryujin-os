// Ryujin OS - Job context resolver
// Centralizes the workorders -> linked_estimate_id -> estimates -> customers walk.
// Used by /api/estimate-photos (?wo_id= branch), the new /api/before-after,
// and any server-side surface that needs the same job context.
//
// workorders has NO customer_id column. Always resolve via linked_estimate_id
// then fall back to customer_name ilike for legacy WOs that pre-date the FK.
import { supabaseAdmin } from './supabase.js';

export async function resolveJobContext({ tenantId, wo, share, id, project_id } = {}) {
  if (!tenantId) return { error: 'tenantId required' };

  let workorder = null;
  let estimate = null;
  let customer = null;
  let paysheet = null;
  let projectId = project_id || null;

  // Path 1: ?wo= (workorder id)
  if (wo) {
    const woRes = await supabaseAdmin
      .from('workorders')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', wo)
      .maybeSingle();
    workorder = woRes.data || null;

    if (workorder?.linked_estimate_id) {
      const eRes = await supabaseAdmin
        .from('estimates')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', workorder.linked_estimate_id)
        .maybeSingle();
      estimate = eRes.data || null;
    }

    if (workorder?.linked_paysheet_id) {
      const pRes = await supabaseAdmin
        .from('paysheets')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', workorder.linked_paysheet_id)
        .maybeSingle();
      paysheet = pRes.data || null;
    }

    // Resolve customer: prefer estimate.customer_id, fall back to ilike on
    // workorders.customer_name for legacy WOs created before the FK existed.
    if (estimate?.customer_id) {
      const cRes = await supabaseAdmin
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', estimate.customer_id)
        .maybeSingle();
      customer = cRes.data || null;
    }
    if (!customer && workorder?.customer_name) {
      const cRes = await supabaseAdmin
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .ilike('full_name', '%' + workorder.customer_name + '%')
        .limit(1)
        .maybeSingle();
      customer = cRes.data || null;
    }
  }

  // Path 2: ?share= (estimate share token)
  if (!estimate && share) {
    const eRes = await supabaseAdmin
      .from('estimates')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('share_token', share)
      .maybeSingle();
    estimate = eRes.data || null;
    if (estimate?.customer_id) {
      const cRes = await supabaseAdmin
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', estimate.customer_id)
        .maybeSingle();
      customer = cRes.data || null;
    }
  }

  // Path 3: ?id= (customer id)
  if (!customer && id) {
    const cRes = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle();
    customer = cRes.data || null;
  }

  // Find the active project for the customer (most-recent non-archived).
  if (!projectId && customer?.id) {
    const prRes = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    projectId = prRes.data?.id || null;
  }

  return { workorder, estimate, customer, paysheet, projectId };
}
