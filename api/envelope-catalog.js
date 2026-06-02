// Ryujin OS - Envelope Catalog
// GET  /api/envelope-catalog  - read the tenant's master envelope catalog
// PUT  /api/envelope-catalog  - replace catalog (owner-only)
//
// Catalog shape lives at tenant_settings.envelope_catalog (jsonb), see
// migration_085_envelope_catalog.sql for the schema notes.
//
// Reads are tenant-scoped via requireTenant; writes require a portal session
// (owner role) via requirePortalSessionAndTenant.

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

const MAX_CATALOG_BYTES = 256 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_CATALOG_BYTES) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function getHandler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data, error } = await supabaseAdmin
    .from('tenant_settings')
    .select('envelope_catalog')
    .eq('tenant_id', req.tenant.id)
    .maybeSingle();
  if (error) {
    console.error('[envelope-catalog] GET failed:', error);
    return res.status(500).json({ error: 'Database error' });
  }
  return res.json({ catalog: data?.envelope_catalog || {} });
}

async function putHandler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const catalog = body?.catalog;
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return res.status(400).json({ error: 'catalog object required' });
  }
  if (!catalog.components || typeof catalog.components !== 'object') {
    return res.status(400).json({ error: 'catalog.components object required' });
  }

  const { data, error } = await supabaseAdmin
    .from('tenant_settings')
    .update({ envelope_catalog: catalog })
    .eq('tenant_id', req.tenant.id)
    .select('envelope_catalog')
    .single();
  if (error) {
    console.error('[envelope-catalog] PUT failed:', error);
    return res.status(500).json({ error: 'Database error' });
  }
  return res.json({ catalog: data.envelope_catalog });
}

// Single handler that dispatches by method. GET uses lightweight tenant
// auth (anyone with the slug, same as the existing read-only catalog
// endpoints). PUT requires portal session because the catalog drives
// pricing across the whole tenant.
async function handler(req, res) {
  if (req.method === 'GET' || req.method === 'OPTIONS') return getHandler(req, res);
  if (req.method === 'PUT') return putHandler(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

export default async function wrapped(req, res) {
  if (req.method === 'PUT') {
    return requirePortalSessionAndTenant(handler)(req, res);
  }
  return requireTenant(handler)(req, res);
}

export const config = { api: { bodyParser: false } };
