// The landing hero's still image, public/hero-still.webp: one frame of the live hero canvas, the
// demo tower in daylight exactly as hero.ts frames it on a desktop, with no copy panel baked in.
// It is what a first visit paints (and Largest Contentful Paint measures) before the renderer
// loads, and all a visitor with reduced motion or no WebGL ever sees, so the swap to the live
// canvas is near invisible.
//
// It builds the site, serves dist/ with vite preview, opens / in headless Chrome at 1600 by 900,
// waits for the hero's settled marker (src/site/hero-ready.ts) to say "drawn", hides the copy
// panel, and captures the #hero-view box (1600 by 479 at that width: the 480 px hero less its bottom border) as WebP at quality 80. The
// Chrome plumbing is copied from scripts/make-store-shots.mjs. No npm packages: Node and Chrome.
//
// Run it whenever the hero tower or its framing changes: `node scripts/make-hero-still.mjs`
// (--no-build to reuse dist/, BASE=http://... to shoot a running server instead).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME_PATH = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = join(ROOT, 'public', 'hero-still.webp');
const VIEWPORT = { width: 1600, height: 900 };
const STILL = { width: 1600, height: 479 }; // the hero is 480 tall with a 1 px bottom border under the canvas
const QUALITY = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

async function waitForHttp(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`nothing answered at ${url}`);
}

async function startPreview() {
  const port = await freePort();
  const vite = join(ROOT, 'node_modules', '.bin', 'vite');
  const child = spawn(vite, ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  await waitForHttp(`${base}/`);
  return { base, stop: () => child.kill() };
}

/** Headless Chrome on a fresh profile, Metal first, SwiftShader if WebGL fails (make-store-shots.mjs). */
async function launchChrome(angle) {
  const port = await freePort();
  const profile = join(tmpdir(), `hs-hero-still-${port}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const gpu = angle === 'metal'
    ? ['--use-angle=metal', '--ignore-gpu-blocklist']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const proc = spawn(CHROME_PATH, ['--headless=new', ...gpu, '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  for (let i = 0; i < 75 && !targets.some((t) => t.type === 'page'); i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      // not up yet
    }
    if (!targets.some((t) => t.type === 'page')) await sleep(200);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) {
    proc.kill();
    throw new Error('Chrome did not open a page target');
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error)));
      else res(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  const close = async () => {
    try { ws.close(); } catch { /* already closed */ }
    const exited = new Promise((res) => proc.once('exit', res));
    proc.kill();
    await Promise.race([exited, sleep(3000)]);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { send, evaluate, close, angle };
}

const WEBGL_PROBE = `(() => { const c = document.createElement('canvas').getContext('webgl2'); return c ? 'yes' : 'none'; })()`;

/** Resolves with the settled marker's value ("drawn" or "none"), or "timeout" after 30 s. */
const SETTLED = `new Promise((resolve) => {
  const t0 = performance.now();
  const poll = () => {
    const v = document.documentElement.getAttribute('data-hero-settled');
    if (v) return resolve(v);
    if (performance.now() - t0 > 30000) return resolve('timeout');
    setTimeout(poll, 100);
  };
  poll();
})`;

async function shoot(browser, base) {
  await browser.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.navigate', { url: `${base}/?cb=${Date.now()}` });
  const settled = await browser.evaluate(SETTLED);
  if (settled !== 'drawn') throw new Error(`the hero settled as "${settled}", not "drawn": no frame to capture`);
  // The panel steps out after the camera has measured it, so the frame keeps the live framing
  // (the tower right of where the copy sits) with nothing painted over it. Two more frames land.
  const box = await browser.evaluate(`(async () => {
    const wrap = document.querySelector('#hero .wrap');
    if (wrap) wrap.style.visibility = 'hidden';
    window.scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = document.getElementById('hero-view').getBoundingClientRect();
    return { x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width, height: b.height };
  })()`);
  if (Math.round(box.width) !== STILL.width || Math.round(box.height) !== STILL.height) {
    throw new Error(`#hero-view is ${box.width} by ${box.height}, the still is ${STILL.width} by ${STILL.height}`);
  }
  const r = await browser.send('Page.captureScreenshot', {
    format: 'webp',
    quality: QUALITY,
    clip: { x: box.x, y: box.y, width: STILL.width, height: STILL.height, scale: 1 },
  });
  return Buffer.from(r.data, 'base64');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!existsSync(CHROME_PATH)) {
    console.error(`Chrome not found at ${CHROME_PATH}; set CHROME to its path.`);
    process.exit(2);
  }
  let preview = null;
  let base = process.env.BASE;
  if (!base) {
    if (!args.has('--no-build')) {
      const b = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
      if (b.status !== 0) process.exit(b.status ?? 1);
    }
    if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('dist/index.html is missing: run npm run build');
    preview = await startPreview();
    base = preview.base;
  }
  let browser = await launchChrome(process.env.ANGLE ?? 'metal');
  try {
    await browser.send('Page.navigate', { url: `${base}/robots.txt` });
    await sleep(300);
    if ((await browser.evaluate(WEBGL_PROBE)) === 'none' && browser.angle === 'metal') {
      console.log('Metal gave no WebGL in headless Chrome; falling back to SwiftShader.');
      await browser.close();
      browser = await launchChrome('swiftshader');
    }
    const webp = await shoot(browser, base);
    writeFileSync(OUT, webp);
    console.log(`wrote ${relative(ROOT, OUT)} (${webp.length} bytes, ${STILL.width} by ${STILL.height}, ${browser.angle})`);
  } finally {
    try {
      await browser.close();
    } finally {
      if (preview) preview.stop();
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
