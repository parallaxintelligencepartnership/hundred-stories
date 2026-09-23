// Store screenshots and store graphics, from the real app bundle.
//
//   npm run store:shots            build the app bundle (npm run build:app), preview it, shoot
//   node scripts/make-store-shots.mjs --no-build     reuse the dist-app/ already built
//   BASE=http://localhost:4173 node scripts/make-store-shots.mjs   shoot a preview already running
//
// It serves dist-app/ with `vite preview --mode app` (the game at the root, no landing page and
// no service worker, the same bundle the shells load), drives headless Chrome over the DevTools
// protocol, seeds the committed demo tower (store/fixtures/demo-tower.json) into the game's
// IndexedDB save slot, and captures each store size at the device pixel ratio that makes the
// exact pixel size. The Steam and Play graphics are drawn from public/og.png and
// public/wordmark-dark.png on a canvas in the same browser. Output: store/shots/ (gitignored),
// plus store/shots/manifest.json with every file and its size.
//
// The size table below is the one store/ios.md, store/android.md and store/steam.md list;
// tests/store/shots.test.ts checks that the two agree. No npm packages: Node, Chrome, zlib.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync, inflateSync, crc32 } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CHROME_PATH = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const FIXTURE = join(ROOT, 'store', 'fixtures', 'demo-tower.json');
export const OUT_DIR = join(ROOT, 'store', 'shots');

/**
 * Screenshots: the pixel size each store takes, and the CSS viewport and device pixel ratio
 * that produce it. `css.w * dpr` and `css.h * dpr` must equal `width` and `height` exactly.
 */
export const SCREENSHOTS = [
  { id: 'ios-iphone-6.9', store: 'ios', label: 'iPhone 6.9 inch display', width: 1320, height: 2868, css: { w: 440, h: 956, dpr: 3 }, mobile: true },
  { id: 'ios-iphone-6.5', store: 'ios', label: 'iPhone 6.5 inch display', width: 1284, height: 2778, css: { w: 428, h: 926, dpr: 3 }, mobile: true },
  { id: 'ios-ipad-13', store: 'ios', label: 'iPad 13 inch display', width: 2064, height: 2752, css: { w: 1032, h: 1376, dpr: 2 }, mobile: true },
  { id: 'android-phone', store: 'android', label: 'Phone', width: 1080, height: 1920, css: { w: 432, h: 768, dpr: 2.5 }, mobile: true },
  { id: 'android-tablet', store: 'android', label: '7 and 10 inch tablet', width: 2560, height: 1440, css: { w: 1280, h: 720, dpr: 2 }, mobile: true },
  { id: 'steam-screenshot', store: 'steam', label: 'Screenshot', width: 1920, height: 1080, css: { w: 1440, h: 810, dpr: 4 / 3 }, mobile: false },
];

/** The views shot at every screenshot size, in order. Steam asks for five at least. */
export const SCENES = ['tower', 'wide', 'close', 'closer', 'build'];

/**
 * Store graphics drawn from a source image, fitted whole (contain) on the source's own corner
 * colour, or on transparency where `transparent` is set. `placeholder` marks a size the source
 * art does not really fit (a portrait capsule from a landscape card): usable to fill the form,
 * worth replacing with drawn art before launch.
 */
export const GRAPHICS = [
  { id: 'steam-header-capsule', store: 'steam', label: 'Header capsule', width: 920, height: 430, source: 'public/og.png' },
  { id: 'steam-small-capsule', store: 'steam', label: 'Small capsule', width: 462, height: 174, source: 'public/og.png' },
  { id: 'steam-main-capsule', store: 'steam', label: 'Main capsule', width: 1232, height: 706, source: 'public/og.png' },
  { id: 'steam-main-capsule-616', store: 'steam', label: 'Main capsule, the older 616 by 353 size', width: 616, height: 353, source: 'public/og.png' },
  { id: 'steam-vertical-capsule', store: 'steam', label: 'Vertical capsule', width: 748, height: 896, source: 'public/og.png', placeholder: true },
  { id: 'steam-library-capsule', store: 'steam', label: 'Library capsule', width: 600, height: 900, source: 'public/og.png', placeholder: true },
  { id: 'steam-library-logo', store: 'steam', label: 'Library logo', width: 1280, height: 720, source: 'public/wordmark-dark.png', transparent: true },
  { id: 'play-feature-graphic', store: 'android', label: 'Feature graphic', width: 1024, height: 500, source: 'public/og.png' },
  { id: 'play-icon', store: 'android', label: 'App icon', width: 512, height: 512, source: 'public/icons/icon-512.png', transparent: true },
];

/** Sizes a store asks for that this script does not make, with the reason. */
export const NOT_MADE = [
  { id: 'steam-library-hero', store: 'steam', width: 3840, height: 1240, reason: 'needs wide key art with no logo; public/og.png carries the wordmark and is 1200 by 630' },
  { id: 'steam-page-background', store: 'steam', width: 1438, height: 810, reason: 'optional; Steam builds a default from the screenshots' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ PNG

/** Width, height and colour type from a PNG's IHDR. */
export function pngInfo(buf) {
  if (buf.readUInt32BE(12) !== 0x49484452) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colorType: buf[25] };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * An 8 bit RGBA PNG re-encoded as RGB. Chrome's captures are RGBA with every pixel opaque;
 * the App Store and Play both want screenshots with no alpha channel.
 */
export function dropAlpha(buf) {
  const info = pngInfo(buf);
  if (info.colorType !== 6 || info.bitDepth !== 8) return buf;
  const idat = [];
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = info;
  const stride = width * 4;
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  const out = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? cur[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    const o = y * (width * 3 + 1);
    out[o] = 0;
    for (let x = 0; x < width; x++) {
      out[o + 1 + x * 3] = cur[x * 4];
      out[o + 2 + x * 3] = cur[x * 4 + 1];
      out[o + 3 + x * 3] = cur[x * 4 + 2];
    }
    cur.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour, no alpha
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ processes

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
  const child = spawn(vite, ['preview', '--mode', 'app', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  await waitForHttp(`${base}/`);
  return { base, stop: () => child.kill() };
}

/** Headless Chrome on a fresh profile, Metal first (the look round's flags), SwiftShader if WebGL fails. */
async function launchChrome(angle) {
  const port = await freePort();
  const profile = join(tmpdir(), `hs-store-shots-${port}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const gpu = angle === 'metal'
    ? ['--use-angle=metal', '--ignore-gpu-blocklist']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const proc = spawn(CHROME_PATH, ['--headless=new', ...gpu, '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
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
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error)));
      else res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
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
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      console.log(`left the Chrome profile at ${profile}`);
    }
  };
  return { send, evaluate, close, errors, angle };
}

// ------------------------------------------------------------------ the game

const PREFS = {
  'hs.intro.seen': 'true',
  'hs.guide.done': 'true',
  'hs.hintSeen': '3',
  'hs.palette.collapsed': 'true', // the tower fills the frame; the directory is one tap away
  'hs.goals.collapsed': 'true',
  'hs.tips': JSON.stringify(['longWait', 'tenantLeft', 'firstRent', 'firstEvent', 'nightSpeed', 'firstPanel']),
};

async function seed(browser, base) {
  const { send, evaluate } = browser;
  await send('Page.navigate', { url: `${base}/?new&cb=${Date.now()}` });
  await sleep(1500);
  const saveText = readFileSync(FIXTURE, 'utf8');
  await evaluate(`(() => { const p = ${JSON.stringify(PREFS)}; for (const k in p) localStorage.setItem(k, p[k]); return true; })()`);
  await evaluate(`new Promise((res, rej) => { const q = indexedDB.open('hundred-stories', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('saves');
    q.onsuccess = () => { const tx = q.result.transaction('saves', 'readwrite'); tx.objectStore('saves').put(${JSON.stringify(saveText)}, 'autosave');
      tx.oncomplete = () => { q.result.close(); res(true); }; tx.onerror = () => rej(tx.error); };
    q.onerror = () => rej(q.error); })`);
}

async function key(browser, code, k) {
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k.length === 1 ? k : undefined });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k });
}

/**
 * Drags the view down by a fraction of its height with the middle button, the pan a mouse player
 * uses. It rests before letting go so no inertia carries the camera on.
 */
async function panDown(browser, spec, fraction) {
  const x = Math.round(spec.css.w / 2);
  const y0 = Math.round(spec.css.h * 0.3);
  const y1 = y0 + Math.round(spec.css.h * fraction);
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: y0, button: 'middle', buttons: 4, clickCount: 1 });
  for (let i = 1; i <= 20; i++) {
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y0 + ((y1 - y0) * i) / 20, button: 'middle', buttons: 4 });
    await sleep(30);
  }
  await sleep(250);
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: y1, button: 'middle', buttons: 0, clickCount: 1 });
}

async function openGame(browser, base, spec) {
  const { send, evaluate } = browser;
  await send('Emulation.setDeviceMetricsOverride', { width: spec.css.w, height: spec.css.h, deviceScaleFactor: spec.css.dpr, mobile: spec.mobile });
  await send('Emulation.setTouchEmulationEnabled', spec.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  // The page is on the preview origin already; put the chrome back as every shot expects it
  // (the build scene opens the directory, and the game remembers that).
  await evaluate(`(() => { const p = ${JSON.stringify(PREFS)}; for (const k in p) localStorage.setItem(k, p[k]); return true; })()`);
  let mounted = false;
  for (let attempt = 0; attempt < 3 && !mounted; attempt++) {
    await send('Page.navigate', { url: `${base}/?cb=${Date.now()}` });
    for (let i = 0; i < 30 && !mounted; i++) {
      await sleep(500);
      mounted = await evaluate(`!!document.querySelector('#view canvas') && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Pause' || b.getAttribute('aria-label') === 'Pause')`).catch(() => false);
    }
  }
  if (!mounted) throw new Error(`the game did not mount at ${spec.id}: ${browser.errors.slice(-3).join(' | ')}`);
  await sleep(2500); // the fade in, and a few ticks so the people are out
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Pause' || b.getAttribute('aria-label') === 'Pause'); b && b.click(); return !!b; })()`);
  await sleep(600);
}

/** Moves the camera to each scene in turn; the camera starts at the game's opening view. */
async function toScene(browser, spec, scene) {
  if (scene === 'tower') return;
  // One key step is one wheel notch (zoom x0.77), and the camera snaps to the nearest stop
  // (0.175, 0.5, 1, 2, 3) when it rests, so a scene is a number of steps from the opening zoom 1.
  const steps = { wide: -2, close: 2, closer: 1 }[scene] ?? 0;
  for (let i = 0; i < Math.abs(steps); i++) {
    if (steps < 0) await key(browser, 'Minus', '-');
    else await key(browser, 'Equal', '=');
    await sleep(60);
  }
  await sleep(900);
  // Zooming out centers on the middle of the view, which lifts the street; a drag brings it back
  // down so the tower stands in the frame with sky above it, not over a screen of basement concrete.
  if (steps < 0) await panDown(browser, spec, 0.18);
  // The build directory opened, with its room tiles, at the opening zoom.
  if (scene === 'build') {
    await browser.evaluate(`(() => { const t = document.querySelector('.hs-palette-title'); const b = t && t.closest('button'); b && b.click(); return !!b; })()`);
  }
  await sleep(1400); // zoom snap and settle
}

async function capture(browser, spec) {
  const r = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const png = dropAlpha(Buffer.from(r.data, 'base64'));
  const info = pngInfo(png);
  if (info.width !== spec.width || info.height !== spec.height) {
    throw new Error(`${spec.id}: captured ${info.width} by ${info.height}, the store needs ${spec.width} by ${spec.height}`);
  }
  return png;
}

async function drawGraphic(browser, base, g) {
  const { evaluate, send } = browser;
  await send('Emulation.clearDeviceMetricsOverride');
  const url = `${base}/${g.source.replace(/^public\//, '')}`;
  const dataUrl = await evaluate(`(async () => {
    const img = await createImageBitmap(await (await fetch(${JSON.stringify(url)})).blob());
    const c = document.createElement('canvas'); c.width = ${g.width}; c.height = ${g.height};
    const x = c.getContext('2d');
    if (!${Boolean(g.transparent)}) {
      const probe = document.createElement('canvas'); probe.width = 1; probe.height = 1;
      const px = probe.getContext('2d'); px.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
      const [r, gg, b] = px.getImageData(0, 0, 1, 1).data;
      x.fillStyle = 'rgb(' + r + ',' + gg + ',' + b + ')'; x.fillRect(0, 0, c.width, c.height);
    }
    const s = Math.min(c.width / img.width, c.height / img.height);
    const w = Math.round(img.width * s), h = Math.round(img.height * s);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(img, Math.round((c.width - w) / 2), Math.round((c.height - h) / 2), w, h);
    return c.toDataURL('image/png');
  })()`);
  let png = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (!g.transparent) png = dropAlpha(png);
  const info = pngInfo(png);
  if (info.width !== g.width || info.height !== g.height) throw new Error(`${g.id}: drew ${info.width} by ${info.height}`);
  return png;
}

// ------------------------------------------------------------------ main

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!existsSync(CHROME_PATH)) {
    console.error(`Chrome not found at ${CHROME_PATH}; set CHROME to its path.`);
    process.exit(2);
  }
  for (const s of SCREENSHOTS) {
    if (Math.round(s.css.w * s.css.dpr) !== s.width || Math.round(s.css.h * s.css.dpr) !== s.height) throw new Error(`${s.id}: viewport and ratio do not make the size`);
  }
  let preview = null;
  let base = process.env.BASE;
  if (!base) {
    if (!args.has('--no-build')) {
      const b = spawnSync('npm', ['run', 'build:app'], { cwd: ROOT, stdio: 'inherit' });
      if (b.status !== 0) process.exit(b.status ?? 1);
    }
    if (!existsSync(join(ROOT, 'dist-app', 'index.html'))) throw new Error('dist-app/index.html is missing: run npm run build:app');
    preview = await startPreview();
    base = preview.base;
  }
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = { base, angle: '', files: [], notMade: NOT_MADE };
  let browser = await launchChrome(process.env.ANGLE ?? 'metal');
  try {
    await browser.send('Page.navigate', { url: `${base}/?cb=${Date.now()}` });
    await sleep(800);
    const gl = await browser.evaluate(`(() => { const c = document.createElement('canvas').getContext('webgl2'); if (!c) return 'none'; const e = c.getExtension('WEBGL_debug_renderer_info'); return c.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : c.RENDERER); })()`);
    if (gl === 'none' && browser.angle === 'metal') {
      console.log('Metal gave no WebGL in headless Chrome; falling back to SwiftShader (colours are right, frame timing is not).');
      await browser.close();
      browser = await launchChrome('swiftshader');
    }
    manifest.angle = browser.angle;
    await seed(browser, base);
    const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
    for (const spec of SCREENSHOTS) {
      if (only && !only.has(spec.id)) continue;
      await openGame(browser, base, spec);
      for (const [i, scene] of SCENES.entries()) {
        // Each scene starts from the opening view, so one scene's zoom never carries into the next.
        if (i > 0) await openGame(browser, base, spec);
        await toScene(browser, spec, scene);
        const png = await capture(browser, spec);
        const file = join(OUT_DIR, spec.store, `${spec.id}-${i + 1}-${scene}.png`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, png);
        manifest.files.push({ file: relative(ROOT, file), id: spec.id, width: spec.width, height: spec.height });
        console.log('wrote', relative(ROOT, file));
      }
    }
    for (const g of GRAPHICS) {
      if (only && !only.has(g.id)) continue;
      await browser.send('Page.navigate', { url: `${base}/robots.txt` });
      await sleep(300);
      const png = await drawGraphic(browser, base, g);
      const file = join(OUT_DIR, g.store, `${g.id}.png`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, png);
      manifest.files.push({ file: relative(ROOT, file), id: g.id, width: g.width, height: g.height, placeholder: Boolean(g.placeholder) });
      console.log('wrote', relative(ROOT, file), g.placeholder ? '(placeholder)' : '');
    }
    writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    for (const n of NOT_MADE) console.log(`not made: ${n.id} ${n.width} by ${n.height}, ${n.reason}`);
  } finally {
    try {
      await browser.close();
    } finally {
      if (preview) preview.stop();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
