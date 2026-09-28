// Plain Node, no dependencies. Static gate run before `wrangler deploy` (see the "deploy"
// script in package.json). Checks the built dist/ output for the two things most likely to
// silently break after a PixiJS upgrade or a CSP edit:
//   (a) dist/_headers still serves a Content-Security-Policy for /play/ with
//       script-src 'self' and no 'unsafe-eval'
//   (b) dist/play/index.html exists (the app entry point)
//   (c) the PixiJS "unsafe-eval" shim (imported first in src/render/renderer.ts, required
//       because our CSP has no 'unsafe-eval') is actually present in the built JS assets
//   (d) src-tauri/Cargo.lock: no dependency crate carries the app's version unless it is a
//       known genuine release at that number (a global version replace once rewrote ten)
// On failure this prints one line and exits 1. On success it prints "predeploy check: ok"
// and exits 0.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');
const tauriDir = join(__dirname, '..', 'src-tauri');

function fail(reason) {
  console.error(reason);
  process.exit(1);
}

// (d) Dependency crates that genuinely sit at a version the app has used, keyed name@version,
// with their crates.io checksum. A version bump that rewrites a dependency's version keeps the
// dependency's old checksum, so the pair no longer matches and the check fails. Add an entry
// only after checking the checksum against the registry (sha256 of the .crate file); the
// entries below were checked on 2026-09-28 and cover the app versions up to 0.7.3.
export const GENUINE_AT_APP_VERSION = {
  'zlib-rs@0.6.8': 'b268e58e7c693d7c271f93ffc4ba3b380412554231c85bf61ca7af91042a4112',
  'serde_spanned@0.6.9': 'bf41e0cfaf7226dca15e8197172c295a782857fcb97fad1808a166870dee75a3',
  'tower-http@0.6.11': '4cfcf7e2740e6fc6d4d688b4ef00650406bb94adf4731e43c096c3a19fe40840',
  'keyboard-types@0.7.0': 'b750dcadc39a09dbadd74e118f6dd6598df77fa01df0cfcdc52c28dece74528a',
  'cfb@0.7.3': 'd38f2da7a0a2c4ccf0065be06397cc26a81f4e528be095826eee9d4adbb8c60f',
};

// Lists every non-app [[package]] in Cargo.lock that carries the app's version from
// Cargo.toml and is not a known genuine release at that number. Empty means clean.
export function cargoLockProblems(lockText, tomlText) {
  const pkg = /^\[package\]\n(?:[^[\n][^\n]*\n|\n)*?name = "([^"]+)"\n(?:[^[\n][^\n]*\n|\n)*?version = "([^"]+)"/m.exec(tomlText);
  if (!pkg) return ['src-tauri/Cargo.toml has no [package] name and version'];
  const [, app, version] = pkg;
  const problems = [];
  for (const block of lockText.split('[[package]]\n').slice(1)) {
    const field = (key) => new RegExp(`^${key} = "([^"]*)"`, 'm').exec(block)?.[1];
    const name = field('name');
    if (name === app || field('version') !== version) continue;
    const checksum = field('checksum');
    if (!checksum || GENUINE_AT_APP_VERSION[`${name}@${version}`] !== checksum) {
      problems.push(`${name} ${version} (checksum ${checksum ?? 'none'})`);
    }
  }
  return problems;
}

function checkCargoLock() {
  const problems = cargoLockProblems(
    readFileSync(join(tauriDir, 'Cargo.lock'), 'utf8'),
    readFileSync(join(tauriDir, 'Cargo.toml'), 'utf8'),
  );
  if (problems.length > 0) {
    fail(`predeploy check failed: src-tauri/Cargo.lock has dependencies at the app version: ${problems.join(', ')}`);
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
  checkDist();
  console.log('predeploy check: ok');
}
