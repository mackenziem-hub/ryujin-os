#!/usr/bin/env node
// Swap the regenerated SALES bg in (blonde character removed) and back up
// the original so we can revert without re-downloading.
import sharp from 'sharp';
import { promises as fs } from 'fs';

const SRC = 'C:/Users/Owner/Downloads/sales_no_twin.png';
const DST = 'C:/Users/Owner/Code/ryujin-os/public/assets/rpg/scenes/sectors/sales.webp';
const BACKUP = 'C:/Users/Owner/Code/ryujin-os/public/assets/rpg/scenes/sectors/_backup_v1_sales.webp';

await fs.copyFile(DST, BACKUP).catch(e => { if (e.code !== 'ENOENT') throw e; });
await sharp(SRC).webp({ quality: 88 }).toFile(DST);
console.log(`swapped ${DST} (original at ${BACKUP})`);
