// The typefaces ship with the site and the app: no page, stylesheet, script, CSP or shell config
// names a font host, and both builds carry the woff2 files src/fonts.css points at.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

const repo = join(__dirname, '../..');
const FONT_HOSTS = /googleapis|gstatic/;
// Build output and caches inside the shells are not sources.
const SKIP_DIRS = new Set(['node_modules', 'target', 'gen', '.git']);

function walk(path: string, out: string[] = []): string[] {
  if (statSync(path).isFile()) {
    out.push(path);
    return out;
  }
  for (const name of readdirSync(path)) {
    if (SKIP_DIRS.has(name)) continue;
    walk(join(path, name), out);
  }
  return out;
}

function filesNamingFontHosts(paths: string[]): string[] {
  return paths.filter((file) => FONT_HOSTS.test(readFileSync(file, 'latin1')));
}

const fontsCss = readFileSync(join(repo, 'src/fonts.css'), 'utf8');
const fontUrls = [...fontsCss.matchAll(/url\('(\/fonts\/[^']+\.woff2)'\)/g)].map((m) => m[1] ?? '');
const fontFiles = [...new Set(fontUrls)].map((url) => url.replace(/^\/fonts\//, ''));

describe('bundled fonts: sources', () => {
  it('no source file names a Google Fonts host', () => {
    const roots = [
      'src',
      'public',
      'index.html',
      'how-to-play',
      'privacy',
      '404.html',
      'play',
      'src-tauri',
      'deploy',
      'vite.config.ts',
    ];
    const files = roots.flatMap((root) => walk(join(repo, root)));
    expect(files.length).toBeGreaterThan(50);
    expect(filesNamingFontHosts(files)).toEqual([]);
  });

  it('src/fonts.css declares both families from /fonts/, and every file it names is in public/fonts', () => {
    expect(fontsCss).toMatch(/font-family: 'Bricolage Grotesque';[^}]*font-weight: 400;/);
    expect(fontsCss).toMatch(/font-family: 'Bricolage Grotesque';[^}]*font-weight: 600;/);
    expect(fontsCss).toMatch(/font-family: 'Share Tech Mono';/);
    expect(fontsCss.match(/font-display: swap;/g)).toHaveLength(3);
    expect(fontsCss.match(/unicode-range: U\+0000-00FF/g)).toHaveLength(3);
    expect(fontFiles).toEqual(['bricolage-grotesque-latin.woff2', 'share-tech-mono-latin.woff2']);
    for (const name of fontFiles) {
      expect(existsSync(join(repo, 'public/fonts', name))).toBe(true);
    }
    expect(existsSync(join(repo, 'public/fonts/OFL-Bricolage-Grotesque.txt'))).toBe(true);
    expect(existsSync(join(repo, 'public/fonts/OFL-Share-Tech-Mono.txt'))).toBe(true);
  });

  it('the game and site stylesheets both import src/fonts.css first', () => {
    for (const sheet of ['src/ui/ui.css', 'src/site/site.css']) {
      expect(readFileSync(join(repo, sheet), 'utf8').startsWith("@import '../fonts.css';\n")).toBe(true);
    }
  });

  it('every CSP allows fonts from self only', () => {
    const policies = [
      readFileSync(join(repo, 'public/_headers'), 'utf8'),
      JSON.parse(readFileSync(join(repo, 'src-tauri/tauri.conf.json'), 'utf8')).app.security.csp as string,
      readFileSync(join(repo, 'deploy/nginx.conf'), 'utf8'),
    ];
    for (const policy of policies) {
      expect(policy).toMatch(/font-src 'self';/);
      expect(policy).toMatch(/style-src 'self' 'unsafe-inline';/);
    }
  });
});

describe('bundled fonts: builds', () => {
  const base = mkdtempSync(join(tmpdir(), 'hs-fonts-'));
  const siteOut = join(base, 'dist');
  const appOut = join(base, 'dist-app');

  beforeAll(async () => {
    const configFile = join(repo, 'vite.config.ts');
    await build({ configFile, logLevel: 'silent', build: { outDir: siteOut } });
    await build({ configFile, logLevel: 'silent', mode: 'app', build: { outDir: appOut } });
  }, 240_000);

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('the site build and the app build both carry the woff2 files in fonts/', () => {
    expect(fontFiles).toHaveLength(2);
    for (const out of [siteOut, appOut]) {
      for (const name of fontFiles) {
        expect(existsSync(join(out, 'fonts', name)), `${out}/fonts/${name}`).toBe(true);
      }
    }
  });

  it('no built file names a Google Fonts host, and the built CSS points at /fonts/', () => {
    for (const out of [siteOut, appOut]) {
      const files = walk(out);
      expect(filesNamingFontHosts(files)).toEqual([]);
      const css = files.filter((file) => file.endsWith('.css')).map((file) => readFileSync(file, 'utf8'));
      expect(css.some((text) => text.includes('/fonts/bricolage-grotesque-latin.woff2'))).toBe(true);
    }
  });

  it('the service worker precaches the fonts', () => {
    expect(fontFiles).toHaveLength(2);
    const sw = readFileSync(join(siteOut, 'sw.js'), 'utf8');
    for (const name of fontFiles) expect(sw).toContain(`fonts/${name}`);
  });
});
