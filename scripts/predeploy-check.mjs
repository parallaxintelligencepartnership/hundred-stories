// Plain Node, no dependencies. Static gate run before `wrangler deploy` (see the "deploy"
// script in package.json). Checks the built dist/ output for the two things most likely to
// silently break after a PixiJS upgrade or a CSP edit:
//   (a) dist/_headers still serves a Content-Security-Policy for /play/ with
//       script-src 'self' and no 'unsafe-eval'
//   (b) dist/play/index.html exists (the app entry point)
//   (c) the PixiJS "unsafe-eval" shim (imported first in src/render/renderer.ts, required
//       because our CSP has no 'unsafe-eval') is actually present in the built JS assets
//   (d) src-tauri/Cargo.lock: every dependency crate at the app's version has the checksum
//       crates.io gives that release, read from the local cargo registry cache (a global
//       version replace once rewrote ten crates' versions and kept their old checksums)
//   (e) `cargo metadata --locked --offline` resolves the lock, where cargo is installed
// On failure this prints one line and exits 1. On success it prints "predeploy check: ok"
// and exits 0.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');
const tauriDir = join(__dirname, '..', 'src-tauri');

function fail(reason) {
  console.error(reason);
  process.exit(1);
}

/** $CARGO_HOME/registry, or ~/.cargo/registry. */
export function defaultRegistryDir() {
  return join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'registry');
}

/** Where the sparse index keeps a crate's entry: 1/a, 2/ab, 3/a/abc, ab/cd/abcd... */
function indexPath(name) {
  const n = name.toLowerCase();
  if (n.length === 1) return join('1', n);
  if (n.length === 2) return join('2', n);
  if (n.length === 3) return join('3', n[0], n);
  return join(n.slice(0, 2), n.slice(2, 4), n);
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function subdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(dir, d.name));
  } catch {
    return [];
  }
}

/**
 * What the local registry knows of one crate: version -> checksum, from the downloaded .crate
 * files (their sha256) and the sparse index cache (its "cksum" field). A .crate file wins over
 * the index when both are present.
 */
function knownReleases(registryDir, name) {
  const known = new Map();
  for (const dir of subdirs(join(registryDir, 'index'))) {
    const file = join(dir, '.cache', indexPath(name));
    if (!existsSync(file)) continue;
    // The cache file is a header then NUL-separated pairs of version and JSON line.
    for (const part of readFileSync(file, 'latin1').split('\0')) {
      if (!part.startsWith('{')) continue;
      try {
        const entry = JSON.parse(Buffer.from(part, 'latin1').toString('utf8'));
        if (entry.name === name && typeof entry.vers === 'string' && typeof entry.cksum === 'string') {
          known.set(entry.vers, entry.cksum);
        }
      } catch {
        // A line the parser cannot read tells us nothing; skip it.
      }
    }
  }
  for (const dir of subdirs(join(registryDir, 'cache'))) {
    let files = [];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.startsWith(`${name}-`) || !file.endsWith('.crate')) continue;
      const vers = file.slice(name.length + 1, -'.crate'.length);
      if (!/^\d/.test(vers)) continue; // another crate whose name starts with this one
      known.set(vers, sha256File(join(dir, file)));
    }
  }
  return known;
}

/**
 * Checks every non-app [[package]] in Cargo.lock that carries the app's version (from
 * Cargo.toml) against the local registry. A crate whose release is known and whose checksum
 * differs, or whose checksum belongs to another release of the same crate, is a mismatch. A crate
 * the registry cache has never seen (a fresh machine) is unverified, which does not fail.
 */
export function cargoLockCheck(lockText, tomlText, registryDir = defaultRegistryDir()) {
  const pkg = /^\[package\]\n(?:[^[\n][^\n]*\n|\n)*?name = "([^"]+)"\n(?:[^[\n][^\n]*\n|\n)*?version = "([^"]+)"/m.exec(tomlText);
  if (!pkg) return { mismatched: ['src-tauri/Cargo.toml has no [package] name and version'], unverified: [] };
  const [, app, version] = pkg;
  const mismatched = [];
  const unverified = [];
  for (const block of lockText.split('[[package]]\n').slice(1)) {
    const field = (key) => new RegExp(`^${key} = "([^"]*)"`, 'm').exec(block)?.[1];
    const name = field('name');
    if (!name || name === app || field('version') !== version) continue;
    const checksum = field('checksum');
    if (!checksum) {
      unverified.push(`${name} ${version} (no checksum)`);
      continue;
    }
    const known = knownReleases(registryDir, name);
    const expected = known.get(version);
    if (expected !== undefined) {
      if (expected !== checksum) mismatched.push(`${name} ${version} (checksum ${checksum}, the registry has ${expected})`);
      continue;
    }
    const owner = [...known].find(([, sum]) => sum === checksum)?.[0];
    if (owner !== undefined) mismatched.push(`${name} ${version} (checksum ${checksum} belongs to ${name} ${owner})`);
    else unverified.push(`${name} ${version}`);
  }
  return { mismatched, unverified };
}

/** The mismatches only: empty means nothing in the lock is known to be wrong. */
export function cargoLockProblems(lockText, tomlText, registryDir = defaultRegistryDir()) {
  return cargoLockCheck(lockText, tomlText, registryDir).mismatched;
}

function checkCargoLock() {
  const { mismatched, unverified } = cargoLockCheck(
    readFileSync(join(tauriDir, 'Cargo.lock'), 'utf8'),
    readFileSync(join(tauriDir, 'Cargo.toml'), 'utf8'),
  );
  if (mismatched.length > 0) {
    fail(`predeploy check failed: src-tauri/Cargo.lock has dependencies at the app version whose checksum is not that release's: ${mismatched.join('; ')}`);
  }
  if (unverified.length > 0) {
    console.warn(
      `predeploy check: unverified, not in the local cargo registry cache (run cargo fetch in src-tauri to check them): ${unverified.join(', ')}`,
    );
  }
}

/** cargo on PATH, else $CARGO_HOME/bin/cargo, else null. */
export function findCargo() {
  const onPath = spawnSync('cargo', ['--version'], { stdio: 'ignore' });
  if (!onPath.error && onPath.status === 0) return 'cargo';
  const home = join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'bin', 'cargo');
  return existsSync(home) ? home : null;
}

/**
 * (e) The lock resolves as written, with no network: `cargo metadata --locked --offline`.
 * Returns null when it passes, 'skipped' when cargo is absent, or the error text.
 */
export function cargoMetadataCheck(manifestDir = tauriDir, cargo = findCargo()) {
  if (cargo === null) return 'skipped';
  const run = spawnSync(
    cargo,
    ['metadata', '--locked', '--offline', '--format-version', '1', '--manifest-path', join(manifestDir, 'Cargo.toml')],
    { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] },
  );
  if (run.error) return String(run.error.message);
  if (run.status !== 0) return (run.stderr || `exit ${run.status}`).trim().split('\n').slice(-3).join(' ');
  return null;
}

function checkCargoMetadata() {
  const result = cargoMetadataCheck();
  if (result === 'skipped') {
    console.warn('predeploy check: cargo not found, skipping cargo metadata --locked --offline');
  } else if (result !== null) {
    fail(`predeploy check failed: cargo metadata --locked --offline on src-tauri: ${result}`);
  }
}

function checkDist() {
  // (a) dist/_headers: find the block whose path applies to /play/ and check its CSP line.
  const headersPath = join(distDir, '_headers');
  if (!existsSync(headersPath)) fail('predeploy check failed: dist/_headers is missing');
  const headersText = readFileSync(headersPath, 'utf8');

  // _headers is a sequence of blocks: a path line, then indented header lines, until a blank
  // line or the next unindented path line. Find the block that applies to /play/ (an exact
  // match, or the wildcard /* block that covers it).
  const lines = headersText.split('\n');
  let currentPath = null;
  let cspForPlay = null;
  let cspForWildcard = null;
  for (const line of lines) {
    if (line.trim() === '') {
      currentPath = null;
      continue;
    }
    if (!/^\s/.test(line)) {
      currentPath = line.trim();
      continue;
    }
    const m = line.match(/^\s*Content-Security-Policy:\s*(.+)$/);
    if (m && currentPath === '/play/') cspForPlay = m[1];
    if (m && currentPath === '/*') cspForWildcard = m[1];
  }
  const csp = cspForPlay ?? cspForWildcard;
  if (!csp) fail('predeploy check failed: dist/_headers has no Content-Security-Policy for /play/');
  if (!csp.includes("script-src 'self'")) {
    fail("predeploy check failed: dist/_headers CSP for /play/ is missing script-src 'self'");
  }
  if (csp.includes('unsafe-eval')) {
    fail('predeploy check failed: dist/_headers CSP for /play/ contains unsafe-eval');
  }

  // (b) dist/play/index.html exists
  const playIndexPath = join(distDir, 'play', 'index.html');
  if (!existsSync(playIndexPath)) fail('predeploy check failed: dist/play/index.html is missing');

  // (c) the pixi.js/unsafe-eval shim is present in the built JS assets. The shim (see
  // node_modules/pixi.js/lib/unsafe-eval/init.mjs, selfInstall()) overrides
  // AbstractRenderer.prototype._unsafeEvalCheck with a no-op so PixiJS skips its eval-based
  // codepaths under our CSP. That method name survives minification (it's a real property
  // name being overridden at runtime, not a local variable), so `_unsafeEvalCheck(){}` in a
  // built asset is a reliable marker that the shim was bundled.
  const assetsDir = join(distDir, 'assets');
  if (!existsSync(assetsDir)) fail('predeploy check failed: dist/assets is missing');
  const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
  const shimMarker = '_unsafeEvalCheck(){}';
  const shimFound = jsFiles.some((f) => readFileSync(join(assetsDir, f), 'utf8').includes(shimMarker));
  if (!shimFound) {
    fail('predeploy check failed: pixi.js unsafe-eval shim marker not found in dist/assets/*.js');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkCargoLock();
  checkCargoMetadata();
  checkDist();
  console.log('predeploy check: ok');
}
