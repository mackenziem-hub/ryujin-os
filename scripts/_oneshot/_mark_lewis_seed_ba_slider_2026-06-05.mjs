// Mark Lewis #80 — seed before/after slider.
// Before: real Cover Photo (the house Mac shot today).
// After: brand gallery job-complete shot (clearly illustrative, PR #218 pattern).
//   No Higgsfield key set in Vercel, so this is the fallback Mac & Cat
//   already use on customer pages without a real AI render.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const eq=line.indexOf('='); if (eq<0||line.startsWith('#'))continue;
  let v=line.slice(eq+1); if (v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);
  if(!process.env[line.slice(0,eq).trim()])process.env[line.slice(0,eq).trim()]=v.replace(/\\n/g,'').trim();
}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
const ID='f18ba35b-5e7d-4a4b-90f1-7971e648cb94';

// Find the real cover row (Mac uploaded today)
const {data:cover}=await sb.from('estimate_photos')
  .select('id,url,filename,mime_type')
  .eq('estimate_id',ID).eq('is_cover',true).single();
if (!cover) throw new Error('no is_cover row found');
console.log('Cover photo:', cover.filename, cover.url.slice(-40));

// Insert "before" row pointing at the SAME blob as Cover
const {error:befErr}=await sb.from('estimate_photos').insert({
  estimate_id: ID,
  url: cover.url,
  filename: cover.filename,
  mime_type: cover.mime_type,
  caption: 'before',
  category: 'before',
  is_cover: false
});
if (befErr) throw new Error(`before: ${befErr.message}`);
console.log('  ✓ before row created (same blob as cover)');

// Insert "after" row pointing at brand gallery job-complete (illustrative)
const afterUrl = 'https://ryujin-os.vercel.app/brand/plus-ultra/gallery/04-job-complete.jpg';
const {error:aftErr}=await sb.from('estimate_photos').insert({
  estimate_id: ID,
  url: afterUrl,
  filename: '04-job-complete.jpg',
  mime_type: 'image/jpeg',
  caption: 'after',
  category: 'after',
  is_cover: false
});
if (aftErr) throw new Error(`after: ${aftErr.message}`);
console.log('  ✓ after row created (brand gallery placeholder, illustrative)');

console.log('\nCustomer URL: https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-80');
console.log('(hard-refresh)');
