// Every place that stamps the release number agrees with package.json: the lockfile, the Tauri
// shell (tauri.conf.json, Cargo.toml and the app crate's own Cargo.lock entry), the iOS
// MARKETING_VERSION and the Android versionName. The Android versionCode is the dotted version
// read as a whole number (0.4.7 -> 407), so it rises with every release.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

describe('Cargo.lock dependencies keep their own versions', () => {
  // scripts/ship.sh once bumped the app with a global `version = "OLD"` replace over Cargo.lock,
  // which also rewrote every dependency crate sitting at the old number (ten by 0.6.6), so
  // `cargo metadata --locked` could no longer resolve. See audit 2026-09-28 lane H S2.
  type Guard = { cargoLockProblems: (lock: string, toml: string) => string[] };
  const guard = async (): Promise<Guard> =>
    (await import(/* @vite-ignore */ pathToFileURL(join(repo, 'scripts', 'predeploy-check.mjs')).href)) as Guard;
  const lock = read('src-tauri/Cargo.lock');
  const toml = read('src-tauri/Cargo.toml');

  it('has no dependency at the app version other than a known genuine release (the predeploy guard)', async () => {
    expect((await guard()).cargoLockProblems(lock, toml)).toEqual([]);
  });

  it('the guard catches a global version replace, the way the old bump did it', async () => {
    // Pretend the app sits at objc2's release number, then bump it with the old global replace.
    const shared = /name = "objc2"\nversion = "([^"]+)"/.exec(lock)?.[1] as string;
    const at = (text: string, from: string, to: string) => text.replace(new RegExp(`^version = "${from.replace(/\./g, '\\.')}"$`, 'gm'), `version = "${to}"`);
    const appAt = (text: string) => text.replace(/(name = "hundred-stories"\nversion = ")[^"]+"/, `$1${shared}"`);
    const baseToml = toml.replace(/^(version = ")[^"]+"/m, `$1${shared}"`);
    const baseLock = appAt(lock);
    const sharers = [...baseLock.matchAll(new RegExp(`name = "([^"]+)"\nversion = "${shared.replace(/\./g, '\\.')}"`, 'g'))]
      .map((m) => m[1] as string)
      .filter((name) => name !== 'hundred-stories');
    expect(sharers).toContain('objc2');
    const problems = (await guard()).cargoLockProblems(at(baseLock, shared, '9.9.9'), at(baseToml, shared, '9.9.9'));
    expect(problems.map((p) => p.split(' ')[0])).toEqual(sharers);
  });

  it('the crates the old bump rewrote are back at the releases their checksums belong to', () => {
    // checksum (the sha256 of the crates.io .crate file) -> the release it is
    const restored: Record<string, [string, string]> = {
      cdeb9d870516001442e364c5220d3574d2da8dc765554b4a617230d33fa58ef5: ['block2', '0.6.2'],
      '13b588ba4ac1a99f7f2964d24b3d896ddc6bf847ee3855dbd4366f058cfcd331': ['cssparser-macros', '0.6.1'],
      '5dea2b27dd239b2556ed7a25ba842fe47fd602e7fc7433c2a8d6106d4d9edd70': ['jsonptr', '0.6.3'],
      '3a12a8ed07aefc768292f076dc3ac8c48f3781c8f2d5851dd3d98950e8c5a89f': ['objc2', '0.6.4'],
      '20675572f6f24e9e76ef639bc5552774ed45f1c30e2951e1e99c59888861c539': ['raw-window-handle', '0.6.2'],
      c3d1e2c7f27f8d4cb10542a02c49005dbd6e93095799d6f3be745fae9f8fedd4: ['socket2', '0.6.5'],
      '585635e46db231059f76c5849798146164652513eb9e8ab2685939dd90f29b69': ['string_cache_codegen', '0.6.1'],
      '7cda73e2f1397b1262d6dfdcef8aafae14d1de7748d66822d3bfeeb6d03e5e4b': ['toml_datetime', '0.6.3'],
      d9bec5a31f3f9362f2258fd0e9c9dd61a9ca432e7306cc78c444258f0dce9a9c: ['window-vibrancy', '0.6.0'],
      '3ad82d2a33cdc9674dc7465672f271e096168fcdbe0f799d9e6db8c5892679dc': ['writeable', '0.6.4'],
    };
    const found: Record<string, [string, string]> = {};
    for (const m of lock.matchAll(/name = "([^"]+)"\nversion = "([^"]+)"\nsource = "[^"]+"\nchecksum = "([0-9a-f]+)"/g)) {
      if ((m[3] as string) in restored) found[m[3] as string] = [m[1] as string, m[2] as string];
    }
    expect(found).toEqual(restored);
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
