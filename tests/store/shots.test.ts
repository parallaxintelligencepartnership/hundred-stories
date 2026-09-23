// The store screenshot script (scripts/make-store-shots.mjs) against the store docs
// (store/ios.md, store/android.md, store/steam.md). The docs list every size a store asks for in
// a table row that starts `| \`id\` | \`WIDTHxHEIGHT\` |`; the script's tables must carry the same
// ids at the same sizes, and every viewport must make its size exactly.
//
// Skipped when Chrome is absent, because the script cannot run there. The full run (build,
// preview, headless Chrome, 39 files) takes minutes, so it only runs with STORE_SHOTS_E2E=1.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Size {
  id: string;
  store: string;
  width: number;
  height: number;
}
interface Shot extends Size {
  css: { w: number; h: number; dpr: number };
}
interface ShotsModule {
  FIXTURE: string;
  OUT_DIR: string;
  SCREENSHOTS: Shot[];
  SCENES: string[];
  GRAPHICS: Size[];
  NOT_MADE: Size[];
}

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'make-store-shots.mjs');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasChrome = existsSync(CHROME);
const DOCS = { ios: 'store/ios.md', android: 'store/android.md', steam: 'store/steam.md' } as const;

async function load(): Promise<ShotsModule> {
  const url = pathToFileURL(SCRIPT).href;
  return (await import(/* @vite-ignore */ url)) as ShotsModule;
}

/** Every `| \`id\` | \`WxH\` |` row in a doc. */
function docSizes(path: string): Map<string, string> {
  const text = readFileSync(join(ROOT, path), 'utf8');
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^\|\s*`([a-z0-9.-]+)`\s*\|\s*`(\d+)x(\d+)`\s*\|/gm)) {
    out.set(m[1]!, `${m[2]}x${m[3]}`);
  }
  return out;
}

describe.skipIf(!hasChrome)(`store screenshot sizes (needs Chrome, skipped without it: ${CHROME})`, () => {
  it('lists in each store doc exactly the sizes the script makes or reports as not made', async () => {
    const mod = await load();
    const all = [...mod.SCREENSHOTS, ...mod.GRAPHICS, ...mod.NOT_MADE];
    for (const [store, path] of Object.entries(DOCS)) {
      const fromScript = new Map(all.filter((s) => s.store === store).map((s) => [s.id, `${s.width}x${s.height}`]));
      const fromDoc = docSizes(path);
      expect(fromDoc.size, `${path} has a size table`).toBeGreaterThan(0);
      expect(Object.fromEntries(fromDoc), path).toEqual(Object.fromEntries(fromScript));
    }
  });

  it('makes every screenshot size exactly from its viewport and pixel ratio', async () => {
    const { SCREENSHOTS } = await load();
    for (const s of SCREENSHOTS) {
      expect([Math.round(s.css.w * s.css.dpr), Math.round(s.css.h * s.css.dpr)], s.id).toEqual([s.width, s.height]);
    }
  });

  it('meets the rules the docs state: 5 Steam shots, Play sides and ratio, Apple portrait', async () => {
    const { SCREENSHOTS, SCENES } = await load();
    expect(SCENES.length).toBeGreaterThanOrEqual(5);
    for (const s of SCREENSHOTS.filter((x) => x.store === 'android')) {
      const long = Math.max(s.width, s.height);
      const short = Math.min(s.width, s.height);
      expect(short, s.id).toBeGreaterThanOrEqual(1080);
      expect(long, s.id).toBeLessThanOrEqual(3840);
      expect(long / short, s.id).toBeLessThanOrEqual(2);
    }
    for (const s of SCREENSHOTS.filter((x) => x.store === 'ios')) expect(s.height, s.id).toBeGreaterThan(s.width);
    const steam = SCREENSHOTS.find((x) => x.id === 'steam-screenshot');
    expect(steam && [steam.width, steam.height]).toEqual([1920, 1080]);
  });

  it('seeds a committed fixture that is a game save', async () => {
    const { FIXTURE } = await load();
    const save = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { version: number; rooms: unknown[] };
    expect(typeof save.version).toBe('number');
    expect(save.rooms.length).toBeGreaterThan(0);
  });

  it.skipIf(process.env.STORE_SHOTS_E2E !== '1')(
    'runs against a local preview and writes the expected file set (STORE_SHOTS_E2E=1)',
    async () => {
      const mod = await load();
      const run = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 600_000 });
      expect(run.status, run.stderr.slice(-500)).toBe(0);
      const manifest = JSON.parse(readFileSync(join(mod.OUT_DIR, 'manifest.json'), 'utf8')) as { files: { file: string }[] };
      const expected = [
        ...mod.SCREENSHOTS.flatMap((s) => mod.SCENES.map((scene, i) => `store/shots/${s.store}/${s.id}-${i + 1}-${scene}.png`)),
        ...mod.GRAPHICS.map((g) => `store/shots/${g.store}/${g.id}.png`),
      ].sort();
      expect(manifest.files.map((f) => f.file).sort()).toEqual(expected);
      for (const f of expected) expect(existsSync(join(ROOT, f)), f).toBe(true);
    },
    620_000,
  );
});
