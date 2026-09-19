// Wordmark: "HUNDRED STORIES" set in the game's own room-cell sprites.
// Pure Node, no npm dependencies. PNG chunk/deflate helpers copied from
// scripts/make-icons.mjs (do not edit that file from here).
//
// Colour sources (must match the game exactly):
//   - src/render/art.ts PALETTE: outline 0x222222, slab 0xe6e6e6, slabEdge 0x333333,
//     windowDay 0x7fb6e0, windowLit 0xffd866, windowFrame 0x222222, sim.calm 0x111111,
//     wall.condo 0xf2e8d8 (the cream room-cell wall used here).
//   - docs/VISUAL.md line 28: "room walls: ... condo `#f2e8d8` ..." -> the cream wall token.
//   - docs/VISUAL.md line 24: "sky: day `#9fd3f5` at the top ..." -> the sky blue used as the
//     light-variant PNG background.
//   - Dark-variant background 0x0b1020, the same background used by scripts/make-icons.mjs.

import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public');

// ---------------------------------------------------------------------------
// Colours, taken verbatim from src/render/art.ts PALETTE and docs/VISUAL.md.
// ---------------------------------------------------------------------------

const COLOR = {
  outline: 0x222222,
  cream: 0xf2e8d8, // PALETTE.wall.condo / docs/VISUAL.md line 28
  slab: 0xe6e6e6,
  slabEdge: 0x333333,
  windowDay: 0x7fb6e0,
  windowLit: 0xffd866,
  windowFrame: 0x222222,
  simCalm: 0x111111,
  bgDark: 0x0b1020,
  bgLight: 0x9fd3f5, // docs/VISUAL.md line 24, sky day top color
};

function toRGB(hex) {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

// ---------------------------------------------------------------------------
// 5x7 block-capital bitmap font. Each letter is seven rows of 5 chars,
// '#' = ink, '.' = empty.
// ---------------------------------------------------------------------------

const LETTERS = {
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
};

const LINE1 = 'HUNDRED';
const LINE2 = 'STORIES';
const LETTER_W = 5;
const LETTER_H = 7;
const LETTER_GAP = 1; // empty column between letters
const LINE_GAP = 1; // empty row between the two lines

function buildLineRows(word) {
  const rows = [];
  for (let r = 0; r < LETTER_H; r++) {
    let row = '';
    for (let i = 0; i < word.length; i++) {
      if (i > 0) row += '.'.repeat(LETTER_GAP);
      row += LETTERS[word[i]][r];
    }
    rows.push(row);
  }
  return rows;
}

function buildBitmap() {
  const rows1 = buildLineRows(LINE1);
  const rows2 = buildLineRows(LINE2);
  const width = rows1[0].length; // both words are 7 letters, same width
  const blankRow = '.'.repeat(width);
  const rows = [...rows1, ...Array(LINE_GAP).fill(blankRow), ...rows2];
  return { rows, width, height: rows.length };
}

// ---------------------------------------------------------------------------
// Scene: turn the bitmap into a flat list of rects (in px, at a given scale).
// s = CELL / 12, so s=1 for the base SVG (CELL=12) and s=4 for the 4x PNGs (CELL=48).
// ---------------------------------------------------------------------------

function buildScene(variant, s) {
  const CELL = 12 * s;
  const { rows, width: gridW, height: gridH } = buildBitmap();
  const rects = [];

  const windowColor = variant === 'dark' ? COLOR.windowLit : COLOR.windowDay;

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (rows[gy][gx] !== '#') continue;
      const x0 = gx * CELL;
      const y0 = gy * CELL;
      // Room cell: outline square, cream wall inset by 1px, window band framed
      // across the top third. All numbers below are in base-12 units times s.
      rects.push({ x: x0, y: y0, w: 12 * s, h: 12 * s, color: COLOR.outline });
      rects.push({ x: x0 + 1 * s, y: y0 + 1 * s, w: 10 * s, h: 10 * s, color: COLOR.cream });
      rects.push({ x: x0 + 2 * s, y: y0 + 1 * s, w: 8 * s, h: 4 * s, color: COLOR.windowFrame });
      rects.push({ x: x0 + 3 * s, y: y0 + 2 * s, w: 6 * s, h: 2 * s, color: windowColor });
    }
  }

  const gridPxW = gridW * CELL;
  const gridPxH = gridH * CELL;

  // Slab beneath the bottom line of letters: 1px edge, then 3px slab, full width.
  const slabEdgeY = gridPxH;
  rects.push({ x: 0, y: slabEdgeY, w: gridPxW, h: 1 * s, color: COLOR.slabEdge });
  rects.push({ x: 0, y: slabEdgeY + 1 * s, w: gridPxW, h: 3 * s, color: COLOR.slab });

  let bottom = slabEdgeY + 1 * s + 3 * s;

  // Dark variant only: a row of three tiny sim dots under the slab.
  if (variant === 'dark') {
    const dotGapY = 2 * s;
    const dotW = 2 * s;
    const dotH = 3 * s;
    const dotY = bottom + dotGapY;
    const positions = [0.2, 0.5, 0.8];
    for (const p of positions) {
      const dotX = Math.round(p * gridPxW - dotW / 2);
      rects.push({ x: dotX, y: dotY, w: dotW, h: dotH, color: COLOR.simCalm });
    }
    bottom = dotY + dotH;
  }

  const padding = 2 * CELL; // 2 cells of padding on every side
  const width = gridPxW + padding * 2;
  const height = bottom + padding * 2;

  // Shift every rect by the left/top padding.
  const shifted = rects.map((r) => ({ ...r, x: r.x + padding, y: r.y + padding }));

  return { width, height, rects: shifted };
}

// ---------------------------------------------------------------------------
// SVG output: transparent background, crisp rects only.
// ---------------------------------------------------------------------------

function hex(color) {
  return '#' + color.toString(16).padStart(6, '0');
}

function buildSVG(scene) {
  const rectsMarkup = scene.rects
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${hex(r.color)}"/>`)
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" shape-rendering="crispEdges">
  ${rectsMarkup}
</svg>
`;
}

// ---------------------------------------------------------------------------
// PNG writer: pure Node zlib + Buffer, copied from scripts/make-icons.mjs.
// ---------------------------------------------------------------------------

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

function makeScenePixels(width, height, bgColor, rects) {
  const pixels = new Uint8Array(width * height * 4);
  const bg = toRGB(bgColor);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4 + 0] = bg[0];
    pixels[i * 4 + 1] = bg[1];
    pixels[i * 4 + 2] = bg[2];
    pixels[i * 4 + 3] = 0xff;
  }

  const fillRect = (x0, y0, x1, y1, color) => {
    const rgb = toRGB(color);
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
        const idx = (y * width + x) * 4;
        pixels[idx + 0] = rgb[0];
        pixels[idx + 1] = rgb[1];
        pixels[idx + 2] = rgb[2];
        pixels[idx + 3] = 0xff;
      }
    }
  };

  for (const r of rects) {
    fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.x + r.w), Math.round(r.y + r.h), r.color);
  }

  return pixels;
}

function encodePNG(width, height, bgColor, rects) {
  const pixels = makeScenePixels(width, height, bgColor, rects);

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: None
    const pixelRowStart = y * stride;
    for (let i = 0; i < stride; i++) {
      raw[rowStart + 1 + i] = pixels[pixelRowStart + i];
    }
  }

  const idatData = deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9); // color type: RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Run: print the ASCII bitmap for review, then write SVG (1x, CELL=12) and
// PNG (4x, CELL=48) for both variants.
// ---------------------------------------------------------------------------

const bitmap = buildBitmap();
console.log('HUNDRED STORIES bitmap (5x7 letters, %d x %d):', bitmap.width, bitmap.height);
for (const row of bitmap.rows) console.log(row);

mkdirSync(outDir, { recursive: true });

for (const variant of ['dark', 'light']) {
  const svgScene = buildScene(variant, 1);
  const svg = buildSVG(svgScene);
  const svgPath = join(outDir, `wordmark-${variant}.svg`);
  writeFileSync(svgPath, svg);
  console.log(`wrote ${svgPath} (${svgScene.width}x${svgScene.height})`);

  const pngScene = buildScene(variant, 4);
  const bg = variant === 'dark' ? COLOR.bgDark : COLOR.bgLight;
  const png = encodePNG(pngScene.width, pngScene.height, bg, pngScene.rects);
  const pngPath = join(outDir, `wordmark-${variant}.png`);
  writeFileSync(pngPath, png);
  console.log(`wrote ${pngPath} (${pngScene.width}x${pngScene.height}, ${png.length} bytes)`);
}
