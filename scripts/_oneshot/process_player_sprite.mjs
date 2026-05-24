// Process the medieval-hero player sprite (front/side/back) — flood-fill
// chroma-key the off-white background, tight-bbox crop, resize to 256x384.
// Source images in _candidates/, output to public/assets/rpg/sprites/player/.
// Run: node scripts/_oneshot/process_player_sprite.mjs

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

async function process(srcPath, outPath, targetW, targetH) {
  const buf = await fs.readFile(srcPath);
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const visited = new Uint8Array(width * height);
  const stack = [[2,2],[width-3,2],[2,height-3],[width-3,height-3]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x<0||x>=width||y<0||y>=height) continue;
    const k = y*width+x;
    if (visited[k]) continue;
    visited[k] = 1;
    const i = k*channels;
    const c = [data[i], data[i+1], data[i+2]];
    if (c[0]>=200 && c[1]>=200 && c[2]>=200 && Math.abs(c[0]-c[1])<20 && Math.abs(c[1]-c[2])<20) {
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
  }
  const out = Buffer.alloc(width*height*4);
  let minX=width, minY=height, maxX=0, maxY=0;
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const k=y*width+x, i=k*channels, j=k*4;
    if (visited[k]) { out[j]=0; out[j+1]=0; out[j+2]=0; out[j+3]=0; }
    else { out[j]=data[i]; out[j+1]=data[i+1]; out[j+2]=data[i+2]; out[j+3]=data[i+3]||255;
           if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
  }
  const pad=8;
  const cropX=Math.max(0,minX-pad), cropY=Math.max(0,minY-pad);
  const cropW=Math.min(width-cropX,(maxX-minX)+pad*2), cropH=Math.min(height-cropY,(maxY-minY)+pad*2);
  const baseAlpha = await sharp(out, { raw: { width, height, channels: 4 } })
    .extract({ left: cropX, top: cropY, width: cropW, height: cropH }).png().toBuffer();
  const final = await sharp(baseAlpha).resize({ width: targetW, height: targetH, fit: 'inside', kernel: 'nearest' }).png({ compressionLevel: 9 }).toBuffer();
  await fs.writeFile(outPath, final);
  const m = await sharp(final).metadata();
  console.log(`✓ ${path.basename(outPath)}: ${m.width}x${m.height} (${final.length}b)`);
}

await process('./_candidates/B_medieval.png', 'public/assets/rpg/sprites/player/front.png', 256, 384);
await process('./_candidates/B_side.png',     'public/assets/rpg/sprites/player/side.png',  256, 384);
await process('./_candidates/B_back.png',     'public/assets/rpg/sprites/player/back.png',  256, 384);
console.log('Done.');
