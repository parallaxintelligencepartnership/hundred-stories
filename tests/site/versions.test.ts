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
