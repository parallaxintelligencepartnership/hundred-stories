// The share picture (bug 2026-09-27, Chrome mobile): snapshot() extracted the whole stage, whose
// bounds run the sky and street far past the screen (30744 x 7386 px measured on a 390 x 844
// phone view at DPR 2). A phone cannot allocate that: the extract threw, the share card showed
// no picture and its Share and Save image buttons stayed disabled. The snapshot is the current
// view, as the Renderer contract says, at a resolution capped so its longest side stays small.
// Drives the real createRenderer against a stub pixi Application, as first-frame.test.ts does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Texture } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { createRenderer, SNAPSHOT_MAX_PX, type Renderer } from '../../src/render/renderer';
import { createWorld } from '../../src/sim/world';

interface ExtractCall {
  target: unknown;
  frame?: { x: number; y: number; width: number; height: number };
  resolution?: number;
}

const apps = vi.hoisted(
  () =>
    [] as {
      stage: import('pixi.js').Container;
      frames: (() => void)[];
      ticker: { deltaMS: number };
      screen: { width: number; height: number };
      renderer: { resolution: number; extract: { canvas: (options: unknown) => unknown } };
      extractCalls: unknown[];
    }[],
);

vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<typeof import('pixi.js')>();
  class FakeApplication {
    stage = new pixi.Container();
    screen = { width: 800, height: 600 };
    canvas = {
      style: {} as Record<string, string>,
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
    };
    extractCalls: unknown[] = [];
    renderer = {
      background: { color: 0 },
      render: (): void => {},
      resolution: 1,
      extract: {
        canvas: (options: unknown): unknown => {
          this.extractCalls.push(options);
          return { width: 1, height: 1 };
        },
      },
    };
    frames: (() => void)[] = [];
    ticker = {
      add: (fn: () => void): void => {
        this.frames.push(fn);
      },
      remove: (): void => {},
      deltaMS: 16,
    };
    constructor() {
      apps.push(this);
    }
    async init(): Promise<void> {}
    destroy(): void {}
  }
  return { ...pixi, Application: FakeApplication, isWebGLSupported: () => true };
});

const stubArt: Art = {
  room: () => Texture.WHITE,
  slab: () => Texture.WHITE,
  shaft: () => Texture.WHITE,
  car: () => Texture.WHITE,
  sim: () => Texture.WHITE,
  ghost: () => Texture.WHITE,
};
vi.mock('../../src/render/art', async (importOriginal) => {
  const art = await importOriginal<typeof import('../../src/render/art')>();
  return { ...art, createArt: () => stubArt };
});
vi.mock('../../src/render/sky', async (importOriginal) => {
  const sky = await importOriginal<typeof import('../../src/render/sky')>();
  return { ...sky, createSky: () => ({ update: (): void => {}, destroy: (): void => {} }) };
});

let renderers: Renderer[] = [];
beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 3, addEventListener: () => {}, removeEventListener: () => {} });
});
afterEach(() => {
  for (const r of renderers) r.destroy();
  renderers = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function snapshotOn(screen: { width: number; height: number }, resolution: number): Promise<ExtractCall> {
  const container = { appendChild: () => {} } as unknown as HTMLElement;
  const renderer = await createRenderer(container, createWorld(1));
  renderers.push(renderer);
  const app = apps[apps.length - 1]!;
  app.screen.width = screen.width;
  app.screen.height = screen.height;
  app.renderer.resolution = resolution;
  for (const fn of app.frames) fn();
  renderer.snapshot();
  expect(app.extractCalls).toHaveLength(1);
  const call = app.extractCalls[0] as ExtractCall;
  expect(call.target).toBe(app.stage);
  return call;
}

describe('share snapshot', () => {
  it('takes the view on screen, not the whole stage', async () => {
    const call = await snapshotOn({ width: 390, height: 844 }, 3);
    expect(call.frame).toBeDefined();
    const { x, y, width, height } = call.frame!;
    expect({ x, y, width, height }).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  });

  it('caps the longest side of the picture on a dense phone screen', async () => {
    const call = await snapshotOn({ width: 390, height: 844 }, 3);
    expect(call.resolution).toBeDefined();
    expect(844 * call.resolution!).toBeLessThanOrEqual(SNAPSHOT_MAX_PX);
    expect(844 * call.resolution!).toBeGreaterThan(SNAPSHOT_MAX_PX - 1);
  });

  it('keeps the screen resolution when the view already fits', async () => {
    const call = await snapshotOn({ width: 800, height: 600 }, 2);
    expect(call.resolution).toBe(2);
  });
});
