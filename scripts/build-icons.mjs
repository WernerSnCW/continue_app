/**
 * Rasterises the app icon SVG into the PNG sizes Android and the Play Store
 * need.
 *
 *   node scripts/build-icons.mjs
 *
 * The SVG in apps/mobile/public/app-icon.svg is the source of truth — edit
 * that, then re-run this. Output goes to apps/mobile/public/icons/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'apps/mobile/public/app-icon.svg');
const outDir = resolve(root, 'apps/mobile/public/icons');

// 512 for the Play Store listing, 192/144/96/72/48 for Android launcher
// densities, 180 for the iOS/PWA touch icon.
const SIZES = [512, 192, 180, 144, 96, 72, 48];

mkdirSync(outDir, { recursive: true });
const svg = readFileSync(src);

for (const size of SIZES) {
  const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
  writeFileSync(resolve(outDir, `icon-${size}.png`), png);
  console.log(`✓ icon-${size}.png (${(png.length / 1024).toFixed(1)} kB)`);
}

console.log(`\nWrote ${SIZES.length} icons to apps/mobile/public/icons/`);
