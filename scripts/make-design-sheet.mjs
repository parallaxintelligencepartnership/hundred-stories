// The design pass contact sheet: the 17 fresh shots docs/reviews/2026-09-25-design-pass-brief.md
// section 3 lists, and no others.
//
//   node scripts/make-design-sheet.mjs              build both bundles, preview them, shoot
//   node scripts/make-design-sheet.mjs --no-build   reuse the dist-app/ and dist/ already built
//
// The machinery is scripts/make-store-shots.mjs: the app bundle (dist-app/) served with
// `vite preview --mode app` for the game, headless Chrome on a fresh profile over the DevTools
// protocol (SwiftShader, so colours are true), the committed demo tower seeded into IndexedDB,
// the game opened and paused, and a PNG capture. The site shots need the landing pages, which
// only the web bundle (dist/) carries, so a second preview serves that.
//
// Each game shot seeds a temporary copy of the fixture with the clock moved to the shot's hour;
// the committed fixture is never written. A state that does not show its DOM within 5 seconds
// is skipped, with one line in sheet/NOT-CAPTURED.md. Output: docs/reviews/design-pass-2026-09-25/sheet/
// (gitignored). Exits 0 whether or not every shot was taken.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHROME_PATH, FIXTURE, dropAlpha, pngInfo } from './make-store-shots.mjs';
import { TILE_PX, FLOOR_PX, SLAB_PX, SIM_H } from '../src/render/grid.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = join(ROOT, 'docs', 'reviews', 'design-pass-2026-09-25', 'sheet');
export const NOT_CAPTURED = join(OUT_DIR, 'NOT-CAPTURED.md');

export const VIEWPORTS = {
  desk: { w: 1440, h: 900, dpr: 2, mobile: false },
  phone: { w: 390, h: 844, dpr: 2, mobile: true },
};

/**
 * The fixed shot list, brief section 3. Game shots carry an hour and a state; site shots a page
 * and a theme. `ghost` writes two files, -ghost-ok and -ghost-refused, and counts as one shot.
 */
export const SHOTS = [
  { name: 'game-desk-z1-1300', viewport: 'desk', hour: 13, state: 'opening' },
  { name: 'game-desk-z1-2300', viewport: 'desk', hour: 23, state: 'opening' },
  { name: 'game-desk-z1-1300-dock', viewport: 'desk', hour: 13, state: 'dock' },
  { name: 'game-desk-z1-1300-person', viewport: 'desk', hour: 13, state: 'person' },
  { name: 'game-desk-z1-1300-room', viewport: 'desk', hour: 13, state: 'room' },
  { name: 'game-desk-z1-1300-settings', viewport: 'desk', hour: 13, state: 'settings' },
  { name: 'game-desk-z1-1300-views', viewport: 'desk', hour: 13, state: 'views' },
  { name: 'game-desk-z1-0900-fire', viewport: 'desk', hour: 9, state: 'fire' },
  { name: 'game-desk-z1-1300-ghost', viewport: 'desk', hour: 13, state: 'ghost' },
  { name: 'game-phone-z1-1300', viewport: 'phone', hour: 13, state: 'opening' },
  { name: 'game-phone-z1-1300-sheet', viewport: 'phone', hour: 13, state: 'sheet' },
  { name: 'game-phone-z1-1300-person', viewport: 'phone', hour: 13, state: 'person' },
  { name: 'site-home-desk-light', viewport: 'desk', page: '/', theme: 'light', state: 'site' },
  { name: 'site-home-desk-dark', viewport: 'desk', page: '/', theme: 'dark', state: 'site' },
  { name: 'site-home-phone-light', viewport: 'phone', page: '/', theme: 'light', state: 'site' },
  { name: 'site-guide-desk-light', viewport: 'desk', page: '/how-to-play/', theme: 'light', state: 'site' },
  { name: 'site-404-desk-light', viewport: 'desk', page: '/nothing-here', theme: 'light', state: 'site' },
];

const STATE_TIMEOUT_MS = 5000;
/** src/render/camera.ts DEFAULT_GROUND_LINE: the street sits this far down the free band. */
const DEFAULT_GROUND_LINE = 0.68;
/** src/ui/panels.ts panelShell title for the settings sheet; src/sim/rules.ts label for the room. */
const SETTINGS_TITLE = 'Settings';
const ROOM_KIND = 'restaurant';
const ROOM_TITLE = 'Restaurant';
/** The ghost: an office on floor 2 over the lobby's free end (placeable), then the sky past the lot's east edge (refused). */
const GHOST_OK = { floor: 2, x: 168 };
const GHOST_SKY = { floor: 6, x: 181 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ the fixture at an hour

/**
 * The fixture's save with the clock at the hour. The save's `minute` is the absolute game minute
 * (src/sim/save.ts, world.time.minute); the day is kept so the weather and every dated record in
 * the fixture stay as they are, and only the minute of the day moves to hour * 60.
 */
export function fixtureAtHour(saveText, hour) {
  const save = JSON.parse(saveText);
  save.minute = Math.floor(save.minute / 1440) * 1440 + hour * 60;
  return JSON.stringify(save);
}

/** The camera's opening x in world px: renderer.ts frameInitial centers on the rooms' mean x. */
export function openingCameraX(save) {
  let total = 0;
  for (const r of save.rooms) total += r.x + r.width / 2;
  const x = save.rooms.length === 0 ? 187 : total / save.rooms.length;
  return (Math.round(x) + 0.5) * TILE_PX;
}

/** World px of a floor's top edge (camera.ts floorTopY): floor 1 spans -FLOOR_PX to 0. */
function floorTopY(floor) {
  return -(floor > 0 ? floor : floor + 1) * FLOOR_PX + 0;
}

// ------------------------------------------------------------------ processes (copied from the store script)

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

/** `mode` 'app' serves dist-app/ (the game at the root), null serves dist/ (the site). */
async function startPreview(mode) {
  const port = await freePort();
  const vite = join(ROOT, 'node_modules', '.bin', 'vite');
  const args = ['preview', ...(mode ? ['--mode', mode] : []), '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  const child = spawn(vite, args, { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  await waitForHttp(`${base}/`);
  return { base, stop: () => child.kill() };
}

async function launchChrome(angle) {
  const port = await freePort();
  const profile = join(tmpdir(), `hs-design-sheet-${port}`);
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

// ------------------------------------------------------------------ the game (copied from the store script)

const PREFS = {
  'hs.intro.seen': 'true',
  'hs.guide.done': 'true',
  'hs.hintSeen': '3',
  'hs.palette.collapsed': 'true',
  'hs.goals.collapsed': 'true',
  'hs.tips': JSON.stringify(['longWait', 'tenantLeft', 'firstRent', 'firstEvent', 'nightSpeed', 'firstPanel']),
};

async function seed(browser, base, saveText) {
  const { send, evaluate } = browser;
  await send('Page.navigate', { url: `${base}/?new&cb=${Date.now()}` });
  await sleep(1500);
  await evaluate(`(() => { const p = ${JSON.stringify(PREFS)}; for (const k in p) localStorage.setItem(k, p[k]); return true; })()`);
  await evaluate(`new Promise((res, rej) => { const q = indexedDB.open('hundred-stories', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('saves');
    q.onsuccess = () => { const tx = q.result.transaction('saves', 'readwrite'); tx.objectStore('saves').put(${JSON.stringify(saveText)}, 'autosave');
      tx.oncomplete = () => { q.result.close(); res(true); }; tx.onerror = () => rej(tx.error); };
    q.onerror = () => rej(q.error); })`);
}

async function setViewport(browser, vp) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
  await browser.send('Emulation.setTouchEmulationEnabled', vp.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
}

async function openGame(browser, base, vp, name) {
  const { send, evaluate } = browser;
  await setViewport(browser, vp);
  await evaluate(`(() => { const p = ${JSON.stringify(PREFS)}; for (const k in p) localStorage.setItem(k, p[k]); return true; })()`);
  let mounted = false;
  for (let attempt = 0; attempt < 3 && !mounted; attempt++) {
    await send('Page.navigate', { url: `${base}/?cb=${Date.now()}` });
    for (let i = 0; i < 30 && !mounted; i++) {
      await sleep(500);
      mounted = await evaluate(`!!document.querySelector('#view canvas') && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Pause' || b.getAttribute('aria-label') === 'Pause')`).catch(() => false);
    }
  }
  if (!mounted) throw new Error(`the game did not mount at ${name}: ${browser.errors.slice(-3).join(' | ')}`);
  await sleep(2500); // the fade in, and a few ticks so the people are out
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Pause' || b.getAttribute('aria-label') === 'Pause'); b && b.click(); return !!b; })()`);
  await sleep(600);
}

async function capture(browser, vp) {
  const r = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const png = dropAlpha(Buffer.from(r.data, 'base64'));
  const info = pngInfo(png);
  if (info.width !== vp.w * vp.dpr || info.height !== vp.h * vp.dpr) throw new Error(`captured ${info.width} by ${info.height}, expected ${vp.w * vp.dpr} by ${vp.h * vp.dpr}`);
  return png;
}

// ------------------------------------------------------------------ states

/** Polls a page expression until it is truthy, for at most STATE_TIMEOUT_MS. */
async function waitFor(browser, expression) {
  const until = Date.now() + STATE_TIMEOUT_MS;
  while (Date.now() < until) {
    if (await browser.evaluate(expression).catch(() => false)) return true;
    await sleep(100);
  }
  return false;
}

/** A page expression that clicks the first visible button matching `test` (a JS predicate on b). */
function clickButton(test) {
  return `(() => { const b = [...document.querySelectorAll('button')].find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (${test}); }); if (b) b.click(); return !!b; })()`;
}

const BUILD_TEXT = `(b.textContent.trim() === 'Build' || [...b.querySelectorAll('span')].some((s) => s.textContent.trim() === 'Build')) && !b.classList.contains('hs-place-btn')`;
const OFFICE_TILE = `b.classList.contains('hs-tool') && (b.querySelector('.hs-tool-name')?.textContent ?? '').trim() === 'Office'`;

/** A visible .hs-panel whose title text passes `test` (a JS predicate on t). */
function panelShown(test) {
  return `[...document.querySelectorAll('.hs-panel')].some((p) => { const r = p.getBoundingClientRect(); const t = (p.querySelector('.hs-panel-title-text')?.textContent ?? '').trim(); return r.width > 0 && r.height > 0 && (${test}); })`;
}

const DOCK_OPEN = `(() => { const p = document.querySelector('.hs-palette'); return !!p && !p.classList.contains('is-collapsed') && [...p.querySelectorAll('.hs-tool')].some((t) => t.getBoundingClientRect().height > 0); })()`;
const SHEET_OPEN = `(() => { const p = document.querySelector('.hs-palette'); return !!p && (p.classList.contains('is-sheet-row') || p.classList.contains('is-sheet-full')); })()`;
const VIEWS_OPEN = `(() => { const m = document.querySelector('.hs-views-menu'); return !!m && m.getBoundingClientRect().height > 0; })()`;
const chipShown = (alert) => `(() => { const c = document.querySelector('.hs-place-chip'); return !!c && !c.classList.contains('is-hidden') && c.classList.contains('is-alert') === ${alert}; })()`;

/**
 * The CSS point of a world position at the opening view: camera x from the rooms' mean, the
 * street at DEFAULT_GROUND_LINE down the band under the top bar (ui.ts watchChrome, layout.ts
 * viewInsets: the band's top is the bar's bottom, nothing covers the bottom), zoom 1.
 */
async function screenPoint(browser, save, wx, wy) {
  const camX = openingCameraX(save);
  const geo = await browser.evaluate(`(() => { const c = document.querySelector('#view canvas').getBoundingClientRect();
    const t = document.querySelector('.hs-top').getBoundingClientRect(); const s = document.querySelector('.hs-ui').getBoundingClientRect();
    return { left: c.left, top: c.top, width: c.width, height: c.height, bar: t.bottom - s.top }; })()`);
  const ground = geo.bar + DEFAULT_GROUND_LINE * (geo.height - geo.bar);
  const x = geo.left + geo.width / 2 + (wx - camX);
  const y = geo.top + ground + wy;
  const inView = x >= geo.left && x < geo.left + geo.width && y >= geo.top + geo.bar && y < geo.top + geo.height;
  return { x: Math.round(x), y: Math.round(y), inView };
}

async function clickAt(browser, p) {
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
}

/** The room the room shot clicks, and the person the person shots click. */
function roomTarget(save) {
  const room = save.rooms.find((r) => r.kind === ROOM_KIND);
  if (!room) return null;
  return { what: `${ROOM_KIND} ${room.id} floor ${room.floor} x ${room.x}`, wx: (room.x + room.width / 2) * TILE_PX, wy: floorTopY(room.floor) + FLOOR_PX / 2 };
}

function personTarget(save) {
  const camTile = openingCameraX(save) / TILE_PX;
  // Standing in the lobby: on floor 1 and out in the building (waiting or walking, not riding or outside).
  const people = save.sims.filter((p) => p.pos && p.pos.floor === 1 && (p.state === 'waiting' || p.state === 'walking'));
  people.sort((a, b) => (a.state === 'waiting' ? 0 : 1) - (b.state === 'waiting' ? 0 : 1) || Math.abs(a.pos.x - camTile) - Math.abs(b.pos.x - camTile));
  const p = people[0];
  if (!p) return null;
  // A person stands on the slab: feet at y -SLAB_PX, SIM_H tall; aim at the middle of them.
  return { what: `${p.kind} ${p.id} (${p.state}) floor 1 x ${p.pos.x}`, wx: (p.pos.x + 0.5) * TILE_PX, wy: -SLAB_PX - SIM_H / 2 };
}

/** Runs one game shot. Returns { files: [name...], skipped: [{ name, why }] }. */
async function gameShot(browser, base, shot, fixtureText) {
  const vp = VIEWPORTS[shot.viewport];
  const out = { files: [], skipped: [] };
  const skip = (why, name = shot.name) => out.skipped.push({ name, why });
  if (shot.state === 'fire') {
    // Only a DEV hook on window (src/main.ts, src/game/game.ts) may raise a fire; there is none.
    skip('no DEV hook on window raises a fire (src/main.ts and src/game/game.ts expose no window.__ hook), so no mechanism in the spec reaches it');
    return out;
  }
  const saveText = fixtureAtHour(fixtureText, shot.hour);
  const save = JSON.parse(saveText);
  // The temp copy the spec asks for; the page is handed its text, the committed fixture is not touched.
  const tmp = join(tmpdir(), `hs-design-sheet-${shot.hour}.json`);
  writeFileSync(tmp, saveText);
  await seed(browser, base, readFileSync(tmp, 'utf8'));
  rmSync(tmp, { force: true });
  await openGame(browser, base, vp, shot.name);

  const shoot = async (name) => {
    writeFileSync(join(OUT_DIR, `${name}.png`), await capture(browser, vp));
    out.files.push(name);
  };

  switch (shot.state) {
    case 'opening':
      await shoot(shot.name);
      break;
    case 'dock':
    case 'sheet': {
      const clicked = await browser.evaluate(clickButton(BUILD_TEXT));
      const expect = shot.state === 'dock' ? DOCK_OPEN : SHEET_OPEN;
      if (!clicked) skip('no visible button whose text is Build');
      else if (!(await waitFor(browser, expect))) skip(shot.state === 'dock' ? 'Build clicked, the dock (.hs-palette without is-collapsed) did not open in 5 s' : 'Build clicked, the sheet (.hs-palette.is-sheet-row or is-sheet-full) did not open in 5 s');
      else { await sleep(400); await shoot(shot.name); }
      break;
    }
    case 'settings': {
      const clicked = await browser.evaluate(clickButton(`['Menu', 'Settings'].includes(b.getAttribute('aria-label') ?? '') || ['Menu', 'Settings'].includes(b.textContent.trim())`));
      if (!clicked) skip('no visible button named Menu or Settings');
      else if (!(await waitFor(browser, panelShown(`t === ${JSON.stringify(SETTINGS_TITLE)}`)))) skip('Menu clicked, no .hs-panel titled Settings in 5 s');
      else { await sleep(400); await shoot(shot.name); }
      break;
    }
    case 'views': {
      const clicked = await browser.evaluate(clickButton(`b.textContent.trim() === 'Views'`));
      if (!clicked) skip('no visible button whose text is Views');
      else if (!(await waitFor(browser, VIEWS_OPEN))) skip('Views clicked, .hs-views-menu did not show in 5 s');
      else { await sleep(300); await shoot(shot.name); }
      break;
    }
    case 'room':
    case 'person': {
      const target = shot.state === 'room' ? roomTarget(save) : personTarget(save);
      if (!target) { skip(`the fixture has no ${shot.state === 'room' ? ROOM_KIND : 'person standing on floor 1'}`); break; }
      const p = await screenPoint(browser, save, target.wx, target.wy);
      if (!p.inView) { skip(`${target.what} is at css (${p.x}, ${p.y}), outside the canvas band under the top bar at the opening view`); break; }
      await clickAt(browser, p);
      const expect = shot.state === 'room' ? panelShown(`t === ${JSON.stringify(ROOM_TITLE)}`) : panelShown(`t !== '' && t !== 'Nothing selected' && t !== ${JSON.stringify(ROOM_TITLE)} && t !== 'Lobby'`);
      if (!(await waitFor(browser, expect))) skip(`clicked ${target.what} at css (${p.x}, ${p.y}), no ${shot.state === 'room' ? '.hs-panel titled Restaurant' : 'person .hs-panel'} in 5 s`);
      else { await sleep(400); await shoot(shot.name); }
      break;
    }
    case 'ghost': {
      if (!(await browser.evaluate(clickButton(BUILD_TEXT)))) { skip('no visible button whose text is Build'); break; }
      if (!(await waitFor(browser, DOCK_OPEN))) { skip('Build clicked, the dock did not open in 5 s'); break; }
      if (!(await browser.evaluate(clickButton(OFFICE_TILE)))) { skip('the dock opens on its first tab (Structure); the Office tile sits under Shops and fun, hidden as is-other, and a tab click is not a mechanism the spec lists'); break; }
      await sleep(300);
      const ok = await screenPoint(browser, save, (GHOST_OK.x + 0.5) * TILE_PX, floorTopY(GHOST_OK.floor) + FLOOR_PX / 2);
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ok.x, y: ok.y, button: 'none', buttons: 0 });
      if (!ok.inView || !(await waitFor(browser, chipShown(false)))) skip(`office over floor ${GHOST_OK.floor} x ${GHOST_OK.x} at css (${ok.x}, ${ok.y}): no placeable .hs-place-chip in 5 s`, `${shot.name}-ok`);
      else { await sleep(300); await shoot(`${shot.name}-ok`); }
      const sky = await screenPoint(browser, save, (GHOST_SKY.x + 0.5) * TILE_PX, floorTopY(GHOST_SKY.floor) + FLOOR_PX / 2);
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sky.x, y: sky.y, button: 'none', buttons: 0 });
      if (!sky.inView || !(await waitFor(browser, chipShown(true)))) skip(`office over the sky, floor ${GHOST_SKY.floor} x ${GHOST_SKY.x} at css (${sky.x}, ${sky.y}): no refused .hs-place-chip.is-alert in 5 s`, `${shot.name}-refused`);
      else { await sleep(300); await shoot(`${shot.name}-refused`); }
      break;
    }
    default:
      skip(`unknown state ${shot.state}`);
  }
  return out;
}

async function siteShot(browser, base, shot) {
  const vp = VIEWPORTS[shot.viewport];
  const out = { files: [], skipped: [] };
  await setViewport(browser, vp);
  await browser.send('Page.navigate', { url: `${base}/robots.txt` });
  await sleep(300);
  await browser.evaluate(`(() => { localStorage.setItem('hs.theme', ${JSON.stringify(shot.theme)}); return true; })()`);
  await browser.send('Page.navigate', { url: `${base}${shot.page}` });
  await sleep(2500);
  if (shot.page === '/nothing-here') {
    const title = await browser.evaluate('document.title');
    if (title !== 'Not found') {
      out.skipped.push({ name: shot.name, why: `the preview served "${title}" at /nothing-here, not the 404 page (vite preview falls back to index.html)` });
      return out;
    }
  }
  writeFileSync(join(OUT_DIR, `${shot.name}.png`), await capture(browser, vp));
  out.files.push(shot.name);
  return out;
}

// ------------------------------------------------------------------ main

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!existsSync(CHROME_PATH)) {
    console.error(`Chrome not found at ${CHROME_PATH}; set CHROME to its path.`);
    process.exit(2);
  }
  if (!args.has('--no-build')) {
    for (const script of ['build:app', 'build']) {
      const b = spawnSync('npm', ['run', script], { cwd: ROOT, stdio: 'inherit' });
      if (b.status !== 0) process.exit(b.status ?? 1);
    }
  }
  for (const dir of ['dist-app', 'dist']) {
    if (!existsSync(join(ROOT, dir, 'index.html'))) throw new Error(`${dir}/index.html is missing`);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.png')) rmSync(join(OUT_DIR, f));
  writeFileSync(NOT_CAPTURED, '');
  const fixtureText = readFileSync(FIXTURE, 'utf8');

  const game = await startPreview('app');
  let site = null;
  let browser = null;
  try {
    site = await startPreview(null);
    browser = await launchChrome('swiftshader');
    for (const shot of SHOTS) {
      let result;
      try {
        result = shot.state === 'site' ? await siteShot(browser, site.base, shot) : await gameShot(browser, game.base, shot, fixtureText);
      } catch (err) {
        result = { files: [], skipped: [{ name: shot.name, why: `error: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}` }] };
      }
      for (const s of result.skipped) appendFileSync(NOT_CAPTURED, `${s.name} | ${s.why}\n`);
      if (result.files.length > 0) {
        const partial = result.skipped.length > 0 ? `; skipped ${result.skipped.map((s) => s.name).join(', ')}` : '';
        console.log(`captured ${shot.name}${result.files.length > 1 || partial ? ` (${result.files.join(', ')})` : ''}${partial}`);
      } else {
        console.log(`skipped ${shot.name} | ${result.skipped.map((s) => s.why).join('; ')}`);
      }
    }
    const pngs = readdirSync(OUT_DIR).filter((f) => f.endsWith('.png'));
    const bytes = pngs.reduce((n, f) => n + statSync(join(OUT_DIR, f)).size, 0);
    console.log(`${pngs.length} files, ${bytes} bytes in ${relative(ROOT, OUT_DIR)}`);
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      game.stop();
      if (site) site.stop();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
