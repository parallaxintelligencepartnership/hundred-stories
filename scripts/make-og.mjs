// Pure Node PNG writer for the link preview card, same approach as make-icons.mjs:
// no npm packages, just zlib + Buffer. Draws public/og.png at 1200x630 with the
// wordmark, the tagline, and a procedural tower of stacked cream cells on the right.
//
// Node has no text rasterizer and this script may not add a dependency, so the
// two lines are drawn from a small 5x7 cell font defined below rather than from
// the page font stack. The letterforms are blocky on purpose: they match the
// tower cells beside them.

import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public');
const outPath = join(outDir, 'og.png');

const WIDTH = 1200;
const HEIGHT = 630;

const BG = [0x0b, 0x10, 0x20]; // #0b1020, the page background
const CREAM = [0xe8, 0xec, 0xf2]; // --ink
const DIM = [0x98, 0xa3, 0xb3]; // --ink-dim
const AMBER = [0xf4, 0xb9, 0x42]; // --amber
const SLAB = [0x28, 0x31, 0x3f]; // --steel-2

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// 5x7 cell font, baseline on the last row. Only the glyphs these two lines need.
const GLYPHS = {
  H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  B: ['#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  a: ['     ', '     ', ' ### ', '    #', ' ####', '#   #', ' ####'],
  d: ['    #', '    #', ' ####', '#   #', '#   #', '#   #', ' ####'],
  e: ['     ', '     ', ' ### ', '#   #', '#####', '#    ', ' ### '],
  i: ['  #  ', '     ', ' ##  ', '  #  ', '  #  ', '  #  ', ' ### '],
  l: [' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  n: ['     ', '     ', '# ## ', '##  #', '#   #', '#   #', '#   #'],
  o: ['     ', '     ', ' ### ', '#   #', '#   #', '#   #', ' ### '],
  r: ['     ', '     ', '# ## ', '##  #', '#    ', '#    ', '#    '],
  s: ['     ', '     ', ' ####', '#    ', ' ### ', '    #', '#### '],
  t: ['  #  ', '  #  ', '#####', '  #  ', '  #  ', '  #  ', '   ##'],
  u: ['     ', '     ', '#   #', '#   #', '#   #', '#  ##', ' ## #'],
  w: ['     ', '     ', '#   #', '#   #', '#   #', '# # #', ' # # '],
  '.': ['     ', '     ', '     ', '     ', '     ', '     ', '  #  '],
  ' ': ['     ', '     ', '     ', '     ', '     ', '     ', '     '],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

function crc32Buffer(buf) {
  return crc32(buf) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32Buffer(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createCanvas(width, height, background) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4 + 0] = background[0];
    pixels[i * 4 + 1] = background[1];
    pixels[i * 4 + 2] = background[2];
    pixels[i * 4 + 3] = 0xff;
  }

  const fillRect = (x0, y0, w, h, color) => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(height, Math.round(y0 + h)); y++) {
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(width, Math.round(x0 + w)); x++) {
        const idx = (y * width + x) * 4;
        pixels[idx + 0] = color[0];
        pixels[idx + 1] = color[1];
        pixels[idx + 2] = color[2];
        pixels[idx + 3] = 0xff;
      }
    }
  };

  return { pixels, fillRect };
}

function textWidth(text, scale) {
  return text.length * (GLYPH_W + 1) * scale - scale;
}

function drawText(canvas, text, x, y, scale, color) {
  let cursor = x;
  for (const char of text) {
    const glyph = GLYPHS[char];
    if (!glyph) throw new Error(`make-og: no glyph for ${JSON.stringify(char)}`);
    for (let row = 0; row < GLYPH_H; row++) {
      for (let col = 0; col < GLYPH_W; col++) {
        if (glyph[row][col] === '#') {
          canvas.fillRect(cursor + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cursor += (GLYPH_W + 1) * scale;
  }
}

/** A tower of stacked cream cells, narrowing as it climbs, with a lit window grid. */
function drawTower(canvas, left, baseY, cellW, cellH, floors) {
  for (let floor = 0; floor < floors; floor++) {
    const cells = floor < 6 ? 5 : floor < 11 ? 4 : floor < 15 ? 3 : 2;
    const rowW = cells * cellW;
    const rowLeft = left + ((5 * cellW - rowW) / 2);
    const top = baseY - (floor + 1) * cellH;
    canvas.fillRect(rowLeft, top, rowW, cellH - 2, CREAM);
    canvas.fillRect(rowLeft, top + cellH - 2, rowW, 2, SLAB); // the slab line under each floor
    // Two windows per cell, amber where the floor is lit.
    for (let cell = 0; cell < cells; cell++) {
      const lit = (floor * 7 + cell * 3) % 5 < 2;
      if (!lit) continue;
      const cellLeft = rowLeft + cell * cellW;
      canvas.fillRect(cellLeft + cellW * 0.22, top + cellH * 0.3, cellW * 0.18, cellH * 0.3, AMBER);
      canvas.fillRect(cellLeft + cellW * 0.6, top + cellH * 0.3, cellW * 0.18, cellH * 0.3, AMBER);
    }
  }
  // Ground line under the tower.
  canvas.fillRect(left - cellW, baseY, 7 * cellW, 4, SLAB);
}

function encodePNG(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: None
    for (let i = 0; i < stride; i++) raw[rowStart + 1 + i] = pixels[y * stride + i];
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const canvas = createCanvas(WIDTH, HEIGHT, BG);

const title = 'Hundred Stories';
const tagline = 'Build a tower. Run it well.';
const titleScale = 9;
const taglineScale = 4;

drawText(canvas, title, 80, 214, titleScale, CREAM);
canvas.fillRect(80, 214 + GLYPH_H * titleScale + 34, textWidth(title, titleScale), 3, AMBER);
drawText(canvas, tagline, 80, 214 + GLYPH_H * titleScale + 74, taglineScale, DIM);

drawTower(canvas, 900, 560, 44, 30, 17);

mkdirSync(outDir, { recursive: true });
const png = encodePNG(WIDTH, HEIGHT, canvas.pixels);
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes)`);
