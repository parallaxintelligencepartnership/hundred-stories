// Every place that stamps the release number agrees with package.json: the lockfile, the Tauri
// shell (tauri.conf.json, Cargo.toml and the app crate's own Cargo.lock entry), the iOS
// MARKETING_VERSION and the Android versionName. The Android versionCode is the dotted version
// read as a whole number (0.4.7 -> 407), so it rises with every release.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
  // The predeploy guard checks every dependency at the app's version against the local cargo
  // registry (the .crate files and the sparse index cache). These tests build their own registry
  // in a temp folder, from the current lock's checksums, so they give the same answer on a
  // machine with no cargo cache.
  type Check = { mismatched: string[]; unverified: string[] };
  type Guard = {
    cargoLockCheck: (lock: string, toml: string, registryDir?: string) => Check;
    cargoLockProblems: (lock: string, toml: string, registryDir?: string) => string[];
    cargoMetadataCheck: (manifestDir?: string, cargo?: string | null) => string | null;
    findCargo: () => string | null;
  };
  const guard = async (): Promise<Guard> =>
    (await import(/* @vite-ignore */ pathToFileURL(join(repo, 'scripts', 'predeploy-check.mjs')).href)) as Guard;
  const lock = read('src-tauri/Cargo.lock');
  const toml = read('src-tauri/Cargo.toml');
  const appVersionOf = (text: string) => /name = "hundred-stories"\nversion = "([^"]+)"/.exec(text)?.[1] as string;
  const withApp = (v: string) => ({
    lock: lock.replace(/(name = "hundred-stories"\nversion = ")[^"]+"/, `$1${v}"`),
    toml: toml.replace(/^(version = ")[^"]+"/m, `$1${v}"`),
  });

  /** A registry folder whose sparse index lists every registry crate in the current lock. */
  function fakeRegistry(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hs-registry-'));
    const byName = new Map<string, { vers: string; cksum: string }[]>();
    for (const m of lock.matchAll(/name = "([^"]+)"\nversion = "([^"]+)"\nsource = "registry[^"]+"\nchecksum = "([0-9a-f]+)"/g)) {
      byName.set(m[1] as string, [...(byName.get(m[1] as string) ?? []), { vers: m[2] as string, cksum: m[3] as string }]);
    }
    for (const [name, releases] of byName) {
      const n = name.toLowerCase();
      const rel = n.length === 1 ? ['1', n] : n.length === 2 ? ['2', n] : n.length === 3 ? ['3', n[0]!, n] : [n.slice(0, 2), n.slice(2, 4), n];
      const file = join(dir, 'index', 'index.crates.io-test', '.cache', ...rel);
      mkdirSync(dirname(file), { recursive: true });
      const parts = ['\u0003etag: "x"'];
      for (const r of releases) parts.push(r.vers, JSON.stringify({ name, vers: r.vers, deps: [], cksum: r.cksum, features: {}, yanked: false }));
      writeFileSync(file, parts.join('\0') + '\0');
    }
    return dir;
  }

  it('the current lock passes the guard, against the real cache and a registry built from it', async () => {
    const g = await guard();
    expect(g.cargoLockProblems(lock, toml)).toEqual([]);
    expect(g.cargoLockCheck(lock, toml, fakeRegistry())).toEqual({ mismatched: [], unverified: [] });
  });

  it('flags all ten crates the 0.6.6 bump rewrote (the lock at 0f05723, with the app at 0.6.6)', async (ctx) => {
    let old: string;
    try {
      old = execFileSync('git', ['show', '0f05723:src-tauri/Cargo.lock'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      ctx.skip('git or commit 0f05723 is not available here');
      return;
    }
    const oldToml = toml.replace(/^(version = ")[^"]+"/m, '$10.6.6"');
    const { mismatched, unverified } = (await guard()).cargoLockCheck(old, oldToml, fakeRegistry());
    expect(mismatched.map((p) => p.split(' ')[0])).toEqual([
      'block2', 'cssparser-macros', 'jsonptr', 'objc2', 'raw-window-handle',
      'socket2', 'string_cache_codegen', 'toml_datetime', 'window-vibrancy', 'writeable',
    ]);
    expect(mismatched.find((p) => p.startsWith('objc2 '))).toContain('belongs to objc2 0.6.4');
    expect(unverified).toEqual([]);
  });

  it('a genuine crate at the app version passes: libloading 0.7.4, num_enum 0.7.6, ctor 0.8.0', async () => {
    const g = await guard();
    const registry = fakeRegistry();
    for (const v of ['0.6.8', '0.6.9', '0.7.0', '0.7.3', '0.7.4', '0.7.6', '0.8.0']) {
      const at = withApp(v);
      expect(g.cargoLockCheck(at.lock, at.toml, registry), v).toEqual({ mismatched: [], unverified: [] });
    }
    expect(lock).toMatch(/name = "libloading"\nversion = "0\.7\.4"/);
  });

  it('a global version replace is caught, the way the old bump did it', async () => {
    const shared = /name = "objc2"\nversion = "([^"]+)"/.exec(lock)?.[1] as string;
    const base = withApp(shared);
    const sharers = [...base.lock.matchAll(new RegExp(`name = "([^"]+)"\nversion = "${shared.replace(/\./g, '\\.')}"`, 'g'))]
      .map((m) => m[1] as string)
      .filter((name) => name !== 'hundred-stories');
    expect(sharers).toContain('objc2');
    const replace = (text: string) => text.replace(new RegExp(`^version = "${shared.replace(/\./g, '\\.')}"$`, 'gm'), 'version = "9.9.9"');
    const problems = (await guard()).cargoLockProblems(replace(base.lock), replace(base.toml), fakeRegistry());
    expect(problems.map((p) => p.split(' ')[0])).toEqual(sharers);
  });

  it('a crate the registry cache has never seen is unverified and does not fail (a fresh machine)', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'hs-registry-empty-'));
    const at = withApp('0.7.4');
    expect((await guard()).cargoLockCheck(at.lock, at.toml, empty)).toEqual({ mismatched: [], unverified: ['libloading 0.7.4'] });
  });

  it('a checksum that differs from the registry for the same release is a mismatch', async () => {
    const at = withApp('0.7.4');
    const bad = at.lock.replace(/(name = "libloading"\nversion = "0\.7\.4"\nsource = "[^"]+"\nchecksum = ")[0-9a-f]+"/, `$1${'0'.repeat(64)}"`);
    const problems = (await guard()).cargoLockProblems(bad, at.toml, fakeRegistry());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^libloading 0\.7\.4 \(checksum 0{64}, the registry has [0-9a-f]{64}\)$/);
  });

  describe('cargo metadata --locked --offline', () => {
    it('resolves the current lock, or says it skipped because cargo is absent', async (ctx) => {
      const g = await guard();
      const cargo = g.findCargo();
      if (cargo === null) {
        expect(g.cargoMetadataCheck(join(repo, 'src-tauri'), null)).toBe('skipped');
        ctx.skip('cargo is not installed here; the predeploy check skips this step with a message');
        return;
      }
      expect(appVersionOf(lock)).toBe(version);
      expect(g.cargoMetadataCheck(join(repo, 'src-tauri'), cargo)).toBeNull();
    }, 60_000);

    it('fails on a lock that cannot resolve (the 0.6.6 rewrite)', async (ctx) => {
      const g = await guard();
      const cargo = g.findCargo();
      if (cargo === null) {
        ctx.skip('cargo is not installed here');
        return;
      }
      let old: string;
      try {
        old = execFileSync('git', ['show', '0f05723:src-tauri/Cargo.lock'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        ctx.skip('git or commit 0f05723 is not available here');
        return;
      }
      // A copy of the manifest with empty sources, so cargo can read the targets offline.
      const dir = mkdtempSync(join(tmpdir(), 'hs-cargo-'));
      mkdirSync(join(dir, 'src'));
      for (const f of ['src/lib.rs', 'src/main.rs', 'build.rs']) writeFileSync(join(dir, f), '');
      writeFileSync(join(dir, 'Cargo.toml'), toml);
      writeFileSync(join(dir, 'Cargo.lock'), lock);
      expect(g.cargoMetadataCheck(dir, cargo)).toBeNull();
      writeFileSync(join(dir, 'Cargo.lock'), old.replace(/(name = "hundred-stories"\nversion = ")[^"]+"/, `$1${appVersionOf(lock)}"`));
      expect(g.cargoMetadataCheck(dir, cargo)).toEqual(expect.any(String));
    }, 60_000);
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
