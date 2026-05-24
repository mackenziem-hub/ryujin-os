// ═══════════════════════════════════════════════════════════════
// /api/job-folder-sync -- accepts a manifest of OneDrive job folders
// from the laptop sync agent, upserts job_folders + job_artifacts.
// The Production Pipeline Agent then reads from these tables.
//
// Auth: service token (RYUJIN_SERVICE_TOKEN) for cron/agents OR
//       portal session for manual triggers from admin UI.
//
// Request body:
//   {
//     "source": "onedrive" | "drive" | "ghl" | "obsidian" | "ryujin",
//     "tenant": "plus-ultra",                  // tenant slug
//     "folders": [
//       {
//         "address": "178 Summerhill Dr",      // raw display form
//         "customer_name": "Jim Faulkner",     // optional
//         "linked_drive_folder_id": "1abc...", // optional, drive-source only
//         "artifacts": [
//           {
//             "source_path": "C:/.../178 Summerhill Dr/178 Summerhill Dr- Work Order.pdf",
//             "artifact_kind": "work_order",
//             "file_name": "178 Summerhill Dr- Work Order.pdf",
//             "mtime": "2026-04-20T14:32:00Z",
//             "raw_meta": { "size_bytes": 184320 }
//           }
//         ]
//       }
//     ]
//   }
//
// Response: { ok: true, folders_upserted, artifacts_upserted, errors }
//
// Idempotent: artifacts dedupe on (tenant_id, source, source_path); folders
// dedupe on (tenant_id, address_key). Re-running on the same manifest is a
// no-op. The endpoint does NOT delete artifacts -- file removals are handled
// by a separate sweep (TODO when the laptop agent gains delete-detection).
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { normalizeAddress } from './agents/production.js';

const KNOWN_SOURCES = new Set(['onedrive', 'drive', 'ghl', 'obsidian', 'ryujin']);

function authOk(req) {
  // Service-token only. The earlier x-owner-call branch was a header-string
  // bypass with no session resolution -- anyone could forge it. This endpoint
  // is called by feeders + the laptop scanner, both of which carry the bearer
  // token. Admin UI triggers should call the agent endpoints (which use
  // requireCronOrOwner) rather than this sync receiver directly.
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim()
    || (req.headers['x-ryujin-token'] || '').toString().trim();
  const expected = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
  if (expected && token === expected) return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!authOk(req)) return res.status(401).json({ error: 'unauthorized' });

  const body = req.body || {};
  const source = String(body.source || '').trim();
  const tenantSlug = String(body.tenant || req.headers['x-tenant-id'] || '').trim();
  const folders = Array.isArray(body.folders) ? body.folders : null;

  if (!KNOWN_SOURCES.has(source)) return res.status(400).json({ error: `unknown source "${source}"; allowed: ${[...KNOWN_SOURCES].join(', ')}` });
  if (!tenantSlug) return res.status(400).json({ error: 'tenant required (body.tenant or x-tenant-id)' });
  if (!folders) return res.status(400).json({ error: 'folders array required' });

  const { data: tenant, error: tErr } = await supabaseAdmin
    .from('tenants').select('id').eq('slug', tenantSlug).maybeSingle();
  if (tErr || !tenant) return res.status(404).json({ error: `tenant "${tenantSlug}" not found` });
  const tid = tenant.id;

  let foldersUpserted = 0;
  let artifactsUpserted = 0;
  const errors = [];

  for (const f of folders) {
    const address = String(f.address || '').trim();
    if (!address) { errors.push('folder missing address; skipped'); continue; }
    const addressKey = normalizeAddress(address);
    if (!addressKey) { errors.push(`folder "${address}" normalized to empty key; skipped`); continue; }

    // Upsert the folder row. Don't overwrite customer_name/linked_* if already set
    // by another source -- only fill in nulls. Done in two steps: select-then-write.
    let folderRow;
    const { data: existing } = await supabaseAdmin
      .from('job_folders')
      .select('id, customer_name, linked_drive_folder_id, linked_ghl_contact_id')
      .eq('tenant_id', tid).eq('address_key', addressKey).maybeSingle();

    if (existing) {
      const patch = {};
      if (!existing.customer_name && f.customer_name) patch.customer_name = f.customer_name;
      if (!existing.linked_drive_folder_id && f.linked_drive_folder_id) patch.linked_drive_folder_id = f.linked_drive_folder_id;
      if (!existing.linked_ghl_contact_id && f.linked_ghl_contact_id) patch.linked_ghl_contact_id = f.linked_ghl_contact_id;
      if (Object.keys(patch).length) {
        const { error } = await supabaseAdmin.from('job_folders').update(patch).eq('id', existing.id);
        if (error) { errors.push(`update ${address}: ${error.message}`); continue; }
      }
      folderRow = { id: existing.id };
    } else {
      const insert = {
        tenant_id: tid,
        address,
        address_key: addressKey,
        customer_name: f.customer_name || null,
        linked_drive_folder_id: f.linked_drive_folder_id || null,
        linked_ghl_contact_id: f.linked_ghl_contact_id || null,
      };
      const { data, error } = await supabaseAdmin.from('job_folders').insert(insert).select('id').single();
      if (error) { errors.push(`insert ${address}: ${error.message}`); continue; }
      folderRow = data;
      foldersUpserted += 1;
    }

    const inputArtifacts = Array.isArray(f.artifacts) ? f.artifacts : [];
    if (!inputArtifacts.length) continue;

    // Upsert artifacts in bulk for this folder. The unique index on
    // (tenant_id, source, source_path) handles idempotency.
    const rows = inputArtifacts
      .filter(a => a.source_path)
      .map(a => ({
        tenant_id: tid,
        job_folder_id: folderRow.id,
        source,
        source_path: String(a.source_path),
        artifact_kind: a.artifact_kind || 'other',
        file_name: a.file_name || null,
        mtime: a.mtime || null,
        raw_meta: a.raw_meta || {},
      }));

    if (!rows.length) continue;

    const { error: upErr, count } = await supabaseAdmin
      .from('job_artifacts')
      .upsert(rows, { onConflict: 'tenant_id,source,source_path', count: 'exact' });
    if (upErr) { errors.push(`upsert artifacts for ${address}: ${upErr.message}`); continue; }
    artifactsUpserted += count ?? rows.length;
  }

  return res.json({
    ok: true,
    source,
    tenant: tenantSlug,
    folders_upserted: foldersUpserted,
    artifacts_upserted: artifactsUpserted,
    errors,
  });
}
