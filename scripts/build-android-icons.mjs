/**
 * Renders the app icon into the Android launcher mipmaps.
 *
 *   node scripts/build-android-icons.mjs
 *
 * `cap add android` ships Capacitor's default launcher icon, and the PNGs in
 * apps/mobile/public/icons/ are web assets — neither becomes the icon on the
 * phone's home screen. This writes the real thing.
 *
 * Adaptive icons (API 26+) use ic_launcher_foreground on a background colour
 * from values/ic_launcher_background.xml, so the foreground is drawn on a
 * transparent canvas with the safe-zone padding Android requires: the outer
 * 33% can be masked off, so the mark occupies the middle ~60%.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resDir = resolve(root, 'apps/mobile/android/app/src/main/res');

if (!existsSync(resDir)) {
  console.error('No Android project found. Run `npx cap add android` in apps/mobile first.');
  process.exit(1);
}

/** Legacy square/round launcher icon sizes per density. */
const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
/** Adaptive foreground is always 108dp; the visible circle is the middle 72dp. */
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const BG = '#0b0b0e';

const tallyOnly = readFileSync(resolve(root, 'apps/mobile/public/app-icon.svg'), 'utf8')
  // Strip the plate + border so the adaptive foreground is just the mark.
  .replace(/<rect width="512" height="512" rx="114"[^/]*\/>/g, '')
  .replace(/<rect x="1" y="1"[^/]*\/>/g, '');

const fullIcon = readFileSync(resolve(root, 'apps/mobile/public/app-icon.svg'));

for (const [density, size] of Object.entries(LAUNCHER)) {
  const dir = resolve(resDir, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });

  const square = await sharp(fullIcon, { density: 384 }).resize(size, size).png().toBuffer();
  writeFileSync(resolve(dir, 'ic_launcher.png'), square);

  // Round variant: same art, circular mask.
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
  const round = await sharp(fullIcon, { density: 384 })
    .resize(size, size)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  writeFileSync(resolve(dir, 'ic_launcher_round.png'), round);
}

for (const [density, size] of Object.entries(FOREGROUND)) {
  const inner = Math.round(size * 0.6);
  const pad = Math.round((size - inner) / 2);

  const mark = await sharp(Buffer.from(tallyOnly), { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const fg = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: mark, top: pad, left: pad }])
    .png()
    .toBuffer();

  writeFileSync(resolve(resDir, `mipmap-${density}`, 'ic_launcher_foreground.png'), fg);
}

// Adaptive icon background colour, referenced by mipmap-anydpi-v26/*.xml.
mkdirSync(resolve(resDir, 'values'), { recursive: true });
writeFileSync(
  resolve(resDir, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`,
);

console.log('✓ Launcher icons written to android/app/src/main/res/mipmap-*');
