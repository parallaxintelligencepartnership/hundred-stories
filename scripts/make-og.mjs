// Pure Node PNG writer for the link preview card, same approach as make-icons.mjs:
// no npm packages, just zlib + Buffer. Draws public/og.png at 1200x630 with the
// real wordmark (imported from scripts/make-wordmark.mjs) and the tagline beneath it.
//
// Node has no text rasterizer and this script may not add a dependency, so the
// tagline is drawn from a small 5x7 cell font defined below rather than from
// the page font stack. The letterforms are blocky on purpose: they match the
// wordmark beside them.

import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScene, drawWordmarkOnBuffer } from './make-wordmark.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public');
const outPath = join(outDir, 'og.png');

const WIDTH = 1200;
const HEIGHT = 630;

const BG = [0x0b, 0x10, 0x20]; // #0b1020, the page background
const DIM = [0x98, 0xa3, 0xb3]; // --ink-dim

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

// The wordmark: the same HUNDRED STORIES room-cell grid used for
// public/wordmark-dark.svg/png, drawn straight onto this canvas so the link
// preview card and the header wordmark are the same art.
const WORDMARK_CELL_SIZE = 24; // s = 2
const wordmarkScene = buildScene('dark', WORDMARK_CELL_SIZE / 12, { paddingXCells: 0, paddingYCells: 0 });
const wordmarkX = Math.round((WIDTH - wordmarkScene.width) / 2);
const wordmarkY = 40; // top two-thirds of 630px is 0-420; the wordmark sits near the top of that band
drawWordmarkOnBuffer(
  canvas.pixels,
  WIDTH,
  HEIGHT,
  wordmarkX,
  wordmarkY,
  WORDMARK_CELL_SIZE,
  'dark',
  { paddingXCells: 0, paddingYCells: 0 },
);

const tagline = 'Build a tower. Run it well.';
const taglineScale = 4;
const taglineY = wordmarkY + wordmarkScene.height + 40;
drawText(canvas, tagline, Math.round((WIDTH - textWidth(tagline, taglineScale)) / 2), taglineY, taglineScale, DIM);

mkdirSync(outDir, { recursive: true });
const png = encodePNG(WIDTH, HEIGHT, canvas.pixels);
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes)`);
