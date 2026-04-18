// Ryujin OS — Document Renderer API
// GET /api/render?type=proposal&id=X  — Render proposal as styled HTML
// GET /api/render?type=contract&id=X  — Render contract as styled HTML
// POST /api/render?type=proposal      — Render from inline proposal JSON
// POST /api/render?type=contract      — Render from inline contract JSON
//
// Returns styled HTML ready for browser display / print / PDF export
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { renderProposalHTML, renderContractHTML, renderSalesPageHTML, renderMaterialPickupHTML } from '../lib/documentRenderer.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type = req.query.type || 'proposal';
  let docData;

  if (req.method === 'POST') {
    docData = req.body;
  } else {
    // TODO: load from saved estimates/proposals by ID
    return res.status(400).json({ error: 'POST with document JSON, or provide ?id= (coming soon)' });
  }

  if (!docData) return res.status(400).json({ error: 'No document data provided' });

  let html;
  if (type === 'proposal') {
    html = renderProposalHTML(docData);
  } else if (type === 'contract') {
    html = renderContractHTML(docData);
  } else if (type === 'sales_page') {
    html = renderSalesPageHTML(docData);
  } else if (type === 'materials') {
    html = renderMaterialPickupHTML(docData);
  } else {
    return res.status(400).json({ error: `Unknown type: ${type}. Use proposal, contract, or sales_page.` });
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
}

export default requireTenant(handler);
