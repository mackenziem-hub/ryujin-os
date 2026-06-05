import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const eq=line.indexOf('='); if (eq<0||line.startsWith('#'))continue;
  let v=line.slice(eq+1); if (v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);
  if(!process.env[line.slice(0,eq).trim()])process.env[line.slice(0,eq).trim()]=v.replace(/\\n/g,'').trim();
}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
const ID='f18ba35b-5e7d-4a4b-90f1-7971e648cb94';
const {data,error}=await sb.from('estimates').select('roof_area_sqft,roof_pitch,ridges_lf,hips_lf,eaves_lf,valleys_lf,calculated_packages,customer:customers(full_name,address,city,province,postal_code)').eq('id',ID).single();
if(error){console.log('ERR:',error);process.exit(1);}
console.log('roof_area_sqft:',data.roof_area_sqft,'| pitch:',data.roof_pitch);
console.log('ridges:',data.ridges_lf,'| hips:',data.hips_lf,'| eaves:',data.eaves_lf,'| valleys:',data.valleys_lf);
console.log('cp gold:',data.calculated_packages?.gold?.total);
console.log('cp plat:',data.calculated_packages?.platinum?.total);
console.log('cp diam:',data.calculated_packages?.diamond?.total);
console.log('customer:',data.customer);
const {data:photos}=await sb.from('estimate_photos').select('caption,is_cover,filename,uploaded_at').eq('estimate_id',ID).order('uploaded_at',{ascending:false});
console.log('photos:',photos.length,'| cover:',photos.find(p=>p.is_cover)?.filename||'NONE');
console.log('top 5:',photos.slice(0,5).map(p=>`${p.filename}(${p.caption}${p.is_cover?'/COVER':''})`).join(', '));
