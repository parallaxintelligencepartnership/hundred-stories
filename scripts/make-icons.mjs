// Pure Node PNG writer: no npm packages, just zlib + Buffer.
// Draws a background square with a stepped skyscraper silhouette
// (three stacked rectangles narrowing upward, centered, ~60% of height)
// and writes public/icons/icon-192.png and public/icons/icon-512.png.

import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');

const BG = [0x0b, 0x10, 0x20]; // #0b1020
const FG = [0xf4, 0xb9, 0x42]; // #f4b942

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32Buffer(buf) {
  return crc32(buf) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32Buffer(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makeSkylinePixels(size) {
  // RGBA buffer, background everywhere, then draw the silhouette.
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4 + 0] = BG[0];
    pixels[i * 4 + 1] = BG[1];
    pixels[i * 4 + 2] = BG[2];
    pixels[i * 4 + 3] = 0xff;
  }

  const setPixel = (x, y, color) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    pixels[idx + 0] = color[0];
    pixels[idx + 1] = color[1];
    pixels[idx + 2] = color[2];
    pixels[idx + 3] = 0xff;
  };

  const fillRect = (x0, y0, x1, y1, color) => {
    for (let y = Math.max(0, y0); y < Math.min(size, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) {
        setPixel(x, y, color);
      }
    }
  };

  // Overall silhouette height: ~60% of the icon height.
  const totalHeight = Math.round(size * 0.6);
  const baseY = Math.round(size * 0.85); // bottom of the building
  const topY = baseY - totalHeight;
  const centerX = Math.round(size / 2);

  // Three stacked tiers narrowing upward, each 1/3 of totalHeight.
  const tierHeight = Math.round(totalHeight / 3);
  const tierWidths = [
    Math.round(size * 0.5), // bottom, widest
    Math.round(size * 0.34), // middle
    Math.round(size * 0.2), // top, narrowest
  ];

  let currentBottom = baseY;
  for (let tier = 0; tier < 3; tier++) {
    const width = tierWidths[tier];
    const top = tier === 2 ? topY : currentBottom - tierHeight;
    const left = centerX - Math.round(width / 2);
    const right = left + width;
    fillRect(left, top, right, currentBottom, FG);
    currentBottom = top;
  }

  return pixels;
}

function encodePNG(size) {
  const pixels = makeSkylinePixels(size);

  // Raw scanlines: filter byte 0 (None) + RGBA bytes per row.
  const bytesPerPixel = 4;
  const stride = size * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: None
    const pixelRowStart = y * stride;
    for (let i = 0; i < stride; i++) {
      raw[rowStart + 1 + i] = pixels[pixelRowStart + i];
    }
  }

  const idatData = deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: RGBA
  ihdr.writeUInt8(0, 10); // compression method
  ihdr.writeUInt8(0, 11); // filter method
  ihdr.writeUInt8(0, 12); // interlace method

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const png = encodePNG(size);
  const outPath = join(outDir, `icon-${size}.png`);
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes)`);
}
