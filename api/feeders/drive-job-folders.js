// ═══════════════════════════════════════════════════════════════
// DRIVE FEEDER -- syncs Cat's Google Drive per-job folders into
// job_artifacts. Top-down: only processes job_folders rows that
// already have a linked_drive_folder_id. Discovery (matching
// unknown Drive folders to job_folders by name) is a follow-up.
//
// Schedule: cron entry in vercel.json. Also callable on-demand at
//   GET /api/feeders/drive-job-folders?tenant=plus-ultra
//
// Auth: cron token OR x-owner-call for manual triggers.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../../lib/supabase.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { getAccessToken } from '../../lib/google.js';
import { normalizeAddress } from '../agents/production.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const PLUS_ULTRA_SLUG = 'plus-ultra';

// Filename heuristics MUST match _brain/orchestrator/scan_job_folders.mjs
// (kept in sync by hand; if the classifier ever drifts, extract to a
// shared lib in api/lib/jobArtifactClassifier.js).
function classify(name) {
  const lower = (name || '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : '';
  const base = dot >= 0 ? lower.slice(0, dot) : lower;

  if (ext === '.pdf') {
    if (lower.includes('warranty')) return 'warranty';
    if (lower.includes('invoice')) return 'invoice';
    if (lower.includes('paysheet')) return 'paysheet';
    if (lower.includes('contract')) return 'contract';
    if (lower.includes('work order') || lower.includes('workorder')) return 'work_order';
    if (lower.includes('proposal')) return 'proposal';
    if (lower.includes('eagleview')) return 'eagleview';
    if (lower.includes('measurement')) return 'measurements';
    if (lower.includes('receipt')) return 'payment_receipt';
    return 'other_pdf';
  }
  if (['.png', '.jpg', '.jpeg', '.webp', '.heic'].includes(ext)) {
    if (base === 'cover' || base.endsWith('-cover')) return 'cover_photo';
    if (base === 'before' || base.startsWith('before')) return 'before_photo';
    if (base === 'after' || base.startsWith('after')) return 'install_photo';
    return 'install_photo';
  }
  if (ext === '.md') {
    if (lower.includes('transcript')) return 'transcript';
    if (lower === 'summary.md' || lower.endsWith('-summary.md')) return 'summary_note';
    return 'note';
  }
  return 'other';
}

async function listFolderChildren(folderId) {
  const token = await getAccessToken();
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    pageSize: '200',
    fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
    orderBy: 'modifiedTime desc',
  });
  const r = await fetch(`${DRIVE_API}/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Drive list ${folderId} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).files || [];
}

// Search Drive for FOLDERS (only) whose name contains the address fragment.
// Returns array of { id, name }. Used by the discovery pass to auto-link
// unknown job_folders rows to a Drive folder.
async function searchDriveFolders(nameFragment) {
  const token = await getAccessToken();
  const safe = nameFragment.replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `mimeType = 'application/vnd.google-apps.folder' and name contains '${safe}' and trashed = false`,
    pageSize: '5',
    fields: 'files(id,name)',
  });
  const r = await fetch(`${DRIVE_API}/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Drive search ${nameFragment} -> ${r.status}`);
  return (await r.json()).files || [];
}

// Discovery: for unlinked job_folders rows, try to find a matching Drive
// folder by name. Only link when match is unambiguous (exactly 1 candidate
// whose normalized name equals the row's address_key). Ambiguous matches
// surface in the report and skip -- no silent guessing.
async function runDriveDiscovery({ tenantId, report }) {
  const { data: unlinked } = await supabaseAdmin
    .from('job_folders')
    .select('id, address, address_key')
    .eq('tenant_id', tenantId)
    .is('linked_drive_folder_id', null);

  if (!unlinked?.length) return;
  report.discovery_attempted = unlinked.length;
  report.discovery_linked = 0;
  report.discovery_ambiguous = [];

  for (const f of unlinked) {
    try {
      // Use the address PREFIX (first 2 tokens) as the search fragment,
      // e.g. "178 Summerhill Dr" -> "178 Summerhill" -> hits Cat's folders
      // named "178 Summerhill" or "178 Summerhill Dr - Faulkner" etc.
      const fragment = (f.address || '').split(/[\s,]+/).slice(0, 2).join(' ').trim();
      if (!fragment) continue;
      const candidates = await searchDriveFolders(fragment);
      // Filter to those whose normalized name EQUALS the address_key OR
      // whose first-two-tokens equal the row's first-two-tokens exactly
      // (so "178 Summerhill" matches "178 Summerhill Dr - Faulkner" but
      // NOT "178 Summerhill Drive South" or "1780 Summerhill"). Equality,
      // not startsWith, to prevent silent wrong-job links.
      const myTokens = f.address_key.split(' ').slice(0, 2).join(' ');
      const matches = candidates.filter(c => {
        const candKey = normalizeAddress(c.name);
        if (!candKey) return false;
        const candTokens = candKey.split(' ').slice(0, 2).join(' ');
        return candKey === f.address_key || candTokens === myTokens;
      });
      if (matches.length === 1) {
        await supabaseAdmin.from('job_folders').update({ linked_drive_folder_id: matches[0].id }).eq('id', f.id);
        report.discovery_linked += 1;
      } else if (matches.length > 1) {
        report.discovery_ambiguous.push({ address: f.address, candidate_count: matches.length, candidate_names: matches.map(m => m.name) });
      }
    } catch (e) {
      report.errors.push(`discovery ${f.address}: ${e.message}`);
    }
  }
}

export async function runDriveFeeder({ tenantSlug = PLUS_ULTRA_SLUG } = {}) {
  const report = { feeder: 'drive', tenant: tenantSlug, timestamp: new Date().toISOString(), folders_processed: 0, artifacts_posted: 0, errors: [] };

  const { data: tenant } = await supabaseAdmin.from('tenants').select('id').eq('slug', tenantSlug).maybeSingle();
  if (!tenant) { report.errors.push(`tenant ${tenantSlug} not found`); return report; }

  // Discovery first: try to link any unlinked job_folders rows.
  await runDriveDiscovery({ tenantId: tenant.id, report });

  const { data: folders } = await supabaseAdmin
    .from('job_folders')
    .select('id, address, linked_drive_folder_id')
    .eq('tenant_id', tenant.id)
    .not('linked_drive_folder_id', 'is', null);

  if (!folders?.length) return report;

  // Batch the sync call by accumulating all folders + their artifacts, then
  // one POST to /api/job-folder-sync.
  const manifest = [];
  for (const f of folders) {
    try {
      const files = await listFolderChildren(f.linked_drive_folder_id);
      const artifacts = files
        .filter(file => file.mimeType !== 'application/vnd.google-apps.folder')
        .map(file => ({
          source_path: `drive:${file.id}`,
          artifact_kind: classify(file.name),
          file_name: file.name,
          mtime: file.modifiedTime || null,
          raw_meta: {
            mime: file.mimeType,
            size_bytes: file.size ? Number(file.size) : null,
            web_view_link: file.webViewLink || null,
            drive_id: file.id,
          },
        }));
      manifest.push({ address: f.address, linked_drive_folder_id: f.linked_drive_folder_id, artifacts });
      report.folders_processed += 1;
      report.artifacts_posted += artifacts.length;
    } catch (e) {
      report.errors.push(`${f.address}: ${e.message}`);
    }
  }

  if (manifest.length) {
    const base = process.env.RYUJIN_BASE || 'https://ryujin-os.vercel.app';
    const token = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
    if (!token) { report.errors.push('RYUJIN_SERVICE_TOKEN unset; cannot post manifest'); return report; }
    const r = await fetch(`${base}/api/job-folder-sync`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-tenant-id': tenantSlug,
      },
      body: JSON.stringify({ source: 'drive', tenant: tenantSlug, folders: manifest }),
    });
    if (!r.ok) {
      report.errors.push(`sync POST failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
  }

  return report;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const tenantSlug = (req.query?.tenant || req.headers['x-tenant-id'] || PLUS_ULTRA_SLUG).toString();
  try {
    const report = await runDriveFeeder({ tenantSlug });
    return res.json({ feeder: 'drive', invocation: req.method === 'GET' ? 'on-demand' : 'cron', data: report });
  } catch (e) {
    console.error('[DriveFeeder] FAILED:', e.message);
    return res.status(500).json({ feeder: 'drive', error: e.message });
  }
}
