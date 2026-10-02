// The readiness run's rendered verification: one run, a FIXED shot list (SHOTS below), each shot
// reached through the game's own controls on a saved tower, checked in the DOM, then captured.
//
//   npx vite-node@6.0.0 scripts/make-readiness-fixtures.ts     first: the saved towers the shots seed
//   node scripts/make-readiness-shots.mjs                       build, serve, check and capture every shot
//   node scripts/make-readiness-shots.mjs --checks-only         the same, no PNGs written
//   node scripts/make-readiness-shots.mjs --only a,b            only the named shots (a name not in SHOTS: exit 2)
//   node scripts/make-readiness-shots.mjs --out <dir>           output there (relative to the repo root)
//
// Output (default docs/reviews/readiness-2026-10-01/, gitignored): <shot>-<viewport>[-larger-text].png,
// report.json (every check with its numbers) and report.txt (one line per shot and viewport: OK,
// CHECK FAILED with the check, or NOT-CAPTURED with why). Exits 1 when any check failed, 2 on bad
// flags or missing Chrome, 0 otherwise (a NOT-CAPTURED line is not a failure).
//
// How (the conventions of scripts/make-design-sheet.mjs and the lane D probes): the web bundle is
// built with `vite build --outDir` into a fresh temp dir and served with `vite preview` on a free
// port, so nothing is shared with another run or another agent; headless Chrome on SwiftShader
// (WebGL needs it, MAP.md 2026-09-19) with a fresh profile, one Chrome per viewport, the viewport
// set with Emulation.setDeviceMetricsOverride (MAP.md: window sizes under ~500 px are clamped).
// For each shot the named fixture is written into the game's IndexedDB slot from /robots.txt (a
// page that boots no game), the game is opened on a cache-busting address and paused before its
// first tick by pressing its own Pause button the moment it mounts (so the tower is the fixture as
// saved), and the cash in the status bar must read the fixture's cash (a boot that stalled on the
// IndexedDB resume, MAP.md 2026-09-20, is loaded again, at most three times).
//
// The state is reached from page JavaScript with real events on the game's own DOM controls
// (pointer and mouse events then click, at the control's middle, after checking nothing covers it;
// keydown for keys). The tower itself is tapped with Input.dispatchMouseEvent at a point found by
// moving the pointer over the canvas and reading the game's own hover card, which names the room or
// elevator under it; the selection's rectangle on screen is measured the same way (the hover card
// changes at the tile edge, the same tile box the selection ring is drawn on; where a card opens
// beside its selection and the only such thing on screen lies in the band of the rows a card stays
// below, the view is first dragged down with real mouse input, as a player would). No DEV hook, no
// test-only global in the game. Every wait is on a condition with a generous timeout (the Mac is
// shared): the card in, its opacity 1 and no finite CSS animation or transition running in it,
// its rectangle the same on two reads; posters loaded on the clips pages.
//
// Checks on every shot: no console error and no page exception since the boot (the favicon 404
// Chrome asks /robots.txt for is not one); no horizontal page overflow; every visible button and
// text line inside its card's rectangle, none clipped and none overlapping another; nothing with
// the hidden attribute drawn; no text node with "News", "seed", " -- " or an em dash. Then the
// shot's own checks (SHOTS[].checks, the CHECKS table).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHROME_PATH, dropAlpha, pngInfo } from './make-store-shots.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = join(ROOT, 'docs', 'reviews', 'readiness-2026-10-01');
/** Where scripts/make-readiness-fixtures.ts writes the saved towers. */
export const FIXTURE_DIR = join(OUT_DIR, 'fixtures');

// ------------------------------------------------------------------ the fixed shot list

/** The four viewports; one Chrome each. */
export const VIEWPORTS = {
  desktop: { w: 1440, h: 900, dpr: 1, mobile: false },
  'tablet-landscape': { w: 1024, h: 768, dpr: 1, mobile: true },
  'tablet-portrait': { w: 768, h: 1024, dpr: 1, mobile: true },
  phone: { w: 390, h: 844, dpr: 2, mobile: true },
};

/**
 * The shots, in order. `fixture` is a file in FIXTURE_DIR; `state` is how the shot is reached
 * (STATES); `on` lists the viewports, with `large` (Settings, Larger text on) and `motion`
 * ('reduce': prefers-reduced-motion emulated; such a pass is checks only, no PNG). `checks` names
 * the shot's own checks (CHECKS), run after the common ones.
 */
export const SHOTS = [
  { name: 'menu-root', fixture: 'healthy', state: 'menu', on: [{ vp: 'desktop' }, { vp: 'phone' }, { vp: 'phone', large: true }], checks: ['menuOrder', 'menuCentered'] },
  { name: 'stories-incidents', fixture: 'incidents-rich', state: 'stories', on: [{ vp: 'desktop' }, { vp: 'phone' }, { vp: 'tablet-portrait' }], checks: ['incidentRows', 'spendEnabled', 'problemsSection', 'focusNotSpend'] },
  { name: 'stories-incidents-poor', fixture: 'incidents-poor', state: 'stories', on: [{ vp: 'phone' }], checks: ['incidentRows', 'spendDisabledCash', 'focusNotSpend'] },
  { name: 'stories-problems', fixture: 'problems', state: 'stories', on: [{ vp: 'desktop' }, { vp: 'phone' }], checks: ['problemRows', 'focusNotSpend'] },
  { name: 'stories-vip-result', fixture: 'vip-done-good', state: 'stories', on: [{ vp: 'desktop' }, { vp: 'phone' }], checks: ['vipResultSection'] },
  { name: 'stories-quiet', fixture: 'healthy', state: 'stories', on: [{ vp: 'desktop' }, { vp: 'phone' }], checks: ['quietNeeds', 'followHint', 'noSpendShown'] },
  { name: 'alert-fire-card', fixture: 'incidents-rich', state: 'fireCard', on: [{ vp: 'desktop' }, { vp: 'phone' }], checks: ['fireCard'] },
  { name: 'alert-chip', fixture: 'incidents-rich', state: 'fireChip', on: [{ vp: 'desktop' }, { vp: 'phone' }], checks: ['chipClear'] },
  { name: 'vip-booking-card', fixture: 'vip-booking-soon', state: 'vipBooked', on: [{ vp: 'desktop' }, { vp: 'phone' }], checks: ['vipCard'] },
  { name: 'vip-result-card', fixture: 'vip-poor-soon', state: 'vipResult', on: [{ vp: 'desktop' }, { vp: 'phone' }], checks: ['vipCard'] },
  { name: 'card-room', fixture: 'healthy', state: 'cardRoom', on: [{ vp: 'desktop' }, { vp: 'tablet-landscape' }, { vp: 'phone' }], checks: ['cardPlace'] },
  { name: 'card-elevator', fixture: 'healthy', state: 'cardElevator', on: [{ vp: 'desktop' }, { vp: 'tablet-landscape' }, { vp: 'phone' }], checks: ['cardPlace'] },
  { name: 'card-housekeeping', fixture: 'problems', state: 'cardHousekeeping', on: [{ vp: 'desktop' }], checks: ['cardPlace', 'housekeepingRows'] },
  { name: 'card-recycling', fixture: 'problems', state: 'cardRecycling', on: [{ vp: 'desktop' }], checks: ['cardPlace', 'recyclingRows'] },
  { name: 'clips-page', fixture: 'healthy', state: 'clips', on: [{ vp: 'desktop' }, { vp: 'phone' }], checks: ['clipsShown'] },
  { name: 'leave-card', fixture: 'healthy', state: 'leave', on: [{ vp: 'desktop' }, { vp: 'phone' }], checks: ['leaveCard'] },
  { name: 'exited-screen', fixture: 'healthy', state: 'exited', on: [{ vp: 'desktop' }, { vp: 'phone' }, { vp: 'phone', large: true }], checks: ['exitedFocus'] },
  { name: 'exited-clips', fixture: 'healthy', state: 'exitedClips', on: [{ vp: 'phone' }], checks: ['clipsShown'] },
  // The reduced motion passes: checks only, no PNG.
  { name: 'menu-root', fixture: 'healthy', state: 'menu', on: [{ vp: 'desktop', motion: 'reduce' }], checks: ['menuOrder', 'menuCentered', 'noMotion'] },
  { name: 'exited-screen', fixture: 'healthy', state: 'exited', on: [{ vp: 'desktop', motion: 'reduce' }], checks: ['exitedFocus', 'noMotion'] },
];

// ------------------------------------------------------------------ timeouts (all waits are on a condition)

const BUILD_TIMEOUT_MS = 300_000;
const MOUNT_TIMEOUT_MS = 90_000;
const SETTLE_TIMEOUT_MS = 30_000;
const STATE_TIMEOUT_MS = 30_000;
/** How long a live VIP card may take to come once the game runs at its top speed. */
const LIVE_CARD_TIMEOUT_MS = 60_000;
const POSTER_TIMEOUT_MS = 30_000;
const POLL_MS = 150;
/** The anchored card stands this close to its selection at most (card-anchor.ts CARD_ANCHOR_GAP is 12). */
const ANCHOR_MAX_GAP = 16;
/** A pause entry's icon and word, as a group, sits this close to the entry's middle. */
const CENTER_TOLERANCE = 3;
/** The game's cards that open beside a selection do so at this width and wider (card-anchor.ts). */
const ANCHOR_MIN_WIDTH = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ flags

export function parseArgs(argv) {
  const args = { only: null, out: OUT_DIR, checksOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--checks-only') args.checksOnly = true;
    else if (a === '--only' || a === '--out') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${a} needs a value`);
      if (a === '--out') args.out = resolve(ROOT, value);
      else {
        const names = value.split(',').map((n) => n.trim()).filter(Boolean);
        const known = new Set(SHOTS.map((s) => s.name));
        const unknown = names.filter((n) => !known.has(n));
        if (names.length === 0) throw new Error('--only needs at least one shot name');
        if (unknown.length > 0) throw new Error(`--only: not in SHOTS: ${unknown.join(', ')}`);
        args.only = names;
      }
    } else throw new Error(`unknown flag ${a}`);
  }
  return args;
}

/** Every shot and viewport as one run, its file name and its label in the report. */
export function expand(shots) {
  const runs = [];
  for (const shot of shots) {
    for (const v of shot.on) {
      const suffix = `${v.large ? '-larger-text' : ''}${v.motion === 'reduce' ? '-reduced-motion' : ''}`;
      runs.push({ shot, vp: v.vp, large: !!v.large, motion: v.motion ?? null, checksOnly: v.motion === 'reduce', id: `${shot.name}-${v.vp}${suffix}` });
    }
  }
  return runs;
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

async function waitForHttp(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`nothing answered at ${url} within ${ms / 1000} s`);
}

const VITE = join(ROOT, 'node_modules', '.bin', 'vite');

function build(outDir) {
  const b = spawnSync(VITE, ['build', '--outDir', outDir, '--emptyOutDir'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], timeout: BUILD_TIMEOUT_MS });
  if (b.status !== 0) throw new Error(`vite build --outDir ${outDir} failed (${b.status ?? b.signal})`);
}

async function startPreview(outDir) {
  const port = await freePort();
  const child = spawn(VITE, ['preview', '--outDir', outDir, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(`${base}/play/`, 60_000);
  } catch (e) {
    child.kill();
    throw e;
  }
  return {
    base,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      await Promise.race([exited, sleep(5000)]);
      try { child.kill('SIGKILL'); } catch { /* gone */ }
    },
  };
}

async function launchChrome(tmp) {
  const port = await freePort();
  const profile = join(tmp, `chrome-${port}`);
  mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME_PATH, ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--hide-scrollbars', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,1024',
    '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  const until = Date.now() + 60_000;
  while (Date.now() < until && !targets.some((t) => t.type === 'page')) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* not up yet */ }
    if (!targets.some((t) => t.type === 'page')) await sleep(250);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) {
    proc.kill('SIGKILL');
    throw new Error('Chrome did not open a page target within 60 s');
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let seq = 0;
  const pending = new Map();
  /** Console errors and page exceptions, cleared at the start of every shot. */
  const problems = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      problems.push(`exception: ${(d.exception?.description ?? d.text ?? '').split('\n')[0].slice(0, 240)}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) {
      problems.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 240)}`);
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      const e = m.params.entry;
      // The one known line: Chrome asks the robots.txt page for /favicon.ico, which is not there.
      if (/\/favicon\.ico$/.test(e.url ?? '')) return;
      // The site build carries the Cloudflare Web Analytics beacon (vite.config.ts cfBeacon); from a
      // local preview its report is refused by CORS. The zone's setting, not the game (MAP.md 2026-09-20, 2026-09-26).
      if (/cloudflareinsights\.com/.test(`${e.text} ${e.url ?? ''}`)) return;
      problems.push(`log: ${e.text.slice(0, 200)}${e.url ? ` (${e.url})` : ''}`);
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page: ${(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? '').split('\n')[0].slice(0, 300)}`);
    return r.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  const close = async () => {
    try { ws.close(); } catch { /* closed */ }
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise((r) => proc.once('exit', r));
      proc.kill('SIGTERM');
      await Promise.race([exited, sleep(5000)]);
      try { proc.kill('SIGKILL'); } catch { /* gone */ }
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { send, evaluate, close, problems };
}

// ------------------------------------------------------------------ in the page

/**
 * The page side, put in front of every expression (nothing is left on window). R: a rectangle;
 * vis: drawn (a box, not display none, not visibility hidden, opacity above 0 up the tree);
 * press: a real press on a control, at its middle, refused when something else is on top there.
 */
const LIB = String.raw`
const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
const rr = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
const vis = (e) => { if (!e || !e.isConnected) return false; const r = e.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false;
  for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false; }
  return true; };
const q = (s, root = document) => [...root.querySelectorAll(s)].find(vis) || null;
const qa = (s, root = document) => [...root.querySelectorAll(s)].filter(vis);
const opacityUp = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
const running = (e) => (e ? e.getAnimations({ subtree: true }) : document.getAnimations()).filter((a) => a.playState === 'running' && a.effect && a.effect.getTiming().iterations !== Infinity);
const press = (e) => {
  if (!e) return 'no control';
  if (e.disabled) return 'the control is disabled';
  const r = e.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  if (!top || (top !== e && !e.contains(top))) return 'covered at its middle by ' + (top ? top.tagName.toLowerCase() + '.' + String(top.className.baseVal ?? top.className).split(' ').join('.') : 'nothing');
  const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
  top.dispatchEvent(new PointerEvent('pointerover', o));
  top.dispatchEvent(new PointerEvent('pointermove', o));
  top.dispatchEvent(new PointerEvent('pointerdown', o));
  top.dispatchEvent(new MouseEvent('mousedown', o));
  top.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
  top.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
  top.dispatchEvent(new MouseEvent('click', { ...o, buttons: 0, detail: 1 }));
  return null;
};
const key = (k, code) => { const t = document.activeElement || document.body; const o = { key: k, code: code || k, bubbles: true, cancelable: true, composed: true };
  t.dispatchEvent(new KeyboardEvent('keydown', o)); t.dispatchEvent(new KeyboardEvent('keyup', o)); };
const desc = (e) => e ? (e.tagName.toLowerCase() + (e.dataset && (e.dataset.entry || e.dataset.exit || e.dataset.need) ? '[' + (e.dataset.entry || e.dataset.exit || e.dataset.need) + ']' : '') + ' "' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40) + '"') : 'nothing';
`;

const page = (body) => `(() => { ${LIB}\n${body}\n})()`;
const pageAsync = (body) => `(async () => { ${LIB}\n${body}\n})()`;

// ------------------------------------------------------------------ waiting

async function waitFor(b, expression, ms, what) {
  const until = Date.now() + ms;
  let last = null;
  while (Date.now() < until) {
    last = await b.evaluate(expression).catch((e) => ({ error: String(e.message ?? e) }));
    if (last === true || (last && last.ok === true)) return last;
    await sleep(POLL_MS);
  }
  const why = typeof last === 'object' && last !== null ? JSON.stringify(last).slice(0, 200) : String(last);
  throw new NotCaptured(`${what} did not happen within ${ms / 1000} s (last read: ${why})`);
}

class NotCaptured extends Error {}

/**
 * The element `selector` is in: drawn, opacity 1 all the way up, no finite CSS animation or
 * transition running in it, and its rectangle the same on two reads two frames apart.
 */
async function settle(b, selector, what = selector) {
  const until = Date.now() + SETTLE_TIMEOUT_MS;
  let last = '';
  let read = null;
  while (Date.now() < until) {
    read = await b.evaluate(pageAsync(`
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const e = q(${JSON.stringify(selector)});
      if (!e) return { in: false, why: 'not drawn' };
      const anims = running(e).length;
      const op = opacityUp(e);
      return { in: anims === 0 && op === 1, why: 'opacity ' + op + ', ' + anims + ' animations running', rect: rr(R(e)) };`)).catch((e) => ({ in: false, why: String(e.message ?? e) }));
    const key = JSON.stringify(read.rect ?? null);
    if (read.in && key === last) return;
    last = read.in ? key : '';
    await sleep(POLL_MS);
  }
  throw new NotCaptured(`${what} did not settle within ${SETTLE_TIMEOUT_MS / 1000} s (${read?.why ?? 'no read'})`);
}

/** Every poster the clips in `selector` ask for has arrived (the network said so). */
async function postersIn(b, selector) {
  await waitFor(b, page(`
    const root = q(${JSON.stringify(selector)}); if (!root) return { ok: false, why: 'no clips' };
    const want = [...root.querySelectorAll('video.hs-clip-video')].map((v) => new URL(v.getAttribute('poster'), location.href).href);
    if (want.length === 0) return { ok: false, why: 'no players' };
    const done = new Set(performance.getEntriesByType('resource').filter((e) => e.responseEnd > 0).map((e) => e.name));
    const missing = want.filter((u) => !done.has(u));
    return { ok: missing.length === 0, missing };`), POSTER_TIMEOUT_MS, 'every clip poster loading');
}

// ------------------------------------------------------------------ seeding and booting

const PREFS = {
  'hs.intro.seen': 'true',
  'hs.guide.done': 'true',
  'hs.hintSeen': '3',
  'hs.palette.collapsed': 'true',
  'hs.goals.collapsed': 'true',
  'hs.tips': JSON.stringify(['longWait', 'tenantLeft', 'firstRent', 'firstEvent', 'nightSpeed', 'firstPanel', 'meetPerson']),
};

/** The game's Pause button (ui.ts speed pill): its click is setSpeed(0). */
const PAUSE_SEL = 'button.hs-speed-btn[aria-label="Pause"]';

/**
 * Before any of the page's scripts on every new document: the moment the speed pill mounts, its
 * Pause is pressed. main.ts mounts the ui and starts the loop in one step and a tick only runs in
 * an animation frame, so the observer's callback (a microtask) lands before the first tick.
 */
const PAUSE_AT_MOUNT = `(() => {
  if (window.top !== window || location.pathname.indexOf('/play') !== 0) return;
  const mo = new MutationObserver(() => {
    const b = document.querySelector(${JSON.stringify(PAUSE_SEL)});
    if (!b) return;
    mo.disconnect();
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  });
  mo.observe(document, { childList: true, subtree: true });
})();`;

/** What the status bar's cash reads for an amount (src/ui/format.ts formatMoney). */
function cashText(dollars) {
  const whole = Math.round(dollars);
  return `${whole < 0 ? '-' : ''}$${String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

async function seed(b, base, saveText, large) {
  await b.send('Page.navigate', { url: `${base}/robots.txt?cb=${Date.now()}` });
  await waitFor(b, `document.readyState === 'complete' && location.pathname === '/robots.txt'`, 30_000, 'the robots.txt page loading');
  const prefs = { ...PREFS, ...(large ? { 'hs.largeText': 'true' } : {}) };
  await b.evaluate(`(() => { localStorage.clear(); sessionStorage.clear(); const p = ${JSON.stringify(prefs)}; for (const k in p) localStorage.setItem(k, p[k]); return true; })()`);
  await b.evaluate(`new Promise((res, rej) => { const q = indexedDB.open('hundred-stories', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('saves');
    q.onsuccess = () => { const tx = q.result.transaction('saves', 'readwrite'); const s = tx.objectStore('saves'); s.clear(); s.put(${JSON.stringify(saveText)}, 'autosave');
      tx.oncomplete = () => { q.result.close(); res(true); }; tx.onerror = () => rej(tx.error); };
    q.onerror = () => rej(q.error); })`);
}

/** Opens the seeded game, paused before its first tick; the bar's cash must read the fixture's. */
async function boot(b, base, save) {
  const want = cashText(save.cash);
  const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: PAUSE_AT_MOUNT });
  try {
    let read = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await b.send('Page.navigate', { url: `${base}/play/?cb=${Date.now()}` });
      const until = Date.now() + MOUNT_TIMEOUT_MS / 3;
      while (Date.now() < until) {
        read = await b.evaluate(page(`
          const c = document.querySelector('#view canvas'); const p = document.querySelector(${JSON.stringify(PAUSE_SEL)});
          const cash = (document.querySelector('.hs-status-cash .hs-readout-value')?.textContent ?? '').trim();
          return { mounted: !!c && !!p, paused: p ? p.getAttribute('aria-pressed') === 'true' : false, cash };`)).catch(() => null);
        if (read?.mounted && read.cash === want && read.paused) break;
        await sleep(300);
      }
      if (read?.mounted && read.cash === want && read.paused) break;
    }
    if (!read?.mounted) throw new NotCaptured(`the game did not mount in three loads (the IndexedDB resume stall, MAP.md 2026-09-20)`);
    if (read.cash !== want) throw new NotCaptured(`the fixture did not seed: the bar reads ${read.cash || 'nothing'}, the fixture ${want}`);
    if (!read.paused) throw new NotCaptured('the game did not pause at mount');
  } finally {
    await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
  }
  // The boot's own fade: nothing finite animating anywhere, the view drawn at full opacity.
  await waitFor(b, page(`const v = document.querySelector('#view'); return { ok: !!v && opacityUp(v) === 1 && running(null).length === 0 && document.fonts.status === 'loaded', anims: running(null).length };`), SETTLE_TIMEOUT_MS, 'the boot fade finishing');
}

// ------------------------------------------------------------------ actions

async function pressSel(b, selector, what = selector) {
  const why = await b.evaluate(page(`return press(q(${JSON.stringify(selector)}));`));
  if (why) throw new NotCaptured(`could not press ${what}: ${why}`);
}

async function openMenu(b) {
  await pressSel(b, 'button.hs-round[aria-label="Menu"]', 'Menu');
  await waitFor(b, page(`return !!q('.hs-pause-card');`), STATE_TIMEOUT_MS, 'the pause menu opening');
  await settle(b, '.hs-pause-card', 'the pause card');
}

async function openPage(b, entry) {
  await openMenu(b);
  await pressSel(b, `.hs-pause-item[data-entry="${entry}"]`, `the ${entry} entry`);
  await waitFor(b, page(`return !!q('.hs-pause-card[data-page="${entry}"]');`), STATE_TIMEOUT_MS, `the ${entry} page opening`);
  await settle(b, '.hs-pause-card', `the ${entry} page`);
}

/** Runs the game at its top speed with the speed pill's own Faster, until `selector` is drawn; then Pause. */
async function runUntil(b, selector, what) {
  await pressSel(b, 'button.hs-speed-btn[aria-label="Faster"]', 'Faster');
  try {
    await waitFor(b, page(`return !!q(${JSON.stringify(selector)});`), LIVE_CARD_TIMEOUT_MS, what);
  } finally {
    await b.evaluate(page(`return press(q(${JSON.stringify(PAUSE_SEL)}));`)).catch(() => {});
  }
}

/**
 * The tower under the pointer, read from the game's own hover card: synthetic pointer moves over
 * the canvas every `step` css px, the card's title at each point the canvas is on top. Returns the
 * components of same-title points (4-neighbours) as { title, cells, box } in css px.
 */
async function scanTower(b, step) {
  const read = await b.evaluate(page(`
    const c = document.querySelector('#view canvas'); const card = document.querySelector('.hs-hover-card');
    if (!c || !card) return null;
    const bx = c.getBoundingClientRect(); const titles = []; const at = new Map(); const hits = [];
    for (let y = Math.ceil(bx.top) + 2; y < bx.bottom - 2; y += ${step}) {
      for (let x = Math.ceil(bx.left) + 2; x < bx.right - 2; x += ${step}) {
        if (document.elementFromPoint(x, y) !== c) continue;
        c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true }));
        if (card.classList.contains('is-hidden')) continue;
        const t = card.querySelector('.hs-hover-title')?.textContent ?? '';
        if (!at.has(t)) { at.set(t, titles.length); titles.push(t); }
        hits.push(x, y, at.get(t));
      }
    }
    c.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1, pointerType: 'mouse', bubbles: false }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 1, clientY: 1, pointerId: 1, pointerType: 'mouse', bubbles: true }));
    return { titles, hits, left: Math.ceil(bx.left) + 2, top: Math.ceil(bx.top) + 2 };`));
  if (!read) throw new NotCaptured('no canvas or hover card to scan');
  const cell = new Map();
  for (let i = 0; i < read.hits.length; i += 3) cell.set(`${(read.hits[i] - read.left) / step},${(read.hits[i + 1] - read.top) / step}`, read.hits[i + 2]);
  const seen = new Set();
  const comps = [];
  for (const [k, t] of cell) {
    if (seen.has(k)) continue;
    const stack = [k];
    seen.add(k);
    const pts = [];
    while (stack.length) {
      const cur = stack.pop();
      const [i, j] = cur.split(',').map(Number);
      pts.push([read.left + i * step, read.top + j * step]);
      for (const n of [`${i + 1},${j}`, `${i - 1},${j}`, `${i},${j + 1}`, `${i},${j - 1}`]) {
        if (!seen.has(n) && cell.get(n) === t) { seen.add(n); stack.push(n); }
      }
    }
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    comps.push({ title: read.titles[t], cells: pts.length, box: { x: Math.min(...xs), y: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) } });
  }
  return comps;
}

/** The exact screen box of the tile run under (x, y) titled `title`: each edge found at 1 px. */
/**
 * The screen box of the thing titled `title` under (x, y), each edge found at 1 px by where the
 * hover card's title changes. Shafts are drawn over the rooms they pass (hover.ts hoverTargetAt),
 * so a room edge that meets a shaft may go on under it: that edge's `outer` bound is the far side
 * of the shaft. `cut` names the edges that met the chrome or the canvas edge instead.
 */
async function measureTarget(b, title, x, y) {
  return b.evaluate(page(`
    const c = document.querySelector('#view canvas'); const card = document.querySelector('.hs-hover-card');
    const at = (px, py) => { if (document.elementFromPoint(px, py) !== c) return null; c.dispatchEvent(new PointerEvent('pointermove', { clientX: px, clientY: py, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true }));
      return card.classList.contains('is-hidden') ? '' : (card.querySelector('.hs-hover-title')?.textContent ?? ''); };
    const t = ${JSON.stringify(title)}; const x = ${x}, y = ${y};
    const shaft = (s) => typeof s === 'string' && /levator$/.test(s) && !/levator$/.test(t);
    const edge = (dx, dy) => { let px = x, py = y;
      for (let i = 0; i < 3000; i++) { const nx = px + dx, ny = py + dy; const got = at(nx, ny); if (got === t) { px = nx; py = ny; continue; }
        // Over a shaft: how far it goes, the most the room can run on under it.
        let ox = px, oy = py;
        if (shaft(got)) { let sx = nx, sy = ny; while (at(sx + dx, sy + dy) === got) { sx += dx; sy += dy; } ox = sx; oy = sy; }
        return { x: px, y: py, ox, oy, next: got }; }
      return { x: px, y: py, ox: px, oy: py, next: null }; };
    if (at(x, y) !== t) return { error: 'the hover card does not read ' + t + ' at its middle' };
    const L = edge(-1, 0), Rr = edge(1, 0), T = edge(0, -1), B = edge(0, 1);
    c.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1, pointerType: 'mouse', bubbles: false }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 1, clientY: 1, pointerId: 1, pointerType: 'mouse', bubbles: true }));
    const cut = [['left', L], ['right', Rr], ['top', T], ['bottom', B]].filter(([, v]) => v.next === null).map(([k]) => k);
    return { x: L.x, y: T.y, w: Rr.x - L.x + 1, h: B.y - T.y + 1, outer: { x: L.ox, y: T.oy, r: Rr.ox + 1, b: B.oy + 1 }, cut };`));
}

/** A tap on the tower: real mouse input at a css point (Input.dispatchMouseEvent). */
async function tapTower(b, x, y) {
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

/**
 * The rooms the room shot may pick: one of a kind on its stretch of floor in the fixture, so the
 * hover card's region is that room alone (the housekeeping and recycling cards have shots of their own).
 */
const ROOM_TITLES = ['Fast food', 'Restaurant', 'Suite', 'Security office'];

/**
 * Tap the room (or elevator) titled one of `titles` nearest the middle of the free view, wait for
 * its card, and measure the selection's box on screen. Returns { title, selection, tapped }.
 */
/**
 * The things titled one of `titles` on screen, measured, best first: the one nearest the middle of
 * the view, among those wholly below the rows a card stays below (the bar, the round buttons, the
 * view chip and the first-run hint while up: ui.ts measureCardBox); beside a thing in that band a
 * card can only stand diagonally off it. Things whose edge meets the chrome are left out.
 */
async function findTargets(b, titles, vp) {
  const all = await scanTower(b, vp.w < 600 ? 5 : 8);
  const comps = all.filter((c) => titles.includes(c.title) && c.cells >= 3);
  const mid = { x: vp.w / 2, y: vp.h / 2 };
  const centre = (c) => ({ x: Math.round((c.box.x + c.box.r) / 2), y: Math.round((c.box.y + c.box.b) / 2) });
  const row = await b.evaluate(page(`return Math.max(0, ...qa('.hs-top, button.hs-round, .hs-save-btn, .hs-sound-btn, .hs-watch-btn, .hs-hint:not(.is-hidden), .hs-view-chip:not(.is-hidden)').map((e) => R(e).b)) + 12;`));
  comps.sort((a, c) => Math.hypot(centre(a).x - mid.x, centre(a).y - mid.y) - Math.hypot(centre(c).x - mid.x, centre(c).y - mid.y));
  const found = [];
  const errors = [];
  for (const comp of comps.slice(0, 8)) {
    const at = centre(comp);
    const sel = await measureTarget(b, comp.title, at.x, at.y);
    if (sel.error) { errors.push(sel.error); continue; }
    if (sel.cut.length > 0) { errors.push(`the ${comp.title}'s ${sel.cut.join(' and ')} edge meets the chrome or the canvas edge`); continue; }
    // Reaching below the rows, so a card can stand level with some of it.
    found.push({ comp, sel, belowRow: sel.y + sel.h > row + 8 });
  }
  found.sort((a, c) => (a.belowRow ? 0 : 1) - (c.belowRow ? 0 : 1));
  return { all, found, errors, seen: comps.map((c) => `${c.title} ${JSON.stringify(c.box)}`), row };
}

/** A drag on the tower with nothing in hand pans the view (src/render/input.ts): real mouse input. */
async function dragView(b, vp, dx, dy) {
  const x0 = Math.round(vp.w / 2);
  const y0 = Math.round(vp.h * 0.6);
  const free = await b.evaluate(`document.elementFromPoint(${x0}, ${y0}) === document.querySelector('#view canvas')`);
  if (!free) return false;
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, button: 'none', buttons: 0 });
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 12; i++) {
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + Math.round((dx * i) / 12), y: y0 + Math.round((dy * i) / 12), button: 'left', buttons: 1 });
    await b.evaluate('new Promise((r) => requestAnimationFrame(() => r(true)))');
  }
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + dx, y: y0 + dy, button: 'left', buttons: 0, clickCount: 1 });
  // Held still (a fling may carry on after the release): the largest thing in view measured to the
  // pixel reads the same three times running, a few frames apart.
  const comps = (await scanTower(b, 16)).filter((c) => c.cells >= 6).sort((a, c) => c.cells - a.cells);
  const ref = comps[0];
  if (!ref) return true;
  const p = { x: Math.round((ref.box.x + ref.box.r) / 2), y: Math.round((ref.box.y + ref.box.b) / 2) };
  let last = '';
  let same = 0;
  const until = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < until && same < 2) {
    await b.evaluate('new Promise((r) => { let n = 6; const f = () => (--n > 0 ? requestAnimationFrame(f) : r(true)); requestAnimationFrame(f); })');
    const box = await measureTarget(b, ref.title, p.x, p.y);
    const now = JSON.stringify(box);
    same = now === last ? same + 1 : 0;
    last = now;
  }
  return true;
}

async function openTowerCard(b, titles, wantTitle) {
  const vp = await b.evaluate('({ w: innerWidth, h: innerHeight })');
  let pick = await findTargets(b, titles, vp);
  let panned = false;
  // Where cards open beside their selection, a thing that only lies in the band of the rows the
  // card stays below is brought down out of it first, with a drag, as a player would.
  const top = pick.found[0];
  if (vp.w >= ANCHOR_MIN_WIDTH && top && !top.belowRow) {
    const dy = Math.round(pick.row + 48 - top.sel.y);
    if (dy > 0 && (await dragView(b, vp, 0, dy))) {
      const again = await findTargets(b, titles, vp);
      if (again.found.length > 0) { pick = again; panned = dy; }
    }
  }
  if (pick.found.length === 0) throw new NotCaptured(`no ${titles.join(' or ')} could be measured on screen: ${pick.errors.join('; ') || 'none named by the hover card'}`);
  const all = pick.all;
  const seen = pick.seen;
  const centre = (c) => ({ x: Math.round((c.box.x + c.box.r) / 2), y: Math.round((c.box.y + c.box.b) / 2) });
  for (const { comp, sel } of pick.found.slice(0, 1)) {
    // A mouse over the selection gets no preview once its card is open (hover.ts), so whether the
    // view moved is read from other things on the tower: measured now, and again with the card open.
    const refs = [];
    for (const other of all.filter((c) => c !== comp && c.cells >= 6).sort((a, c) => c.cells - a.cells).slice(0, 8)) {
      const p = centre(other);
      const box = await measureTarget(b, other.title, p.x, p.y);
      if (!box.error) refs.push({ title: other.title, p, box });
      if (refs.length >= 4) break;
    }
    const tx = Math.round(sel.x + sel.w / 2);
    const ty = Math.round(sel.y + sel.h / 2);
    await tapTower(b, tx, ty);
    await waitFor(b, page(`const s = q('.hs-sheet'); return { ok: !!s, title: s?.querySelector('.hs-panel-title-text')?.textContent ?? null };`), STATE_TIMEOUT_MS, `a card opening for the ${comp.title}`);
    // The pointer off the tower, so the hover card goes.
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: Math.round(vp.h / 2), button: 'none', buttons: 0 });
    await settle(b, '.hs-sheet', `the ${comp.title} card`);
    const shown = await b.evaluate(page(`return q('.hs-sheet')?.querySelector('.hs-panel-title-text')?.textContent?.trim() ?? '';`));
    if (!(wantTitle ?? comp.title).split('|').some((t) => shown === t || shown.startsWith(t))) throw new NotCaptured(`tapped the ${comp.title} at (${tx}, ${ty}), the card opened is "${shown}"`);
    let shift = null;
    const open = await b.evaluate(page(`const s = q('.hs-sheet'); return s ? rr(R(s)) : null;`));
    const clear = (bx) => !open || bx.x + bx.w < open.x - 2 || bx.x > open.x + open.w + 2 || bx.y + bx.h < open.y - 2 || bx.y > open.y + open.h + 2;
    for (const ref of refs.filter((r) => clear(r.box))) {
      const now = await measureTarget(b, ref.title, ref.p.x, ref.p.y);
      if (now.error) continue;
      shift = { dx: now.x - ref.box.x, dy: now.y - ref.box.y, by: ref.title };
      if (Math.abs(now.w - ref.box.w) > 1 || Math.abs(now.h - ref.box.h) > 1) shift.zoomed = true;
      break;
    }
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: Math.round(vp.h / 2), button: 'none', buttons: 0 });
    await waitFor(b, page(`const h = document.querySelector('.hs-hover-card'); return !h || h.classList.contains('is-hidden') || !vis(h);`), STATE_TIMEOUT_MS, 'the hover card going');
    const move = (o) => ({ x: o.x + shift.dx, y: o.y + shift.dy, r: o.r + shift.dx, b: o.b + shift.dy });
    const selection = !shift || shift.zoomed ? null : { x: sel.x + shift.dx, y: sel.y + shift.dy, w: sel.w, h: sel.h, outer: move(sel.outer) };
    return { title: comp.title, selection, before: sel, tapped: { x: tx, y: ty }, viewShift: shift ?? 'no reference left in sight to tell', candidates: seen, panned };
  }
  throw new NotCaptured(`no ${titles.join(' or ')} could be measured`);
}

// ------------------------------------------------------------------ states

/**
 * How each state is reached. Each returns what the shot's checks need: `card`, the selector of
 * the card the common checks look inside, and anything else measured on the way.
 */
const STATES = {
  async menu(b) {
    await openMenu(b);
    return { card: '.hs-pause-card', focus: await b.evaluate(page('return desc(document.activeElement);')) };
  },
  async stories(b) {
    await openPage(b, 'stories');
    return { card: '.hs-pause-card', focus: await focusInfo(b) };
  },
  async fireCard(b) {
    await waitFor(b, page(`return !!q('.hs-toast.is-fire');`), STATE_TIMEOUT_MS, 'the fire card showing');
    await settle(b, '.hs-toast.is-fire', 'the fire card');
    return { card: '.hs-toast.is-fire' };
  },
  async fireChip(b) {
    await waitFor(b, page(`return !!q('.hs-toast.is-fire .hs-toast-close');`), STATE_TIMEOUT_MS, 'the fire card showing');
    await settle(b, '.hs-toast.is-fire', 'the fire card');
    await pressSel(b, '.hs-toast.is-fire .hs-toast-close', 'the fire card\'s close');
    await waitFor(b, page(`return !!q('.hs-toast-chip[data-incident="fire"]');`), STATE_TIMEOUT_MS, 'the fire reminder chip showing');
    await settle(b, '.hs-toast-chip[data-incident="fire"]', 'the fire chip');
    return { card: '.hs-toast-chip[data-incident="fire"]' };
  },
  async vipBooked(b) {
    if (!(await b.evaluate(page(`return !!q('.hs-toast.is-vip-booked');`)))) await runUntil(b, '.hs-toast.is-vip-booked', 'the VIP booking card at the top speed');
    await settle(b, '.hs-toast.is-vip-booked', 'the VIP booking card');
    return { card: '.hs-toast.is-vip-booked' };
  },
  async vipResult(b) {
    if (!(await b.evaluate(page(`return !!q('.hs-toast.is-vip-result');`)))) await runUntil(b, '.hs-toast.is-vip-result', 'the VIP result card at the top speed');
    await settle(b, '.hs-toast.is-vip-result', 'the VIP result card');
    return { card: '.hs-toast.is-vip-result' };
  },
  async cardRoom(b) {
    return { card: '.hs-sheet', target: await openTowerCard(b, ROOM_TITLES) };
  },
  async cardElevator(b) {
    return { card: '.hs-sheet', target: await openTowerCard(b, ['Elevator']) };
  },
  async cardHousekeeping(b) {
    return { card: '.hs-sheet', target: await openTowerCard(b, ['Housekeeping']) };
  },
  async cardRecycling(b) {
    return { card: '.hs-sheet', target: await openTowerCard(b, ['Recycling center']) };
  },
  async clips(b) {
    await openPage(b, 'clips');
    await postersIn(b, '.hs-pause-card');
    await settle(b, '.hs-pause-card', 'the Clips page');
    return { card: '.hs-pause-card', clips: '.hs-pause-card' };
  },
  async leave(b) {
    // Every save from here on fails, the way a full disk fails it: an IndexedDB write is taken and
    // its transaction aborted (the request errors and the transaction aborts, as a quota failure
    // does, never a throw from put itself), and localStorage.setItem throws QuotaExceededError.
    await b.evaluate(`(() => {
      const put = IDBObjectStore.prototype.put, add = IDBObjectStore.prototype.add;
      // Aborted once the write has been taken (from its success event, where the transaction is
      // still active), so every put the game queues in it is accepted and the whole write fails.
      const fail = (orig) => function (...args) { const tx = this.transaction; const req = orig.apply(this, args); req.addEventListener('success', () => { try { tx.abort(); } catch {} }); return req; };
      IDBObjectStore.prototype.put = fail(put); IDBObjectStore.prototype.add = fail(add);
      Storage.prototype.setItem = function () { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
      return true; })()`);
    // The tower moves, so leaving it has something to save: Play until the clock moves.
    const before = await b.evaluate(`(document.querySelector('.hs-status-clock .hs-readout-value')?.textContent ?? '').trim()`);
    await pressSel(b, 'button.hs-speed-btn[aria-label="Play"]', 'Play');
    await waitFor(b, `(document.querySelector('.hs-status-clock .hs-readout-value')?.textContent ?? '').trim() !== ${JSON.stringify(before)}`, STATE_TIMEOUT_MS, 'the clock moving at normal speed');
    await openMenu(b);
    await pressSel(b, '.hs-pause-item[data-entry="exit"]', 'Save and exit');
    await waitFor(b, page(`return !!q('.hs-pause-card .hs-leave');`), STATE_TIMEOUT_MS, 'the leave card showing');
    await settle(b, '.hs-pause-card', 'the leave card');
    return { card: '.hs-pause-card', focus: await focusInfo(b) };
  },
  async exited(b) {
    await openMenu(b);
    await pressSel(b, '.hs-pause-item[data-entry="exit"]', 'Save and exit');
    await waitFor(b, page(`return !!q('.hs-exit .hs-exit-card');`), STATE_TIMEOUT_MS, 'the exited screen showing');
    const motion = await motionNow(b);
    await settle(b, '.hs-exit', 'the exited screen');
    return { card: '.hs-exit-card', focus: await focusInfo(b), motion };
  },
  async exitedClips(b) {
    const got = await STATES.exited(b);
    await pressSel(b, '.hs-exit [data-exit="clips"]', 'the exited screen\'s Clips');
    await waitFor(b, page(`return !!q('.hs-exit[data-view="clips"] .hs-clips');`), STATE_TIMEOUT_MS, 'the clips on the exited screen');
    await postersIn(b, '.hs-exit');
    await settle(b, '.hs-exit-card', 'the exited screen\'s clips');
    return { ...got, card: '.hs-exit-card', clips: '.hs-exit' };
  },
};

async function focusInfo(b) {
  return b.evaluate(page(`const a = document.activeElement; return { desc: desc(a), spend: a?.dataset?.spend === 'true', exit: a?.dataset?.exit ?? null, cls: a ? String(a.className) : null, text: (a?.textContent ?? '').trim().slice(0, 60) };`));
}

/** CSS animations and transitions running anywhere right now, after two frames. */
async function motionNow(b) {
  return b.evaluate(pageAsync(`await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.getAnimations().filter((a) => a.playState === 'running' && (a instanceof CSSAnimation || a instanceof CSSTransition))
      .map((a) => (a.animationName || a.transitionProperty) + ' on ' + desc(a.effect?.target));`));
}

// ------------------------------------------------------------------ checks

/** The checks every shot runs, in the page. `card` is the selector of the shot's card. */
function commonChecks(card) {
  return page(`
    const out = {};
    // No horizontal page overflow.
    const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    out.noOverflow = sw <= innerWidth + 1 ? null : 'the page is ' + sw + ' px wide in a ' + innerWidth + ' px viewport';
    // Nothing with the hidden attribute drawn.
    const shownHidden = [...document.querySelectorAll('[hidden]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    out.hiddenNotDrawn = shownHidden.length === 0 ? null : shownHidden.slice(0, 4).map((e) => desc(e) + ' ' + JSON.stringify(rr(R(e)))).join('; ');
    // No forbidden words in any text node.
    const bad = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const p = n.parentElement; if (!p || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(p.tagName)) continue;
      const t = n.textContent;
      for (const [re, word] of [[/\\bNews\\b/, 'News'], [/\\bseeds?\\b/i, 'seed'], [/ -- /, '" -- "'], [/\\u2014/, 'an em dash']]) if (re.test(t)) bad.push(word + ' in "' + t.trim().slice(0, 60) + '"');
    }
    out.words = bad.length === 0 ? null : bad.slice(0, 4).join('; ');
    // Inside the card: every drawn control and text line in its rectangle, unclipped, not overlapping.
    const root = q(${JSON.stringify(card)});
    if (!root) { out.layout = 'the card ' + ${JSON.stringify(card)} + ' is not drawn'; return out; }
    const box = R(root);
    const scrollerOf = (e) => { for (let n = e.parentElement; n && n !== root.parentElement; n = n.parentElement) { const s = getComputedStyle(n); if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) return n; } return null; };
    const ownText = (e) => [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim() !== '');
    // A text line's boxes: one per line the text wraps onto (a union would swallow the words that
    // follow it on its last line).
    const textBoxes = (e) => { const rg = document.createRange(); const out = [];
      for (const c of e.childNodes) { if (c.nodeType !== 3 || c.textContent.trim() === '') continue; rg.selectNodeContents(c); for (const r of rg.getClientRects()) { if (r.width === 0 || r.height === 0) continue; out.push({ x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }); } }
      return out; };
    const controls = qa('button, a[href], [role="button"], video, input, select', root);
    const lines = [...root.querySelectorAll('*')].filter((e) => !['BUTTON', 'A', 'VIDEO', 'svg'].includes(e.tagName) && !e.closest('button, a[href], [role="button"]') && ownText(e) && vis(e));
    const items = [...controls.map((e) => ({ e, rs: [R(e)], kind: 'control' })), ...lines.map((e) => ({ e, rs: textBoxes(e), kind: 'line' })).filter((i) => i.rs.length > 0)];
    const outside = [], clipped = [], overlaps = [];
    const tol = 1;
    for (const it0 of items) for (const r of it0.rs) {
      const it = { e: it0.e, r };
      const sc = scrollerOf(it.e);
      const sb = sc ? R(sc) : null;
      // In a scrolling body a line past the fold is not clipped, only out of view: check it only in x.
      const inY = sb ? !(it.r.b <= sb.y || it.r.y >= sb.b) : true;
      if (it.r.x < box.x - tol || it.r.r > box.r + tol || (!sb && (it.r.y < box.y - tol || it.r.b > box.b + tol))) outside.push(desc(it.e) + ' ' + JSON.stringify(rr(it.r)) + ' outside the card ' + JSON.stringify(rr(box)));
      if (sb && inY && (it.r.x < sb.x - tol || it.r.r > sb.r + tol)) outside.push(desc(it.e) + ' ' + JSON.stringify(rr(it.r)) + ' outside its scroller ' + JSON.stringify(rr(sb)));
      const s = getComputedStyle(it.e);
      if (r === it0.rs[0] && it.e.scrollWidth > it.e.clientWidth + 1 && it.e.clientWidth > 0 && (s.overflowX !== 'visible' || s.textOverflow === 'ellipsis')) clipped.push(desc(it.e) + ' (' + it.e.scrollWidth + ' px of text in ' + it.e.clientWidth + ' px)');
    }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], c = items[j];
      if (a.e.contains(c.e) || c.e.contains(a.e)) continue;
      let hit = null;
      for (const ra of a.rs) for (const rc of c.rs) {
        const w = Math.min(ra.r, rc.r) - Math.max(ra.x, rc.x), h = Math.min(ra.b, rc.b) - Math.max(ra.y, rc.y);
        if (!hit && w > 1 && h > 1) hit = [ra, rc];
      }
      if (hit) overlaps.push(desc(a.e) + ' ' + JSON.stringify(rr(hit[0])) + ' overlaps ' + desc(c.e) + ' ' + JSON.stringify(rr(hit[1])));
    }
    out.insideCard = outside.length === 0 ? null : outside.slice(0, 4).join('; ') + (outside.length > 4 ? ' and ' + (outside.length - 4) + ' more' : '');
    out.notClipped = clipped.length === 0 ? null : clipped.slice(0, 4).join('; ');
    out.noOverlap = overlaps.length === 0 ? null : overlaps.slice(0, 4).join('; ') + (overlaps.length > 4 ? ' and ' + (overlaps.length - 4) + ' more' : '');
    out.items = items.length;
    return out;`);
}

/**
 * The shots' own checks. Each takes (b, got, run) and returns null when it holds, else the words
 * of what failed (with the rectangle or text).
 */
const CHECKS = {
  async menuOrder(b) {
    const ids = await b.evaluate(page(`return qa('.hs-pause-card .hs-pause-item').map((e) => e.dataset.entry);`));
    const s = ids.indexOf('stories');
    if (s < 0 || ids[s + 1] !== 'clips') return `Clips is not right after Stories: ${ids.join(', ')}`;
    if (ids[ids.length - 1] !== 'exit') return `Save and exit is not last: ${ids.join(', ')}`;
    return null;
  },
  async menuCentered(b, got) {
    // The group is the icon and the word's box as laid out. Save's word box keeps the width of
    // "Saved" on purpose (ui.css: its icon stays put between Save and Saved), so its letters alone
    // sit half a "d" left of the middle; that offset is recorded as textOff, not judged.
    const off = await b.evaluate(page(`return qa('.hs-pause-card .hs-pause-item').map((it) => {
      const btn = R(it); const ic = R(it.querySelector('.hs-face-icon')); const word = it.querySelector('.hs-face-word'); const w = R(word);
      const rg = document.createRange(); rg.selectNodeContents(word); const t = rg.getBoundingClientRect();
      const mid = btn.x + btn.w / 2; const r1 = (v) => Math.round(v * 10) / 10;
      return { entry: it.dataset.entry, off: r1((Math.min(ic.x, w.x) + Math.max(ic.r, w.r)) / 2 - mid), textOff: r1((Math.min(ic.x, t.left) + Math.max(ic.r, t.right)) / 2 - mid) };
    });`));
    got.centering = off;
    const bad = off.filter((o) => Math.abs(o.off) > CENTER_TOLERANCE);
    return bad.length === 0 ? null : bad.map((o) => `${o.entry} ${o.off} px off center`).join('; ');
  },
  async incidentRows(b) {
    const rows = await b.evaluate(page(`return ['fire', 'bomb'].map((k) => { const r = q('.hs-pause-card li.hs-need[data-need="' + k + '"]'); return { k, row: !!r, spend: r ? qa('[data-spend="true"]', r).length : 0 }; });`));
    const bad = rows.filter((r) => !r.row || r.spend !== 1);
    return bad.length === 0 ? null : bad.map((r) => (r.row ? `the ${r.k} row has ${r.spend} spend buttons` : `no ${r.k} row in Needs you now`)).join('; ');
  },
  async spendEnabled(b) {
    const s = await b.evaluate(page(`return qa('.hs-pause-card li.hs-need [data-spend="true"]').map((e) => ({ t: e.textContent.trim(), off: e.disabled }));`));
    const off = s.filter((x) => x.off);
    return s.length >= 2 && off.length === 0 ? null : `spend buttons: ${JSON.stringify(s)}`;
  },
  async spendDisabledCash(b) {
    const s = await b.evaluate(page(`return qa('.hs-pause-card li.hs-need').map((r) => { const btn = r.querySelector('[data-spend="true"]'); const note = [...r.querySelectorAll('.hs-toast-note')].find(vis);
      return { need: r.dataset.need, off: btn ? btn.disabled : null, note: note ? note.textContent.trim() : null }; }).filter((x) => x.off !== null);`));
    const bad = s.filter((x) => !x.off || !x.note || !/^Not enough cash\./.test(x.note));
    return s.length >= 2 && bad.length === 0 ? null : `spend rows: ${JSON.stringify(s)}`;
  },
  async problemsSection(b) {
    const n = await b.evaluate(page(`const p = q('.hs-pause-card .hs-problems'); return p ? qa('.hs-problem', p).length : -1;`));
    return n > 0 ? null : n < 0 ? 'no Tower problems section drawn' : 'the Tower problems section has no rows';
  },
  async problemRows(b) {
    const texts = await b.evaluate(page(`return qa('.hs-pause-card .hs-problem .hs-log-text').map((e) => e.textContent.trim());`));
    const want = [['a long elevator queue', /waiting for an elevator, the longest/], ['a room with no way in', /with no way in from the lobby/], ['housekeeping out of reach', /^Housekeeping cannot get to/], ['a waste backlog with made against collected', /^Waste is piling up.*Today the tower made .* and the collectors took/], ['a move-out countdown', /will move out/]];
    const missing = want.filter(([, re]) => !texts.some((t) => re.test(t))).map(([w]) => w);
    return missing.length === 0 ? null : `no row for ${missing.join(', ')} (rows: ${texts.length})`;
  },
  async focusNotSpend(b, got) {
    if (!got.focus) return 'focus not read';
    return got.focus.spend ? `first focus is on a spending button: ${got.focus.desc}` : null;
  },
  async vipResultSection(b) {
    const v = await b.evaluate(page(`const s = q('.hs-pause-card .hs-stories-vip .hs-vip'); return s ? { head: s.querySelector('.hs-vip-headline')?.textContent?.trim() ?? '', text: s.textContent.trim().slice(0, 200) } : null;`));
    if (!v) return 'no VIP visit section drawn in Stories';
    return /\b(good|fair)\b/i.test(v.head || v.text) ? null : `the VIP section reads "${(v.head || v.text).slice(0, 120)}"`;
  },
  async quietNeeds(b) {
    const t = await b.evaluate(page(`const n = q('.hs-pause-card .hs-needs'); return n ? qa('li', n).map((e) => e.textContent.trim()) : null;`));
    if (!t) return 'no Needs you now section';
    return t.length === 1 && t[0] === 'Nothing needs you right now.' ? null : `Needs you now reads ${JSON.stringify(t).slice(0, 160)}`;
  },
  async followHint(b) {
    const t = await b.evaluate(page(`const h = q('.hs-pause-card .hs-follow-hint'); return h ? h.textContent.trim() : null;`));
    return t === 'Nobody yet. Open a person and choose Follow.' ? null : `the Following hint reads ${JSON.stringify(t)}`;
  },
  async noSpendShown(b) {
    const s = await b.evaluate(page(`return qa('.hs-pause-card [data-spend="true"], .hs-pause-card .hs-need-go').map((e) => desc(e));`));
    return s.length === 0 ? null : `drawn while nothing needs the player: ${s.join(', ')}`;
  },
  async fireCard(b) {
    const s = await b.evaluate(page(`const c = q('.hs-toast.is-fire'); const btn = c && c.querySelector('[data-spend="true"]'); return c ? { btn: btn ? btn.textContent.trim() : null, off: btn ? btn.disabled : null, drawn: btn ? vis(btn) : false } : null;`));
    if (!s) return 'no fire card';
    return s.btn && s.drawn && s.off === false && /^Call a helicopter/.test(s.btn) ? null : `the fire card's helicopter: ${JSON.stringify(s)}`;
  },
  async chipClear(b) {
    const s = await b.evaluate(page(`const c = q('.hs-toast-chip[data-incident="fire"]'); const m = q('button.hs-round[aria-label="Menu"]'); const sp = q('.hs-speed');
      const hit = (a, z) => a && z && Math.min(a.r, z.r) - Math.max(a.x, z.x) > 0 && Math.min(a.b, z.b) - Math.max(a.y, z.y) > 0;
      return c ? { chip: rr(R(c)), menu: m ? rr(R(m)) : null, speed: sp ? rr(R(sp)) : null, onMenu: hit(R(c), m && R(m)), onSpeed: hit(R(c), sp && R(sp)), fireCard: !!q('.hs-toast.is-fire') } : null;`));
    if (!s) return 'no fire chip';
    const bad = [];
    if (s.onMenu) bad.push(`the chip ${JSON.stringify(s.chip)} overlaps Menu ${JSON.stringify(s.menu)}`);
    if (s.onSpeed) bad.push(`the chip ${JSON.stringify(s.chip)} overlaps the speed control ${JSON.stringify(s.speed)}`);
    if (s.fireCard) bad.push('the fire card is still drawn');
    return bad.length === 0 ? null : bad.join('; ');
  },
  async vipCard(b, got) {
    const s = await b.evaluate(page(`const c = q(${JSON.stringify(got.card)}); return c ? c.textContent.trim().slice(0, 160) : null;`));
    return s ? null : `no ${got.card} drawn`;
  },
  async cardPlace(b, got, run) {
    const vp = VIEWPORTS[run.vp];
    const s = await b.evaluate(page(`const c = q('.hs-sheet'); const m = q('button.hs-round[aria-label="Menu"]');
      return c ? { card: rr(R(c)), anchored: c.classList.contains('is-anchored'), side: c.getAttribute('data-side'), mode: c.getAttribute('data-mode'), menu: m ? rr(R(m)) : null, vw: innerWidth, vh: innerHeight } : null;`));
    if (!s) return 'no card drawn';
    got.place = s;
    if (vp.w < ANCHOR_MIN_WIDTH) {
      // A phone: the bottom sheet, across the width and down to the bottom edge.
      const ok = s.card.y + s.card.h >= s.vh - 2 && s.card.x <= 2 && s.card.x + s.card.w >= s.vw - 2;
      return ok ? null : `not a bottom sheet: the card is ${JSON.stringify(s.card)} in ${s.vw}x${s.vh} (mode ${s.mode})`;
    }
    const bad = [];
    const c = s.card;
    if (!s.anchored) bad.push(`the card ${JSON.stringify(c)} is not anchored (side ${s.side}, mode ${s.mode})`);
    if (s.menu) {
      const m = s.menu;
      if (Math.min(c.x + c.w, m.x + m.w) - Math.max(c.x, m.x) > 0 && Math.min(c.y + c.h, m.y + m.h) - Math.max(c.y, m.y) > 0) bad.push(`the card ${JSON.stringify(c)} overlaps Menu ${JSON.stringify(m)}`);
    }
    const sel = got.target?.selection;
    if (!sel) bad.push(`the selection could not be measured after the card opened (${typeof got.target?.viewShift === 'string' ? got.target.viewShift : 'the view zoomed'})`);
    else {
      // The selection's box: inner is what the hover card reads; an edge that met a shaft may go
      // on under it, up to outer. The card must stand clear of the inner box and within
      // ANCHOR_MAX_GAP of some box between the two.
      const inner = { x: sel.x, y: sel.y, r: sel.x + sel.w, b: sel.y + sel.h };
      const outer = sel.outer ?? inner;
      const cr = { x: c.x, y: c.y, r: c.x + c.w, b: c.y + c.h };
      const ix = Math.min(cr.r, inner.r) - Math.max(cr.x, inner.x);
      const iy = Math.min(cr.b, inner.b) - Math.max(cr.y, inner.y);
      // The least gap any box between inner and outer allows, on the side the card stands.
      const gapX = cr.x >= inner.r ? Math.max(0, cr.x - outer.r) : cr.r <= inner.x ? Math.max(0, outer.x - cr.r) : 0;
      const gapY = cr.y >= inner.b ? Math.max(0, cr.y - outer.b) : cr.b <= inner.y ? Math.max(0, outer.y - cr.b) : 0;
      const gap = Math.max(gapX, gapY);
      got.gap = gap;
      if (ix > 0 && iy > 0) bad.push(`the card ${JSON.stringify(c)} covers its selection ${JSON.stringify(inner)}`);
      else if (gap > ANCHOR_MAX_GAP) bad.push(`the card ${JSON.stringify(c)} is ${gap} px from its selection ${JSON.stringify(inner)}${outer !== inner ? ` (at most ${JSON.stringify(outer)} under a shaft)` : ''} (side ${s.side})`);
    }
    return bad.length === 0 ? null : bad.join('; ');
  },
  async housekeepingRows(b) {
    return rowsCheck(b, ['Rooms to clean', 'Cannot reach', 'Cleaning hours']);
  },
  async recyclingRows(b) {
    return rowsCheck(b, ['Workers', 'Waste made today', 'Collected today', 'Rooms piling up', 'Cannot reach']);
  },
  async clipsShown(b, got) {
    const s = await b.evaluate(page(`const root = q(${JSON.stringify(got.clips)}); return root ? qa('.hs-clip', root).map((c) => ({ title: c.querySelector('.hs-clip-title')?.textContent?.trim(), player: !!c.querySelector('video.hs-clip-video'), failed: c.querySelector('.hs-clip-line')?.textContent?.trim() ?? null })) : null;`));
    if (!s) return 'no clips drawn';
    const bad = s.filter((c) => !c.player);
    return s.length === 4 && bad.length === 0 ? null : `clips: ${JSON.stringify(s)}`;
  },
  async leaveCard(b, got) {
    const s = await b.evaluate(page(`const c = q('.hs-pause-card'); return c ? { title: c.querySelector('.hs-pause-title')?.textContent?.trim(), answers: qa('.hs-leave .hs-pause-item', c).map((e) => e.textContent.trim()) } : null;`));
    if (!s) return 'no leave card';
    const bad = [];
    if (s.title !== 'Your tower did not save') bad.push(`the plate reads "${s.title}"`);
    if (!got.focus || got.focus.text !== 'Keep playing') bad.push(`first focus is ${got.focus?.desc ?? 'unread'}, not Keep playing`);
    return bad.length === 0 ? null : `${bad.join('; ')} (answers: ${s.answers.join(', ')})`;
  },
  async exitedFocus(b, got) {
    return got.focus?.exit === 'continue' ? null : `first focus is ${got.focus?.desc ?? 'unread'}, not Continue tower`;
  },
  async noMotion(b, got) {
    const m = got.motion ?? (await motionNow(b));
    return m.length === 0 ? null : `running with reduced motion on: ${m.slice(0, 4).join(', ')}`;
  },
};

async function rowsCheck(b, labels) {
  const have = await b.evaluate(page(`return qa('.hs-sheet .hs-row-label').map((e) => e.textContent.trim());`));
  const missing = labels.filter((l) => !have.includes(l));
  return missing.length === 0 ? null : `no ${missing.join(', ')} row in the card (rows: ${have.join(', ').slice(0, 160)})`;
}

// ------------------------------------------------------------------ one shot

async function runShot(b, base, run, ctx) {
  const vp = VIEWPORTS[run.vp];
  const started = Date.now();
  const result = { id: run.id, shot: run.shot.name, viewport: run.vp, largeText: run.large, reducedMotion: run.motion === 'reduce', status: 'OK', failed: [], checks: {}, file: null };
  const fixture = join(FIXTURE_DIR, `${run.shot.fixture}.json`);
  if (!existsSync(fixture)) {
    result.status = 'NOT-CAPTURED';
    result.why = `fixture ${run.shot.fixture}.json is missing (run scripts/make-readiness-fixtures.ts first, or it printed NOT REACHED)`;
    return result;
  }
  const saveText = readFileSync(fixture, 'utf8');
  try {
    await b.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: run.motion === 'reduce' ? 'reduce' : 'no-preference' }] });
    await seed(b, base, saveText, run.large);
    b.problems.length = 0;
    await boot(b, base, JSON.parse(saveText));
    if (run.large && !(await b.evaluate(`document.documentElement.classList.contains('hs-large-text') || !!document.querySelector('.hs-large-text')`))) throw new NotCaptured('Larger text did not take (no hs-large-text class)');
    const got = await STATES[run.shot.state](b);
    // Checks.
    const common = await b.evaluate(commonChecks(got.card));
    result.checks.items = common.items;
    const fail = (check, detail) => { if (detail) result.failed.push({ check, detail }); result.checks[check] = detail ?? 'ok'; };
    fail('noConsoleErrors', b.problems.length === 0 ? null : b.problems.slice(0, 4).join(' | '));
    for (const k of ['noOverflow', 'hiddenNotDrawn', 'words', 'insideCard', 'notClipped', 'noOverlap', 'layout']) if (k in common) fail(k, common[k]);
    for (const name of run.shot.checks) {
      let detail;
      try { detail = await CHECKS[name](b, got, run); } catch (e) { detail = `the check threw: ${String(e.message ?? e).slice(0, 200)}`; }
      fail(name, detail);
    }
    if (got.target) result.target = got.target;
    if (got.place) result.place = got.place;
    if (got.gap !== undefined) result.gap = got.gap;
    if (got.focus) result.focus = got.focus;
    if (got.centering) result.centering = got.centering;
    if (result.failed.length > 0) result.status = 'CHECK FAILED';
    if (!ctx.checksOnly && !run.checksOnly) {
      const r = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const png = dropAlpha(Buffer.from(r.data, 'base64'));
      const info = pngInfo(png);
      if (info.width !== vp.w * vp.dpr || info.height !== vp.h * vp.dpr) throw new Error(`captured ${info.width} by ${info.height}, expected ${vp.w * vp.dpr} by ${vp.h * vp.dpr}`);
      result.file = `${run.id}.png`;
      writeFileSync(join(ctx.outDir, result.file), png);
    }
  } catch (e) {
    result.status = 'NOT-CAPTURED';
    result.why = e instanceof NotCaptured ? e.message : `error: ${String(e?.message ?? e).slice(0, 300)}`;
    if (b.problems.length) result.why += ` (console: ${b.problems.slice(0, 2).join(' | ')})`;
  }
  result.ms = Date.now() - started;
  return result;
}

function line(r) {
  const label = r.id.padEnd(48);
  if (r.status === 'OK') return `${label} OK`;
  if (r.status === 'NOT-CAPTURED') return `${label} NOT-CAPTURED: ${r.why}`;
  return `${label} CHECK FAILED: ${r.failed.map((f) => `${f.check}: ${f.detail}`).join(' || ')}`;
}

// ------------------------------------------------------------------ main

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  }
  if (!existsSync(CHROME_PATH)) {
    console.error(`Chrome not found at ${CHROME_PATH}; set CHROME to its path.`);
    process.exit(2);
  }
  const runs = expand(args.only ? SHOTS.filter((s) => args.only.includes(s.name)) : SHOTS);
  const outDir = args.out;
  mkdirSync(outDir, { recursive: true });
  if (!args.checksOnly) for (const f of readdirSync(outDir)) if (f.endsWith('.png')) rmSync(join(outDir, f));
  const tmp = mkdtempSync(join(tmpdir(), 'hs-readiness-'));
  const results = [];
  const t0 = Date.now();
  let server = null;
  let chrome = null;
  try {
    console.log('building the web bundle into a temp dir');
    build(join(tmp, 'dist'));
    server = await startPreview(join(tmp, 'dist'));
    for (const vpName of Object.keys(VIEWPORTS)) {
      const mine = runs.filter((r) => r.vp === vpName);
      if (mine.length === 0) continue;
      chrome = await launchChrome(tmp);
      try {
        for (const run of mine) {
          const r = await runShot(chrome, server.base, run, { outDir, checksOnly: args.checksOnly });
          results.push(r);
          console.log(`${line(r)} (${(r.ms / 1000).toFixed(1)} s)`);
        }
      } finally {
        await chrome.close();
        chrome = null;
      }
    }
  } finally {
    try { if (chrome) await chrome.close(); } finally {
      if (server) await server.stop();
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  const failed = results.filter((r) => r.status === 'CHECK FAILED').length;
  const missed = results.filter((r) => r.status === 'NOT-CAPTURED').length;
  const summary = `${results.length} shots: ${results.length - failed - missed} OK, ${failed} CHECK FAILED, ${missed} NOT-CAPTURED; ${seconds} s${args.checksOnly ? '; checks only, no PNGs' : ''}`;
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ when: new Date().toISOString(), checksOnly: args.checksOnly, seconds, summary, results }, null, 1));
  writeFileSync(join(outDir, 'report.txt'), `${results.map(line).join('\n')}\n${summary}\n`);
  console.log(summary);
  console.log(`report: ${relative(ROOT, join(outDir, 'report.txt'))}`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}
