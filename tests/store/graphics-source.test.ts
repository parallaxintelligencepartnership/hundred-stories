// Store graphics (scripts/make-store-shots.mjs GRAPHICS) must be read straight off disk (repo
// public/), never fetched through the preview origin: dist-app strips og.png, robots.txt,
// sitemap.xml and every wordmark file (vite.config.ts APP_UNUSED_PUBLIC_FILES), so a fetch to
// `${base}/og.png` hits the SPA fallback and resolves to the game's index.html, not an image.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Graphic {
  id: string;
  source: string;
}
interface ShotsModule {
  GRAPHICS: Graphic[];
  graphicSourceDataUrl: (g: Graphic, root?: string) => string;
}

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'make-store-shots.mjs');
const SOURCE_TEXT = readFileSync(SCRIPT, 'utf8');

async function load(): Promise<ShotsModule> {
  const url = pathToFileURL(SCRIPT).href;
  return (await import(/* @vite-ignore */ url)) as ShotsModule;
}

describe('store graphics are read from public/, not the preview origin', () => {
  it('every GRAPHICS source exists on disk under the repo, not dist-app', async () => {
    const { GRAPHICS } = await load();
    expect(GRAPHICS.length).toBeGreaterThan(0);
    for (const g of GRAPHICS) {
      expect(g.source.startsWith('public/'), g.id).toBe(true);
      expect(existsSync(join(ROOT, g.source)), `${g.id}: ${g.source}`).toBe(true);
    }
  });

  it('never loads a GRAPHICS source through the preview base (no `${base}/...source` fetch)', () => {
    // The historical bug built a URL as `${base}/${g.source.replace(/^public\//, '')}` and
    // fetched that. Guard against it coming back in any form.
    expect(SOURCE_TEXT).not.toMatch(/\$\{base\}\/\$\{g\.source/);
    expect(SOURCE_TEXT).not.toMatch(/base\}\/\$\{[^}]*source/);
  });

  it('produces a data: URL with an image/* content type for every source', async () => {
    const { GRAPHICS, graphicSourceDataUrl } = await load();
    for (const g of GRAPHICS) {
      const url = graphicSourceDataUrl(g, ROOT);
      expect(url.startsWith('data:image/'), g.id).toBe(true);
    }
  });

  it('throws a clear error for a source that does not exist on disk', async () => {
    const { graphicSourceDataUrl } = await load();
    expect(() => graphicSourceDataUrl({ id: 'missing-thing', source: 'public/does-not-exist.png' }, ROOT)).toThrow(
      /missing-thing.*does not exist on disk/,
    );
  });
});
