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
  windowUnlit: 0x2a3550,
  windowFrame: 0x222222,
  simCalm: 0x111111,
  bgDark: 0x0b1020,
  bgLight: 0x9fd3f5, // docs/VISUAL.md line 24, sky day top color
};

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32), seed constant so window lighting is reproducible
// across runs.
// ---------------------------------------------------------------------------

const WINDOW_SEED = 100;
const WINDOW_UNLIT_CHANCE = 0.25;

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

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
const LINE_GAP_CELLS = 0.5; // half-cell gap between the two lines (was 1 full row)

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
  return { rows1, rows2, width, height1: rows1.length, height2: rows2.length };
}

// ---------------------------------------------------------------------------
// Scene: turn the bitmap into a flat list of rects (in px, at a given scale).
// s = CELL / 12, so s=1 for the base SVG (CELL=12) and s=4 for the 4x PNGs (CELL=48).
// ---------------------------------------------------------------------------

export function buildScene(variant, s, { paddingXCells = 2, paddingYCells = 2 } = {}) {
  const CELL = 12 * s;
  const { rows1, rows2, width: gridW, height1, height2 } = buildBitmap();
  const rects = [];

  const rng = mulberry32(WINDOW_SEED);
  let unlitCount = 0;

  // Cell centres for both lines, in row-major order (line 1 then line 2), so
  // the RNG is consumed in the same order every run regardless of variant.
  const gap2Y = height1 * CELL + LINE_GAP_CELLS * CELL;
  const cells = [];
  for (let gy = 0; gy < height1; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (rows1[gy][gx] === '#') cells.push({ x0: gx * CELL, y0: gy * CELL });
    }
  }
  for (let gy = 0; gy < height2; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (rows2[gy][gx] === '#') cells.push({ x0: gx * CELL, y0: gap2Y + gy * CELL });
    }
  }

  for (const { x0, y0 } of cells) {
    let windowColor;
    if (variant === 'dark') {
      const unlit = rng() < WINDOW_UNLIT_CHANCE;
      if (unlit) unlitCount++;
      windowColor = unlit ? COLOR.windowUnlit : COLOR.windowLit;
    } else {
      windowColor = COLOR.windowDay;
    }
    // Room cell: outline square, cream wall inset by 1px, window band framed
    // across the top third. All numbers below are in base-12 units times s.
    rects.push({ x: x0, y: y0, w: 12 * s, h: 12 * s, color: COLOR.outline });
    rects.push({ x: x0 + 1 * s, y: y0 + 1 * s, w: 10 * s, h: 10 * s, color: COLOR.cream });
    rects.push({ x: x0 + 2 * s, y: y0 + 1 * s, w: 8 * s, h: 4 * s, color: COLOR.windowFrame });
    rects.push({ x: x0 + 3 * s, y: y0 + 2 * s, w: 6 * s, h: 2 * s, color: windowColor });
  }

  const gridPxW = gridW * CELL;
  const gridPxH = gap2Y + height2 * CELL;

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

  const paddingX = paddingXCells * CELL;
  const paddingY = paddingYCells * CELL;
  const width = gridPxW + paddingX * 2;
  const height = bottom + paddingY * 2;

  // Shift every rect by the left/top padding.
  const shifted = rects.map((r) => ({ ...r, x: r.x + paddingX, y: r.y + paddingY }));

  return { width, height, rects: shifted, unlitCount };
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

/** Draw a flat list of {x,y,w,h,color} rects (color = 0xRRGGBB int) onto an
 * RGBA pixel buffer, clipping to [0, bufWidth) x [0, bufHeight). */
function drawRectsOnBuffer(pixels, bufWidth, bufHeight, rects) {
  const fillRect = (x0, y0, x1, y1, color) => {
    const rgb = toRGB(color);
    for (let y = Math.max(0, y0); y < Math.min(bufHeight, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(bufWidth, x1); x++) {
        const idx = (y * bufWidth + x) * 4;
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
}

/**
 * Draw the two-line HUNDRED STORIES room-cell grid onto an existing RGBA
 * pixel buffer (as produced e.g. by scripts/make-og.mjs's canvas), at pixel
 * offset (x, y), with a given cell size (cellSize = the size of one 12-unit
 * grid cell in px, i.e. CELL = cellSize, s = cellSize / 12) and colour
 * variant ('dark' | 'light'). Pixels outside [0, bufWidth) x [0, bufHeight)
 * are clipped. Returns the scene (width/height/rects/unlitCount) that was
 * drawn (with rects already shifted by x, y), in case the caller wants to
 * lay out around it.
 */
export function drawWordmarkOnBuffer(pixels, bufWidth, bufHeight, x, y, cellSize, variant, opts) {
  const s = cellSize / 12;
  const scene = buildScene(variant, s, opts);
  const shiftedRects = scene.rects.map((r) => ({ ...r, x: r.x + x, y: r.y + y }));
  drawRectsOnBuffer(pixels, bufWidth, bufHeight, shiftedRects);
  return { ...scene, rects: shiftedRects };
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

  drawRectsOnBuffer(pixels, width, height, rects);

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

// Guarded so scripts/make-og.mjs can import buildScene/drawWordmarkOnBuffer
// from this module without re-running the file-writing main script.
function main() {
  const bitmap = buildBitmap();
  console.log('HUNDRED STORIES bitmap (5x7 letters, %d wide, line1=%d rows, line2=%d rows):', bitmap.width, bitmap.height1, bitmap.height2);
  for (const row of bitmap.rows1) console.log(row);
  for (const row of bitmap.rows2) console.log(row);

  mkdirSync(outDir, { recursive: true });

  for (const variant of ['dark', 'light']) {
    const svgScene = buildScene(variant, 1, { paddingXCells: 2, paddingYCells: 2 });
    const svg = buildSVG(svgScene);
    const svgPath = join(outDir, `wordmark-${variant}.svg`);
    writeFileSync(svgPath, svg);
    console.log(`wrote ${svgPath} (${svgScene.width}x${svgScene.height})`);

    const pngScene = buildScene(variant, 4, { paddingXCells: 1, paddingYCells: 2 });
    const bg = variant === 'dark' ? COLOR.bgDark : COLOR.bgLight;
    const png = encodePNG(pngScene.width, pngScene.height, bg, pngScene.rects);
    const pngPath = join(outDir, `wordmark-${variant}.png`);
    writeFileSync(pngPath, png);
    console.log(`wrote ${pngPath} (${pngScene.width}x${pngScene.height}, ${png.length} bytes)`);
    if (variant === 'dark') {
      console.log(`  seed=${WINDOW_SEED}, unlit windows: ${pngScene.unlitCount}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
