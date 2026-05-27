#!/usr/bin/env node
import sharp from 'sharp';
import { promises as fs } from 'fs';
const SRC = 'C:/Users/Owner/Downloads/title_screen_v2.png';
const DST = 'C:/Users/Owner/Code/ryujin-os/public/assets/rpg/ui/title-screen.webp';
const BACKUP = 'C:/Users/Owner/Code/ryujin-os/public/assets/rpg/ui/_backup_v1_title-screen.webp';
await fs.copyFile(DST, BACKUP).catch(e => { if (e.code !== 'ENOENT') throw e; });
await sharp(SRC).webp({ quality: 88 }).toFile(DST);
console.log(`swapped ${DST}`);
