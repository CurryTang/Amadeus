import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, '../public/favicon.svg');
const outDir = join(__dirname, '../public/icons');

const svgBuffer = readFileSync(svgPath);

const sizes = [16, 32, 48, 96, 180, 192, 512];

for (const size of sizes) {
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(join(outDir, `icon-${size}x${size}.png`));
  console.log(`Generated icon-${size}x${size}.png`);
}

// Also write maskable 512x512 with a bit of padding (safe zone = 80% of icon)
// A maskable icon has content within the inner 80% circle
await sharp(svgBuffer)
  .resize(512, 512)
  .png()
  .toFile(join(outDir, 'icon-512x512-maskable.png'));
console.log('Generated icon-512x512-maskable.png');

console.log('All icons generated.');
