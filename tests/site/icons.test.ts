// The app icon (scripts/make-icons.mjs, design pass D-37): a lit cutaway tower, five floors of
// three cells over a lobby with two doors, in an outlined amber frame on navy. The drawing is
// counted by its colour regions, so a change in rounding never breaks it but a lost pane does.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

type Rgb = number[];
interface IconsModule {
  BG: Rgb;
  OUTLINE: Rgb;
  AMBER: Rgb;
  LOBBY: Rgb;
  CELL: Rgb;
  LIT: Rgb;
  DARK: Rgb;
  SLAB: Rgb;
  PANES: number[][];
  strokeOf: (size: number) => number;
  makeSkylinePixels: (size: number, bg?: Rgb | null) => Uint8Array;
  encodePNG: (size: number) => Buffer;
  encodePixels: (pixels: Uint8Array, width: number, height: number, opaque?: boolean) => Buffer;
}

const ROOT = join(__dirname, '..', '..');

async function load(): Promise<IconsModule> {
  return (await import(/* @vite-ignore */ pathToFileURL(join(ROOT, 'scripts', 'make-icons.mjs')).href)) as IconsModule;
}

function at(px: Uint8Array, size: number, x: number, y: number): number[] {
  const i = (y * size + x) * 4;
  return [px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!];
}

const same = (a: number[], rgb: Rgb): boolean => a[0] === rgb[0] && a[1] === rgb[1] && a[2] === rgb[2] && a[3] === 255;

type Box = { width: number; height: number };

/** Four-connected regions of one colour, each as its bounding box. */
function boxes(px: Uint8Array, size: number, rgb: Rgb): Box[] {
  const seen = new Uint8Array(size * size);
  const out: Box[] = [];
  for (let start = 0; start < size * size; start++) {
    if (seen[start] || !same(at(px, size, start % size, Math.floor(start / size)), rgb)) continue;
    let [minX, maxX, minY, maxY] = [size, -1, size, -1];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      const x = p % size;
      const y = Math.floor(p / size);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const n = ny * size + nx;
        if (seen[n] || !same(at(px, size, nx, ny), rgb)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    out.push({ width: maxX - minX + 1, height: maxY - minY + 1 });
  }
  return out;
}

const regions = (px: Uint8Array, size: number, rgb: Rgb): number => boxes(px, size, rgb).length;

describe('the app icon is a lit cutaway tower', () => {
  it('strokes at a 64th of the size, 2 px at the least, and 1 px at 48 px and below', async () => {
    const { strokeOf } = await load();
    expect(strokeOf(36)).toBe(1);
    expect(strokeOf(48)).toBe(1);
    expect(strokeOf(49)).toBe(2);
    expect(strokeOf(64)).toBe(2);
    expect(strokeOf(192)).toBe(3);
    expect(strokeOf(512)).toBe(8);
  });

  it.each([48, 64])('at %i px draws every pane in #222222 and keeps every cell at least 2 px wide', async (size) => {
    const m = await load();
    const px = m.makeSkylinePixels(size);
    // Lit #ffd866 on the amber frame measured 1.29:1 at 48 px: small icons carry no lit panes.
    expect(regions(px, size, m.LIT)).toBe(0);
    expect(regions(px, size, m.DARK)).toBe(0);
    const cells = boxes(px, size, m.CELL);
    expect(cells).toHaveLength(15);
    for (const cell of cells) expect(cell.width).toBeGreaterThanOrEqual(2);
    // The outline ring, 15 panes and the two doors.
    expect(regions(px, size, m.OUTLINE)).toBe(1 + 15 + 2);
    expect(regions(px, size, m.SLAB)).toBe(5);
    expect(regions(px, size, m.LOBBY)).toBe(3);
  });

  it('lights the panes in the pattern, 11 lit and 4 dark', async () => {
    const { PANES } = await load();
    expect(PANES).toEqual([
      [1, 0, 1],
      [1, 1, 0],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]);
  });

  it.each([192, 512, 1024])('at %i px draws five floors of three cells, the panes countable, over a two door lobby', async (size) => {
    const m = await load();
    const px = m.makeSkylinePixels(size);
    // Navy outside, the #222222 outline at the block's corner, amber just inside it.
    expect(same(at(px, size, 0, 0), m.BG)).toBe(true);
    const left = Math.round(size * 0.28);
    const top = Math.round(size * 0.12);
    const t = m.strokeOf(size);
    expect(same(at(px, size, left, top), m.OUTLINE)).toBe(true);
    expect(same(at(px, size, left + t, top + t), m.AMBER)).toBe(true);
    expect(same(at(px, size, Math.round(size * 0.72), top), m.BG)).toBe(true);
    expect(same(at(px, size, left, Math.round(size * 0.88)), m.BG)).toBe(true);

    expect(regions(px, size, m.LIT)).toBe(11);
    expect(regions(px, size, m.DARK)).toBe(4);
    expect(regions(px, size, m.CELL)).toBe(15);
    expect(regions(px, size, m.SLAB)).toBe(5);
    // The lobby marble, split in three by the two doors.
    expect(regions(px, size, m.LOBBY)).toBe(3);
  });

  it('draws the adaptive foreground on transparency with the same tower', async () => {
    const m = await load();
    const px = m.makeSkylinePixels(192, null);
    expect(at(px, 192, 0, 0)[3]).toBe(0);
    expect(regions(px, 192, m.LIT)).toBe(11);
  });

  it('ships the native 48 px launcher as the script draws it', async () => {
    const { encodePixels, makeSkylinePixels } = await load();
    const onDisk = readFileSync(join(ROOT, 'android', 'app', 'src', 'main', 'res', 'mipmap-mdpi', 'ic_launcher.png'));
    expect(onDisk.equals(encodePixels(makeSkylinePixels(48), 48, 48))).toBe(true);
  });

  it('ships public/icons/icon-48.png, the favicon, drawn at 48 px with the small-size rule', async () => {
    const m = await load();
    const onDisk = readFileSync(join(ROOT, 'public', 'icons', 'icon-48.png'));
    expect([onDisk.readUInt32BE(16), onDisk.readUInt32BE(20)]).toEqual([48, 48]);
    expect(onDisk.equals(m.encodePNG(48))).toBe(true);
    expect(m.strokeOf(48)).toBe(1);
    const px = m.makeSkylinePixels(48);
    expect(regions(px, 48, m.LIT)).toBe(0);
    expect(regions(px, 48, m.DARK)).toBe(0);
  });

  it('ships public/icons/ as the script draws them', async () => {
    const { encodePNG } = await load();
    for (const size of [192, 512]) {
      const onDisk = readFileSync(join(ROOT, 'public', 'icons', `icon-${size}.png`));
      expect(onDisk.equals(encodePNG(size)), `icon-${size}.png`).toBe(true);
    }
  });
});

describe('importing scripts/make-icons.mjs', () => {
  /** Every file the script writes lives under these: the web icons and both native sets. */
  const OUTPUT_DIRS = [
    join(ROOT, 'public', 'icons'),
    join(ROOT, 'android', 'app', 'src', 'main', 'res'),
    join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets'),
  ];
  const outputs = (): string[] =>
    OUTPUT_DIRS.filter((dir) => existsSync(dir)).flatMap((dir) =>
      (readdirSync(dir, { recursive: true }) as string[]).map((name) => join(dir, name)).filter((path) => statSync(path).isFile()),
    );

  it('writes nothing: only running it as a script (npm run icons) writes the icons', async () => {
    const files = outputs();
    expect(files.some((path) => path.endsWith(join('public', 'icons', 'icon-192.png')))).toBe(true);
    const before = new Map(files.map((path) => [path, statSync(path, { bigint: true }).mtimeNs]));
    // A fresh evaluation of the module, not the copy the cases above already imported.
    const url = `${pathToFileURL(join(ROOT, 'scripts', 'make-icons.mjs')).href}?fresh=${Date.now()}`;
    const fresh = (await import(/* @vite-ignore */ url)) as IconsModule;
    expect(typeof fresh.makeSkylinePixels).toBe('function');
    const touched = files.filter((path) => statSync(path, { bigint: true }).mtimeNs !== before.get(path));
    expect(touched).toEqual([]);
  });
});
