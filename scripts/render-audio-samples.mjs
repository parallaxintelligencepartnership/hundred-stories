// Rendered soundtrack samples, one WAV per listening preset.
//
//   npm run audio:samples
//
// Starts the dev server (the presets are dev only), drives headless Chrome over the DevTools
// protocol with the SwiftShader flags the game needs to mount, and loads
// /play/?new&audio=<preset>&render=45 for each preset. The page renders 45 seconds of that preset
// through the game's own sound controller on an OfflineAudioContext, encodes a 16-bit stereo
// 44.1 kHz WAV, and leaves it on window.__audioSample as base64; this script pulls it in chunks
// and writes docs/reviews/audio-samples-2026-09-23/<preset>.wav. No npm packages.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME_PATH = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT_DIR = join(ROOT, 'docs', 'reviews', 'audio-samples-2026-09-23');
// The names in src/audio/presets.ts.
const PRESETS = ['sunny-morning-1star', 'rainy-tuesday-5star', 'weekend-night-5star', 'storm-night-tower', 'fire-3star'];
const SECONDS = 45;
const CHUNK = 1 << 20;

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

async function waitForHttp(url, tries = 150) {
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

async function startDev() {
  const port = await freePort();
  const vite = join(ROOT, 'node_modules', '.bin', 'vite');
  const child = spawn(vite, ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  await waitForHttp(`${base}/play/`);
  return { base, stop: () => child.kill() };
}

async function launchChrome() {
  const port = await freePort();
  const profile = join(tmpdir(), `hs-audio-samples-${port}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME_PATH, ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--window-size=1280,800', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
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
  return { send, evaluate, close, errors };
}

async function renderOne(browser, base, name) {
  await browser.send('Page.navigate', { url: `${base}/play/?new&audio=${name}&render=${SECONDS}` });
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    const state = await browser.evaluate(`(() => window.__audioSampleError ? 'error:' + window.__audioSampleError
      : typeof window.__audioSample === 'string' ? 'len:' + window.__audioSample.length : 'wait')()`).catch(() => 'wait');
    if (state.startsWith('error:')) throw new Error(`${name}: ${state.slice(6)}`);
    if (state.startsWith('len:')) {
      const length = Number(state.slice(4));
      let b64 = '';
      for (let at = 0; at < length; at += CHUNK) b64 += await browser.evaluate(`window.__audioSample.slice(${at}, ${at + CHUNK})`);
      return Buffer.from(b64, 'base64');
    }
  }
  throw new Error(`${name}: no sample after five minutes; page errors: ${browser.errors.slice(-3).join(' | ') || 'none'}`);
}

async function main() {
  if (!existsSync(CHROME_PATH)) {
    console.error(`Chrome not found at ${CHROME_PATH}; set CHROME to its path.`);
    process.exit(2);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const dev = await startDev();
  let browser = null;
  let failed = false;
  try {
    browser = await launchChrome();
    for (const name of PRESETS) {
      try {
        const wav = await renderOne(browser, dev.base, name);
        if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${name}: the page returned something that is not a WAV`);
        const file = join(OUT_DIR, `${name}.wav`);
        writeFileSync(file, wav);
        console.log(`${relative(ROOT, file)}  ${(wav.length / 1e6).toFixed(2)} MB`);
      } catch (e) {
        failed = true;
        console.error(String(e.message ?? e));
      }
    }
  } finally {
    await browser?.close();
    dev.stop();
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
