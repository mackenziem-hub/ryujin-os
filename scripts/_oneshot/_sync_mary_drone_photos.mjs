// Sync Mary's drone shots from Google Drive folder "1833 NB 960" into
// her Ryujin project folder. Direct Drive (OAuth) -> Vercel Blob ->
// project_files insert. Idempotent: skips photos whose filename already
// exists in project_files for the project.
//
// Mary's project: 1833 New Brunswick 960, Botsford Parish
// Project id: e080e448-8f03-4487-b149-34f69cca0da4
// Drive folder id: 1FkB8KVCQI_Usw_TXfv1-YA5QWhme0w-T
//
// Per Mac: client_visible=true so they appear in the inspection gallery
// the moment he toggles the proposal-builder inspection_photos component on.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { put } from '@vercel/blob';
import { driveDownloadBinary, driveSearch } from '../../lib/google.js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
function clean(v) { return String(v || '').replace(/\\n/g, '').replace(/\n/g, '').trim(); }
const sb = createClient(clean(process.env.SUPABASE_URL), clean(process.env.SUPABASE_SERVICE_KEY));

const TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b';
const TENANT_SLUG = 'plus-ultra';
const PROJECT_ID = 'e080e448-8f03-4487-b149-34f69cca0da4';
const DRIVE_FOLDER_ID = '1FkB8KVCQI_Usw_TXfv1-YA5QWhme0w-T';

async function listFolderImages() {
  // driveSearch helper uses fullText/title/etc. Use parentId clause directly via query.
  const params = new URLSearchParams({
    q: `'${DRIVE_FOLDER_ID}' in parents and mimeType contains 'image/'`,
    fields: 'files(id,name,mimeType,size,createdTime,modifiedTime)',
    pageSize: '200',
  });
  const { getAccessToken } = await import('../../lib/google.js');
  const token = await getAccessToken();
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Drive list failed: ${resp.status}`);
  const data = await resp.json();
  return data.files || [];
}

async function main() {
  console.log('Listing Drive folder...');
  const files = await listFolderImages();
  console.log(`Found ${files.length} image(s) in Drive folder`);

  // Pull existing filenames for this project to skip duplicates
  const { data: existing } = await sb.from('project_files')
    .select('filename')
    .eq('tenant_id', TENANT_ID)
    .eq('project_id', PROJECT_ID);
  const existingNames = new Set((existing || []).map(r => r.filename).filter(Boolean));
  console.log(`Project already has ${existingNames.size} file(s) with names`);

  let synced = 0, skipped = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const tag = `[${i+1}/${files.length}] ${f.name}`;
    if (existingNames.has(f.name)) {
      console.log(`${tag}: SKIP (already in project)`);
      skipped++;
      continue;
    }
    try {
      console.log(`${tag}: downloading (${(parseInt(f.size||0)/1024/1024).toFixed(1)}MB)...`);
      const { buffer, mimeType, filename } = await driveDownloadBinary(f.id);
      const ts = Date.now();
      const clean = filename.replace(/[^\w.\-]/g, '_').substring(0, 80);
      const blobPath = `${TENANT_SLUG}/projects/${PROJECT_ID}/${ts}-${i}-${clean}`;
      const blob = await put(blobPath, buffer, {
        access: 'public',
        contentType: mimeType,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      const { error: insErr } = await sb.from('project_files').insert({
        project_id: PROJECT_ID,
        tenant_id: TENANT_ID,
        url: blob.url,
        filename: f.name,
        mime_type: mimeType,
        file_size: buffer.length,
        category: 'inspection',
        client_visible: true,
        captured_at: f.createdTime || null,
      });
      if (insErr) throw new Error('insert failed: ' + insErr.message);
      console.log(`${tag}: OK uploaded ${(buffer.length/1024/1024).toFixed(1)}MB -> ${blob.url.slice(-40)}`);
      synced++;
    } catch (e) {
      console.error(`${tag}: FAILED ${e.message}`);
      failed++;
    }
  }
  console.log(`\nDONE. synced=${synced} skipped=${skipped} failed=${failed}`);
  console.log(`Mary's job folder: https://ryujin-os.vercel.app/job.html?id=${PROJECT_ID}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
