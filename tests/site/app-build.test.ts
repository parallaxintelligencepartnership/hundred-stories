// The app build (`vite build --mode app`) copies everything from public/, then vite.config.ts's
// closeBundle step strips the site-only files the Capacitor/Tauri shells never load. This
// exercises the real build so a regression in that cleanup step is caught.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

const scratchBase =
  '/private/tmp/claude-501/-Users-matthew-parallax-private-Projects-hundred-stories/acc2e706-8695-456f-aeb4-16bc26c91bd2/scratchpad/appbuild';
const outDirBase = existsSync(scratchBase) ? scratchBase : tmpdir();
const outDir = mkdtempSync(join(outDirBase, 'build-'));
const webOutDir = mkdtempSync(join(outDirBase, 'web-'));

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
  rmSync(webOutDir, { recursive: true, force: true });
});

describe('app build output', () => {
  it(
    'drops site-only public/ files and keeps the game page and assets',
    async () => {
      await build({
        configFile: join(__dirname, '../../vite.config.ts'),
        mode: 'app',
        build: { outDir },
      });

      const entries = readdirSync(outDir);

      for (const name of ['_headers', 'robots.txt', 'sitemap.xml', 'og.png']) {
        expect(entries).not.toContain(name);
      }
      expect(entries.some((name) => name.startsWith('wordmark'))).toBe(false);

      expect(entries).toContain('index.html');
      expect(entries).toContain('assets');
    },
    120_000,
  );
});

// The Capacitor and Tauri plugin code loads only inside the shells. vite.config.ts names those
// chunks native-* and leaves them out of the web service worker's precache; nothing the web page
// loads up front may import one statically, or /play/ would not boot offline.
describe('web build precache', () => {
  it(
    'emits the Capacitor and Tauri code as native- chunks, precaches none of them and keeps the play chunk',
    async () => {
      await build({
        configFile: join(__dirname, '../../vite.config.ts'),
        logLevel: 'silent',
        build: { outDir: webOutDir },
      });

      const assets = readdirSync(join(webOutDir, 'assets'));
      const native = assets.filter((name) => name.startsWith('native-'));
      expect(native.some((name) => name.startsWith('native-capacitor-filesystem-'))).toBe(true);
      expect(native.some((name) => name.startsWith('native-capacitor-share-'))).toBe(true);
      expect(native.some((name) => name.startsWith('native-tauri-plugin-fs-'))).toBe(true);
      expect(native.some((name) => name.startsWith('native-tauri-api-'))).toBe(true);

      const sw = readFileSync(join(webOutDir, 'sw.js'), 'utf8');
      const precached = [...sw.matchAll(/["']?url["']?\s*:\s*"([^"]+)"/g)].map((match) => match[1] as string);
      expect(precached.length).toBeGreaterThan(0);
      expect(precached.filter((url) => url.includes('native-'))).toEqual([]);
      expect(precached.some((url) => /^assets\/play-[\w-]+\.js$/.test(url))).toBe(true);
      expect(precached).toContain('play/index.html');

      const staticNativeImports = precached
        .filter((url) => url.endsWith('.js') || url.endsWith('.html'))
        .filter((url) => /(from|import)\s*["'][./]*(assets\/)?native-/.test(readFileSync(join(webOutDir, url), 'utf8')));
      expect(staticNativeImports).toEqual([]);
    },
    120_000,
  );
});
