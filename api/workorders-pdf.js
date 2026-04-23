// Ryujin OS — Work Order PDF download
// GET /api/workorders-pdf?id=<uuid>   — by UUID
// GET /api/workorders-pdf?wo=<number> — by wo_number
// Optional: ?terms=a,b,c overrides the redaction word list (otherwise defaults from pdfRenderer).
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { renderWorkOrderPDF } from '../lib/pdfRenderer.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const { id, wo, terms } = req.query;

  if (!id && !wo) return res.status(400).json({ error: 'Missing ?id= or ?wo=' });

  let query = supabaseAdmin.from('workorders').select('*').eq('tenant_id', tenantId);
  if (id) query = query.eq('id', id);
  else query = query.eq('wo_number', wo);

  const { data, error } = await query.single();
  if (error || !data) return res.status(404).json({ error: 'Work order not found' });

  try {
    const sensitiveTerms = terms ? String(terms).split(',').map(s => s.trim()).filter(Boolean) : null;
    const pdf = renderWorkOrderPDF(data, { sensitiveTerms });
    const custSlug = (data.customer_name || 'job').split(' ')[0].replace(/[^\w\-]+/g, '_');
    const filename = `WorkOrder_WO-${data.wo_number || 'new'}_${custSlug}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).send(pdf);
  } catch (err) {
    console.error('[workorders-pdf] render failed', err?.message);
    return res.status(500).json({ error: 'PDF render failed', detail: err?.message || String(err) });
  }
}

export default requireTenant(handler);
