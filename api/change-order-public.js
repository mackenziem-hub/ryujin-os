// Ryujin OS — Public Change Order Read (token-gated)
//
//   GET /api/change-order-public?token=<customer_accept_token | sub_accept_token>
//
// No auth header. The accept token is the authentication. The token itself
// determines which side (customer or sub) is viewing, and we return ONLY that
// side's delta + scope — never the other side's number (a customer must not see
// the sub rate, and vice-versa; mirrors paysheet-public's field policy).

import { supabaseAdmin } from '../lib/supabase.js';

const centsToDollars = (v) => (v == null ? null : Number(v) / 100);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });
  // Token is interpolated into the PostgREST .or() filter below, so constrain it
  // to the base64url charset our generator emits — blocks filter injection.
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return res.status(404).json({ error: 'Change order not found for this link' });
  }

  // Look the token up on whichever side it belongs to.
  const { data, error } = await supabaseAdmin
    .from('change_orders')
    .select('id, reason, scope_before, scope_after, status, created_at, ' +
            'customer_accept_token, customer_accept_status, customer_decided_at, price_delta_customer, ' +
            'sub_accept_token, sub_accept_status, sub_decided_at, rate_delta_sub')
    .or(`customer_accept_token.eq.${token},sub_accept_token.eq.${token}`)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Change order not found for this link' });

  const side = data.customer_accept_token === token ? 'customer' : 'sub';
  const acceptStatus = side === 'customer' ? data.customer_accept_status : data.sub_accept_status;
  const decidedAt = side === 'customer' ? data.customer_decided_at : data.sub_decided_at;
  const delta = side === 'customer'
    ? centsToDollars(data.price_delta_customer)
    : centsToDollars(data.rate_delta_sub);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    id: data.id,
    side,                       // 'customer' | 'sub'  — drives the page copy
    reason: data.reason,
    scope_before: data.scope_before,
    scope_after: data.scope_after,
    delta,                      // dollars; this side's number only
    accept_status: acceptStatus, // not_applicable | pending | accepted | declined | superseded
    decided_at: decidedAt,
    overall_status: data.status,
  });
}
