// Every place that stamps the release number agrees with package.json: the lockfile, the Tauri
// shell (tauri.conf.json, Cargo.toml and the app crate's own Cargo.lock entry), the iOS
// MARKETING_VERSION and the Android versionName. The Android versionCode is the dotted version
// read as a whole number (0.4.7 -> 407), so it rises with every release.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(__dirname, '../..');
const read = (path: string): string => readFileSync(join(repo, path), 'utf8');

const pkg = JSON.parse(read('package.json')) as { name: string; version: string };
const version = pkg.version;

function all(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] as string);
}

describe('version stamps', () => {
  it('package.json carries a plain three-part version', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('package-lock.json matches at the top and for the root package', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    expect(lock.version).toBe(version);
    expect(lock.packages['']?.version).toBe(version);
  });

  it('the Tauri config, Cargo.toml and the app crate in Cargo.lock match', () => {
    const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as { version: string };
    expect(conf.version).toBe(version);

    const toml = read('src-tauri/Cargo.toml');
    const crate = /^\[package\][^[]*?^name = "([^"]+)"[^[]*?^version = "([^"]+)"/m.exec(toml);
    expect(crate).not.toBeNull();
    expect(crate?.[2]).toBe(version);

    const lock = read('src-tauri/Cargo.lock');
    const entry = all(lock, new RegExp(`\\[\\[package\\]\\]\\nname = "${crate?.[1]}"\\nversion = "([^"]+)"`, 'g'));
    expect(entry).toEqual([version]);
  });

  it('every iOS build configuration has MARKETING_VERSION set to it', () => {
    const marketing = all(read('ios/App/App.xcodeproj/project.pbxproj'), /MARKETING_VERSION = ([^;]+);/g);
    expect(marketing.length).toBeGreaterThan(0);
    expect(new Set(marketing)).toEqual(new Set([version]));
  });

  it('Android versionName matches and versionCode is the version as a whole number', () => {
    const gradle = read('android/app/build.gradle');
    expect(all(gradle, /versionName "([^"]+)"/g)).toEqual([version]);
    const [major, minor, patch] = version.split('.').map(Number) as [number, number, number];
    const code = major * 10000 + minor * 100 + patch;
    expect(all(gradle, /versionCode (\d+)/g)).toEqual([String(code)]);
  });
});

describe('public/_headers no-cache rules key to page paths', () => {
  // Workers static assets 307-redirect a request for a bare `.../index.html` path to the
  // directory path it serves the file at; a _headers rule matches the request path, not the
  // path actually served, so an /index.html-shaped rule only ever fires on that redirect. See
  // verify-H S8. Every no-cache page rule must be a directory path (or /), not an *.html path.
  it('keys every rule other than /assets/*, named .js files and .webmanifest to a page path ending in /', () => {
    const headers = read('public/_headers');
    const paths = all(headers, /^(\/\S*)$/gm);
    const exempt = (path: string) => path === '/*' || path === '/assets/*' || path.endsWith('.js') || path.endsWith('.webmanifest');
    for (const path of paths) {
      if (exempt(path)) continue;
      expect(path.endsWith('/'), path).toBe(true);
    }
  });
});

describe('Tauri desktop capability', () => {
  // The save slot in src/game/storage.ts only ever mkdir, read_text_file, write_text_file,
  // rename and write_file under $APPDATA, plus the save/open dialogs. The three recursive
  // read-all/write-all/meta-all sets granted far more of the filesystem than that; see
  // verify-H S7. This pins the minimum list so it cannot silently widen again.
  it('grants exactly the minimum fs and dialog permissions, including fs:allow-rename', () => {
    const cap = JSON.parse(read('src-tauri/capabilities/default.json')) as { permissions: string[] };
    expect(cap.permissions).toEqual([
      'core:default',
      'fs:scope-appdata-recursive',
      'fs:allow-mkdir',
      'fs:allow-read-text-file',
      'fs:allow-write-text-file',
      'fs:allow-rename',
      'fs:allow-write-file',
      'dialog:allow-save',
      'dialog:allow-open',
    ]);
    expect(cap.permissions).not.toEqual(
      expect.arrayContaining(['fs:allow-appdata-read-recursive', 'fs:allow-appdata-write-recursive', 'fs:allow-appdata-meta-recursive']),
    );
  });
});
