// Upload Mark Lewis EagleView PDF to Vercel Blob + save URL to custom_prices.
// (Code changes to render the dropdown go in api/proposal.js + proposal-client.html.)
import { readFileSync } from 'node:fs';
import { put } from '@vercel/blob';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const eq=line.indexOf('='); if (eq<0||line.startsWith('#'))continue;
  let v=line.slice(eq+1); if (v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);
  if(!process.env[line.slice(0,eq).trim()])process.env[line.slice(0,eq).trim()]=v.replace(/\\n/g,'').trim();
}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
const ID='f18ba35b-5e7d-4a4b-90f1-7971e648cb94';
const TENANT_SLUG='plus-ultra';
const PDF_PATH='C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/224 NB 530/224 Rt 530- Eagleview.PDF';

const buf = readFileSync(PDF_PATH);
console.log(`PDF: ${(buf.length/1024).toFixed(0)} KB`);

const blob = await put(
  `tenants/${TENANT_SLUG}/estimates/${ID}/eagleview-${Date.now()}.pdf`,
  buf,
  { access: 'public', contentType: 'application/pdf', token: process.env.BLOB_READ_WRITE_TOKEN }
);
console.log(`Blob: ${blob.url}`);

const {data:est}=await sb.from('estimates').select('custom_prices').eq('id',ID).single();
const cp = { ...(est.custom_prices || {}) };
cp._eagleview_pdf_url = blob.url;
cp._eagleview_label = 'EagleView Measurement Report (June 3, 2026)';

const {error}=await sb.from('estimates').update({custom_prices:cp}).eq('id',ID);
if (error) throw new Error(error.message);
console.log('✓ saved to custom_prices._eagleview_pdf_url');
