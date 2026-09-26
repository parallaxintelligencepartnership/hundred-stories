// Pure Node PNG writer: no npm packages, just zlib + Buffer.
// Draws a background square with a lit cutaway tower (design pass D-37: an outlined amber frame,
// a lobby with two doors, five floors of three cells with lit and dark panes, a slab under each
// floor) and writes public/icons/icon-192.png and public/icons/icon-512.png, plus
// public/icons/icon-48.png, the favicon, drawn at its own size under the small-size rule rather
// than left to the browser to shrink from 192.
//
// When the Capacitor platform folders exist it also writes the native sets:
// - iOS: the 1024 master (opaque, as the App Store requires) into AppIcon.appiconset, and the
//   2732 square splash (dark steel, the amber wordmark from public/wordmark-dark.png) into
//   Splash.imageset.
// - Android: legacy and round launcher icons per density, the adaptive icon foreground
//   (silhouette on transparent, inside the 66/108 safe zone) and background colour, and the
//   portrait and landscape splash per density.

import { deflateSync, inflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');

export const BG = [0x0b, 0x10, 0x20]; // #0b1020
export const OUTLINE = [0x22, 0x22, 0x22]; // #222222, the illustrated outline
export const AMBER = [0xf4, 0xb9, 0x42]; // #f4b942, the frame
export const LOBBY = [0xf8, 0xf8, 0xf6]; // #f8f8f6, lobby marble
export const CELL = [0xf2, 0xe8, 0xd8]; // #f2e8d8, a cream room cell
export const LIT = [0xff, 0xd8, 0x66]; // #ffd866, a lit pane
export const DARK = [0x2a, 0x35, 0x50]; // #2a3550, a dark pane
export const SLAB = [0xe6, 0xe6, 0xe6]; // #e6e6e6, the slab line under a floor
/** Which panes are lit, floors top to bottom, cells left to right. */
export const PANES = [
  [1, 0, 1],
  [1, 1, 0],
  [0, 1, 1],
  [1, 0, 1],
  [1, 1, 1],
];

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

/**
 * At this size and below every pane is drawn #222222: a lit #ffd866 pane on the amber frame
 * measured 1.29:1 at 48 px and read as nothing. Larger icons keep the lit and dark panes.
 */
export const SMALL_ICON_MAX = 64;
/** At this size and below the stroke is 1 px, so each cell stays at least 2 px wide. */
export const HAIRLINE_ICON_MAX = 48;

/** The stroke: a 64th of the icon, 2 px at the least, and 1 px at HAIRLINE_ICON_MAX and below. */
export function strokeOf(size) {
  if (size <= HAIRLINE_ICON_MAX) return 1;
  return Math.max(2, Math.round(size / 64));
}

/**
 * The icon's pixels, RGBA: background (transparent when bg is null), then the tower. Every edge
 * is a rounded fraction of the size, so the web, native and adaptive icons all share one drawing.
 */
export function makeSkylinePixels(size, bg = BG) {
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; bg && i < size * size; i++) {
    pixels[i * 4 + 0] = bg[0];
    pixels[i * 4 + 1] = bg[1];
    pixels[i * 4 + 2] = bg[2];
    pixels[i * 4 + 3] = 0xff;
  }

  const fillRect = (x0, y0, x1, y1, color) => {
    for (let y = Math.max(0, y0); y < Math.min(size, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) {
        const idx = (y * size + x) * 4;
        pixels[idx + 0] = color[0];
        pixels[idx + 1] = color[1];
        pixels[idx + 2] = color[2];
        pixels[idx + 3] = 0xff;
      }
    }
  };

  const t = strokeOf(size);
  const r = (f) => Math.round(size * f);

  // The block, outlined: #222222, then the amber frame inset by the stroke.
  const left = r(0.28);
  const right = r(0.72);
  const top = r(0.12);
  const bottom = r(0.88);
  fillRect(left, top, right, bottom, OUTLINE);
  fillRect(left + t, top + t, right - t, bottom - t, AMBER);

  // Inside the frame: six equal rows, five floors over a lobby.
  const inL = left + 2 * t;
  const inR = right - 2 * t;
  const inT = top + 2 * t;
  const inB = bottom - 2 * t;
  const rowEdge = (i) => inT + Math.round(((inB - inT) * i) / 6);

  for (let floor = 0; floor < 5; floor++) {
    const y0 = rowEdge(floor);
    const y1 = rowEdge(floor + 1);
    for (let cell = 0; cell < 3; cell++) {
      const x0 = inL + Math.round(((inR - inL) * cell) / 3);
      const x1 = inL + Math.round(((inR - inL) * (cell + 1)) / 3);
      const cx0 = x0 + t;
      const cx1 = x1 - t;
      const cy0 = y0 + t;
      const cy1 = y1 - t;
      fillRect(cx0, cy0, cx1, cy1, CELL);
      const paneBottom = cy0 + Math.round((cy1 - cy0) * 0.45);
      const pane = size <= SMALL_ICON_MAX ? OUTLINE : PANES[floor][cell] ? LIT : DARK;
      fillRect(cx0, cy0, cx1, paneBottom, pane);
    }
    // The slab under the floor, one stroke tall, in the row's bottom margin.
    fillRect(inL, y1 - t, inR, y1, SLAB);
  }

  // The lobby: marble inset by the stroke, two doors either side of the center.
  const ly0 = rowEdge(5);
  const ly1 = rowEdge(6);
  fillRect(inL + t, ly0 + t, inR - t, ly1 - t, LOBBY);
  const mid = Math.round(size / 2);
  const door = r(0.05);
  const halfGap = Math.floor(t / 2);
  fillRect(mid - halfGap - door, ly0 + t, mid - halfGap, ly1 - t, OUTLINE);
  fillRect(mid + halfGap + (t % 2), ly0 + t, mid + halfGap + (t % 2) + door, ly1 - t, OUTLINE);

  return pixels;
}

export function encodePNG(size) {
  return encodePixels(makeSkylinePixels(size), size, size);
}

// Encodes an RGBA buffer. With opaque set the alpha channel is dropped (colour type 2, RGB):
// the App Store refuses an icon that carries alpha, and a splash has no use for it.
export function encodePixels(pixels, width, height, opaque = false) {
  // Raw scanlines: filter byte 0 (None) + pixel bytes per row.
  const bytesPerPixel = opaque ? 3 : 4;
  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = rowStart + 1 + x * bytesPerPixel;
      for (let c = 0; c < bytesPerPixel; c++) raw[dst + c] = pixels[src + c];
    }
  }

  const idatData = deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); // width
  ihdr.writeUInt32BE(height, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(opaque ? 2 : 6, 9); // color type: RGB or RGBA
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

function writeWebIcons() {
  mkdirSync(outDir, { recursive: true });
  for (const size of [48, 192, 512]) {
    const png = encodePNG(size);
    const outPath = join(outDir, `icon-${size}.png`);
    writeFileSync(outPath, png);
    console.log(`wrote ${outPath} (${png.length} bytes)`);
  }
}

// ---- native sets for the Capacitor shells ----

const root = join(__dirname, '..');
const SPLASH_BG = [0x1c, 0x23, 0x2e]; // #1c232e, dark steel

// Decodes an 8-bit, non-interlaced RGBA or RGB PNG (what public/wordmark-dark.png is).
function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (colorType !== 6 && colorType !== 2)) throw new Error('only 8-bit non-interlaced RGB(A) PNGs are supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * bpp];
      out[o + 1] = cur[x * bpp + 1];
      out[o + 2] = cur[x * bpp + 2];
      out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 0xff;
    }
    prev = cur;
  }
  return { width, height, pixels: out };
}

function solid(width, height, color) {
  const px = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    px[i * 4] = color[0];
    px[i * 4 + 1] = color[1];
    px[i * 4 + 2] = color[2];
    px[i * 4 + 3] = 0xff;
  }
  return px;
}

// Nearest-neighbour scale and alpha-over at (dx, dy): the wordmark is pixel art, so no smoothing.
function blit(dst, dw, dh, src, dx, dy, w, h) {
  for (let y = 0; y < h; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dh) continue;
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / h));
    for (let x = 0; x < w; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dw) continue;
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / w));
      const s = (sy * src.width + sx) * 4;
      const d = (ty * dw + tx) * 4;
      const a = src.pixels[s + 3] / 255;
      if (a === 0) continue;
      for (let c = 0; c < 3; c++) dst[d + c] = Math.round(src.pixels[s + c] * a + dst[d + c] * (1 - a));
      dst[d + 3] = Math.max(dst[d + 3], src.pixels[s + 3]);
    }
  }
}

// The splash: dark steel with the wordmark centred at half the short side, so it survives the
// centre crop both shells apply on any screen shape.
function makeSplash(width, height, wordmark) {
  const px = solid(width, height, SPLASH_BG);
  const w = Math.round(Math.min(width, height) * 0.5);
  const h = Math.round((w * wordmark.height) / wordmark.width);
  blit(px, width, height, wordmark, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
  return encodePixels(px, width, height, true);
}

// The adaptive icon foreground: the icon's silhouette on transparent, drawn at 72/108 of the
// layer (the part of an adaptive icon a launcher shows) and centred, inside the safe zone.
function makeForeground(size) {
  const inner = Math.round((size * 72) / 108);
  const icon = { width: inner, height: inner, pixels: makeSkylinePixels(inner, null) };
  const px = new Uint8Array(size * size * 4);
  const off = Math.round((size - inner) / 2);
  blit(px, size, size, icon, off, off, inner, inner);
  return encodePixels(px, size, size);
}

// The round launcher icon for launchers without adaptive icons: the full icon inside a circle.
function makeRound(size) {
  const px = makeSkylinePixels(size);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 > r * r) px[(y * size + x) * 4 + 3] = 0;
    }
  }
  return encodePixels(px, size, size);
}

function write(path, png) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  console.log(`wrote ${path.slice(root.length + 1)} (${png.length} bytes)`);
}

// wordmark-dark.png carries its own navy plate; key that colour (the corner pixel) out so the
// letters sit straight on the dark steel.
function keyOutCorner(img) {
  const [r, g, b] = img.pixels;
  for (let i = 0; i < img.width * img.height; i++) {
    const o = i * 4;
    if (img.pixels[o] === r && img.pixels[o + 1] === g && img.pixels[o + 2] === b) img.pixels[o + 3] = 0;
  }
  return img;
}

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

function writeNativeSets() {
  const wordmark = keyOutCorner(decodePNG(readFileSync(join(root, 'public', 'wordmark-dark.png'))));
  const iosAssets = join(root, 'ios', 'App', 'App', 'Assets.xcassets');
  if (existsSync(iosAssets)) {
    // The 1024 master. Contents.json names it AppIcon-512@2x.png (one universal 1024 icon).
    write(join(iosAssets, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), encodePixels(makeSkylinePixels(1024), 1024, 1024, true));
    const splash = makeSplash(2732, 2732, wordmark);
    for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) write(join(iosAssets, 'Splash.imageset', name), splash);
  } else {
    console.log('ios/ not found: skipped the iOS icon and splash (run npx cap add ios first)');
  }

  const androidRes = join(root, 'android', 'app', 'src', 'main', 'res');
  if (existsSync(androidRes)) {
    const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
    for (const [name, k] of Object.entries(densities)) {
      const legacy = Math.round(48 * k);
      write(join(androidRes, `mipmap-${name}`, 'ic_launcher.png'), encodePixels(makeSkylinePixels(legacy), legacy, legacy));
      write(join(androidRes, `mipmap-${name}`, 'ic_launcher_round.png'), makeRound(legacy));
      write(join(androidRes, `mipmap-${name}`, 'ic_launcher_foreground.png'), makeForeground(Math.round(108 * k)));
    }
    // The adaptive icon background is a flat colour, the same navy as the legacy icon.
    const bgXml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${hex(BG)}</color>\n</resources>\n`;
    writeFileSync(join(androidRes, 'values', 'ic_launcher_background.xml'), bgXml);
    console.log('wrote android/app/src/main/res/values/ic_launcher_background.xml');
    // Splash sizes follow the Capacitor template: portrait and landscape per density, and a default.
    const splashes = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
    for (const [name, [w, h]] of Object.entries(splashes)) {
      write(join(androidRes, `drawable-port-${name}`, 'splash.png'), makeSplash(w, h, wordmark));
      write(join(androidRes, `drawable-land-${name}`, 'splash.png'), makeSplash(h, w, wordmark));
    }
    write(join(androidRes, 'drawable', 'splash.png'), makeSplash(480, 320, wordmark));
  } else {
    console.log('android/ not found: skipped the Android icons and splash (run npx cap add android first)');
  }
}

// Run as a script it writes every set; imported (tests/site/icons.test.ts) it only draws.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeWebIcons();
  writeNativeSets();
}
