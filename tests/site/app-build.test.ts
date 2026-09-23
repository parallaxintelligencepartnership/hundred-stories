// The app build (`vite build --mode app`) copies everything from public/, then vite.config.ts's
// closeBundle step strips the site-only files the Capacitor/Tauri shells never load. This
// exercises the real build so a regression in that cleanup step is caught.
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

const scratchBase =
  '/private/tmp/claude-501/-Users-matthew-parallax-private-Projects-hundred-stories/acc2e706-8695-456f-aeb4-16bc26c91bd2/scratchpad/appbuild';
const outDirBase = existsSync(scratchBase) ? scratchBase : tmpdir();
const outDir = mkdtempSync(join(outDirBase, 'build-'));

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
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
