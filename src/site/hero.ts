// The landing hero: the game's own renderer drawing the demo tower behind the
// copy. Same art, same sky, same elevators as /play/.
//
// It is decoration and it behaves like decoration. No pointer handling, no
// ghost, no selection, no pan. If reduced motion is asked for, or WebGL is not
// there, or anything at all throws, the still image in the markup stays and
// this file goes quiet.

import { createRenderer, type Renderer } from '../render/renderer';
import { animateDemo, buildDemoWorld } from '../render/smoke';
import './challenge';

/** One demo day every forty seconds: slower than the smoke page, it is background. */
const MINUTES_PER_MS = 1440 / 40_000;
const SECONDS_PER_FLOOR = 6;
const START_FLOOR = 3;
const CENTER_TILE = 130;
const MAX_FRAME_MS = 100;

function driftFloor(elapsedMs: number, topFloor: number): number {
  const climb = Math.max(1, topFloor - START_FLOOR);
  const halfPeriod = climb * SECONDS_PER_FLOOR * 1000;
  const phase = (elapsedMs % (halfPeriod * 2)) / halfPeriod;
  const triangle = phase < 1 ? phase : 2 - phase;
  // Smoothstep, so the top and the bottom of the drift ease rather than snap.
  const eased = triangle * triangle * (3 - 2 * triangle);
  return START_FLOOR + eased * climb;
}

function topFloorOf(world: ReturnType<typeof buildDemoWorld>): number {
  let top = START_FLOOR;
  for (const room of world.rooms.values()) top = Math.max(top, room.floor + room.height - 1);
  return top;
}

async function start(): Promise<void> {
  const hero = document.getElementById('hero');
  const view = document.getElementById('hero-view');
  const shot = document.getElementById('hero-shot');
  if (!hero || !view) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const world = buildDemoWorld();
  const top = topFloorOf(world);

  // The canvas host only takes its size once this class is on, and the renderer
  // measures the host as it initializes, so the class goes on first.
  hero.classList.add('has-canvas');

  let renderer: Renderer;
  try {
    renderer = await createRenderer(view, world, { crowd: 'all' });
  } catch (e) {
    hero.classList.remove('has-canvas');
    console.warn('hero: no tower today', e);
    return;
  }

  if (shot) shot.style.display = 'none';
  renderer.setPanEnabled(false);
  renderer.camera.centerOn(START_FLOOR, CENTER_TILE);

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

    animateDemo(world, dt, { minutesPerMs: MINUTES_PER_MS, fire: false });
    // The camera is ours every frame: this also undoes any key panning the
    // renderer's own window listeners picked up from someone reading the page.
    renderer.camera.clearKeys();
    renderer.camera.centerOn(driftFloor(elapsed, top), CENTER_TILE);
    renderer.render(world, 1);

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
      renderer.destroy();
    },
    { once: true },
  );

  sync();
}

start().catch((e: unknown) => {
  // Nothing here is load bearing: put the still image back and say nothing louder.
  document.getElementById('hero')?.classList.remove('has-canvas');
  const shot = document.getElementById('hero-shot');
  if (shot) shot.style.display = '';
  console.warn('hero: disabled', e);
});
