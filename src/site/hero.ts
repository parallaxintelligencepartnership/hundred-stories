// The landing hero: the game's own renderer drawing the hero tower (buildHeroWorld) beside the
// copy. Same art, same sky, same elevators as /play/.
//
// It is decoration and it behaves like decoration. No pointer handling, no
// ghost, no selection, no pan. If reduced motion is asked for, or WebGL is not
// there, or anything at all throws, the still image in the markup stays and
// this file goes quiet.

import { TILE_PX } from '../render/grid';
import type { Renderer } from '../render/renderer';
import type { World } from '../sim/types';
import { markHeroSettled } from './hero-ready';
import './challenge';
import './splash';
import './platforms';
import './stores';

const SECONDS_PER_FLOOR = 6;
const START_FLOOR = 3;
export const CENTER_TILE = 130;
const MAX_FRAME_MS = 100;
/** How long start() waits on the load event before it notes the wait in the console. */
export const LOAD_WAIT_NOTE_MS = 15_000;

/** The hero's clock (D-35): 10:00 to 20:00 and back, one way every HERO_LEG_MS, so it is day most of the loop. */
export const HERO_MINUTE_FROM = 600;
export const HERO_MINUTE_SPAN = 600;
export const HERO_LEG_MS = 45_000;
/** At this viewport width and wider the copy sits beside the tower, not over it (site.css). */
export const HERO_SIDE_BY_SIDE = '(min-width: 720px)';
/** A tower wider than the space beside the panel starts this many css px right of the panel. */
export const HERO_PANEL_GAP = 24;

/** The 0 to 1 to 0 triangle: rises over [0, 1], falls over [1, 2], and repeats. */
export function tri(x: number): number {
  const phase = ((x % 2) + 2) % 2;
  return phase < 1 ? phase : 2 - phase;
}

/** The hero's minute of the day at this much elapsed wall clock time. */
export function heroMinute(elapsedMs: number): number {
  return HERO_MINUTE_FROM + tri(elapsedMs / HERO_LEG_MS) * HERO_MINUTE_SPAN;
}

type Span = { left: number; right: number };

/** The tower's horizontal span in tiles, rooms and shafts, right edge exclusive. */
export function towerSpanOf(world: World): Span {
  let left = Infinity;
  let right = -Infinity;
  for (const part of [...world.rooms.values(), ...world.shafts.values()]) {
    left = Math.min(left, part.x);
    right = Math.max(right, part.x + part.width);
  }
  return { left, right };
}

/**
 * The tile the camera centers on (camera.ts centerOn: that tile's middle at the view's middle,
 * zoom 1, and the view fills the hero). Stacked (a phone), or with no panel, it is CENTER_TILE.
 * Side by side, the tower goes in the middle of the space right of the panel as the spec has it
 * (the space is dx css px right of the hero's center, so the camera looks dx / TILE_PX tiles left
 * of CENTER_TILE), but only when that leaves its left edge at least HERO_PANEL_GAP px clear of the
 * panel. Otherwise its left edge sits HERO_PANEL_GAP px right of the panel and its right side
 * crops at the viewport edge.
 */
export function heroCenterTile(hero: Span, panel: Span | null, sideBySide: boolean, tower: Span): number {
  if (!sideBySide || !panel) return CENTER_TILE;
  const heroMid = (hero.left + hero.right) / 2;
  const leftEdgeAt = (tile: number): number => heroMid + (tower.left - (tile + 0.5)) * TILE_PX;
  const spaceMid = (panel.right + hero.right) / 2;
  const centered = CENTER_TILE - (spaceMid - heroMid) / TILE_PX;
  if (leftEdgeAt(centered) - panel.right >= HERO_PANEL_GAP) return centered;
  return tower.left + (heroMid - (panel.right + HERO_PANEL_GAP)) / TILE_PX - 0.5;
}

function driftFloor(elapsedMs: number, topFloor: number): number {
  const climb = Math.max(1, topFloor - START_FLOOR);
  const halfPeriod = climb * SECONDS_PER_FLOOR * 1000;
  const phase = (elapsedMs % (halfPeriod * 2)) / halfPeriod;
  const triangle = phase < 1 ? phase : 2 - phase;
  // Smoothstep, so the top and the bottom of the drift ease rather than snap.
  const eased = triangle * triangle * (3 - 2 * triangle);
  return START_FLOOR + eased * climb;
}

function topFloorOf(world: World): number {
  let top = START_FLOOR;
  for (const room of world.rooms.values()) top = Math.max(top, room.floor + room.height - 1);
  return top;
}

/**
 * Resolves once the page's load event has fired. The renderer (PixiJS, most of the landing page's
 * bytes) is fetched only after it, so the still image and the copy have the network to themselves
 * on a first visit and are what Largest Contentful Paint measures.
 */
export function afterPageLoad(doc: { readyState: string }, win: Pick<Window, 'addEventListener'>): Promise<void> {
  if (doc.readyState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    // A load event that never comes (a request that hangs) leaves the still up for good; say so once.
    const hung = setTimeout(() => console.info(`hero: no load event after ${LOAD_WAIT_NOTE_MS / 1000} s, the still image stays`), LOAD_WAIT_NOTE_MS);
    win.addEventListener(
      'load',
      () => {
        clearTimeout(hung);
        resolve();
      },
      { once: true },
    );
  });
}

async function start(): Promise<void> {
  const hero = document.getElementById('hero');
  const view = document.getElementById('hero-view');
  const shot = document.getElementById('hero-shot');
  if (!hero || !view) return markHeroSettled(document, 'none');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return markHeroSettled(document, 'none');

  await afterPageLoad(document, window);
  // Dynamic, so Vite does not modulepreload the renderer's chunks in the page head.
  const [{ createRenderer }, { animateDemo, buildHeroWorld }] = await Promise.all([
    import('../render/renderer'),
    import('../render/smoke'),
  ]);

  const world = buildHeroWorld();
  world.time.minute = heroMinute(0);
  const top = topFloorOf(world);
  const tower = towerSpanOf(world);

  // The canvas host only takes its size once this class is on, and the renderer
  // measures the host as it initializes, so the class goes on first.
  hero.classList.add('has-canvas');

  let renderer: Renderer;
  try {
    // No load fade: the hero's own daytime sky (site.css) is under the canvas already (D-34).
    renderer = await createRenderer(view, world, { crowd: 'all', fadeIn: false });
  } catch (e) {
    hero.classList.remove('has-canvas');
    console.warn('hero: no tower today', e);
    markHeroSettled(document, 'none');
    return;
  }

  if (shot) shot.style.display = 'none';
  renderer.setPanEnabled(false);

  const panel = hero.querySelector('.hero-panel');
  const sideBySide = window.matchMedia(HERO_SIDE_BY_SIDE);
  let centerTile = CENTER_TILE;
  const measure = (): void => {
    const box = hero.getBoundingClientRect();
    const panelBox = panel ? panel.getBoundingClientRect() : null;
    centerTile = heroCenterTile(box, panelBox, sideBySide.matches, tower);
  };
  measure();
  window.addEventListener('resize', measure);
  renderer.camera.centerOn(START_FLOOR, centerTile);

  let elapsed = 0;
  let last = performance.now();
  let frameHandle = 0;
  let onScreen = true;
  let destroyed = false;

  const frame = (now: number): void => {
    frameHandle = 0;
    const dt = Math.min(MAX_FRAME_MS, now - last);
    last = now;
    elapsed += dt;

    try {
      // The clock is set, not run: the loop holds the tower in daylight with the evening as the payoff.
      world.time.minute = heroMinute(elapsed);
      animateDemo(world, dt, { minutesPerMs: 0, fire: false });
      // The camera is ours every frame: this also undoes any key panning the
      // renderer's own window listeners picked up from someone reading the page.
      renderer.camera.clearKeys();
      renderer.camera.centerOn(driftFloor(elapsed, top), centerTile);
      renderer.render(world, 1);
    } catch (e) {
      // A frame that throws ends the loop; nothing may be left waiting on a tower that never drew.
      markHeroSettled(document, 'none');
      throw e;
    }
    // The first frame is on screen: the page's other work (the room specimens) may start.
    markHeroSettled(document, 'drawn');

    frameHandle = requestAnimationFrame(frame);
  };

  const shouldRun = (): boolean => !destroyed && onScreen && document.visibilityState !== 'hidden';

  const sync = (): void => {
    if (shouldRun()) {
      if (frameHandle === 0) {
        last = performance.now();
        frameHandle = requestAnimationFrame(frame);
      }
      return;
    }
    if (frameHandle !== 0) {
      cancelAnimationFrame(frameHandle);
      frameHandle = 0;
    }
  };

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0 },
    );
    observer.observe(view);
  }

  document.addEventListener('visibilitychange', sync);

  window.addEventListener(
    'pagehide',
    () => {
      destroyed = true;
      sync();
      window.removeEventListener('resize', measure);
      renderer.destroy();
    },
    { once: true },
  );

  sync();
}

// Guarded so the helpers above import cleanly into tests, which run with no `document`.
if (typeof document !== 'undefined') {
  start().catch((e: unknown) => {
    // Nothing here is load bearing: put the still image back and say nothing louder.
    document.getElementById('hero')?.classList.remove('has-canvas');
    const shot = document.getElementById('hero-shot');
    if (shot) shot.style.display = '';
    console.warn('hero: disabled', e);
    markHeroSettled(document, 'none');
  });
}
