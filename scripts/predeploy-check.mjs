// Plain Node, no dependencies. Static gate run before `wrangler deploy` (see the "deploy"
// script in package.json). Checks the built dist/ output for the two things most likely to
// silently break after a PixiJS upgrade or a CSP edit:
//   (a) dist/_headers still serves a Content-Security-Policy for /play/ with
//       script-src 'self' and no 'unsafe-eval'
//   (b) dist/play/index.html exists (the app entry point)
//   (c) the PixiJS "unsafe-eval" shim (imported first in src/render/renderer.ts, required
//       because our CSP has no 'unsafe-eval') is actually present in the built JS assets
// On failure this prints one line and exits 1. On success it prints "predeploy check: ok"
// and exits 0.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

function fail(reason) {
  console.error(reason);
  process.exit(1);
}

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

console.log('predeploy check: ok');
