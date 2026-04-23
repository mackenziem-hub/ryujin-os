// Ryujin OS — Pay Sheet PDF download
// GET /api/paysheets-pdf?id=<uuid>        — by UUID
// GET /api/paysheets-pdf?job_id=PU-...    — by job_id
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { renderPaysheetPDF } from '../lib/pdfRenderer.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const { id, job_id } = req.query;

  if (!id && !job_id) return res.status(400).json({ error: 'Missing ?id= or ?job_id=' });

  let query = supabaseAdmin.from('paysheets').select('*').eq('tenant_id', tenantId);
  if (id) query = query.eq('id', id);
  else query = query.eq('job_id', job_id);

  const { data, error } = await query.single();
  if (error || !data) return res.status(404).json({ error: 'Pay sheet not found' });

  try {
    const pdf = renderPaysheetPDF(data);
    const filename = `PaySheet_${data.job_id || 'sheet'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).send(pdf);
  } catch (err) {
    console.error('[paysheets-pdf] render failed', err?.message);
    return res.status(500).json({ error: 'PDF render failed', detail: err?.message || String(err) });
  }
}

export default requireTenant(handler);
