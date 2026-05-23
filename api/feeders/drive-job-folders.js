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

export async function runDriveFeeder({ tenantSlug = PLUS_ULTRA_SLUG } = {}) {
  const report = { feeder: 'drive', tenant: tenantSlug, timestamp: new Date().toISOString(), folders_processed: 0, artifacts_posted: 0, errors: [] };

  const { data: tenant } = await supabaseAdmin.from('tenants').select('id').eq('slug', tenantSlug).maybeSingle();
  if (!tenant) { report.errors.push(`tenant ${tenantSlug} not found`); return report; }

  const { data: folders } = await supabaseAdmin
    .from('job_folders')
    .select('id, address, linked_drive_folder_id')
    .eq('tenant_id', tenant.id)
    .not('linked_drive_folder_id', 'is', null);

  if (!folders?.length) { report.errors.push('no job_folders have linked_drive_folder_id; discovery pass not yet built'); return report; }

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
  const auth = requireCronOrOwner(req);
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
