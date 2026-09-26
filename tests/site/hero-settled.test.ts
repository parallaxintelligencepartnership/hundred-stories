// The hero's settled signal on every path, run through hero.ts's own start(): reduced motion gives
// up at once, a first frame that throws still settles as "none", and a first frame that draws
// settles as "drawn". The specimens go ahead once it has settled either way.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const render = vi.fn();
vi.mock('../../src/render/renderer', () => ({
  createRenderer: vi.fn(() =>
    Promise.resolve({
      setPanEnabled: () => undefined,
      camera: { centerOn: () => undefined, clearKeys: () => undefined },
      render,
      destroy: () => undefined,
    }),
  ),
}));
// The landing page's other modules touch their own markup at import; none of it is under test.
vi.mock('../../src/site/challenge', () => ({}));
vi.mock('../../src/site/platforms', () => ({}));
vi.mock('../../src/site/stores', () => ({}));

import { HERO_SETTLED_ATTR } from '../../src/site/hero-ready';
import { bootSpecimens, type SpecimenCanvas, type SpecimenDocument, type SpecimenImage } from '../../src/site/specimens';

type G = Record<string, unknown>;
const g = globalThis as unknown as G;
const saved: G = {};
const KEYS = ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame'];

let frames: ((now: number) => void)[];
let attrs: Map<string, string>;
let events: number;

function install(reducedMotion: boolean): void {
  frames = [];
  attrs = new Map();
  events = 0;
  const listeners: (() => void)[] = [];
  const box = { left: 0, right: 1440, top: 0, bottom: 480, width: 1440, height: 480 };
  const hero = {
    classList: { add: () => undefined, remove: () => undefined, contains: () => true },
    querySelector: () => ({ getBoundingClientRect: () => ({ ...box, right: 640 }) }),
    getBoundingClientRect: () => box,
  };
  const office: SpecimenCanvas & { replacedBy: SpecimenImage | null } = {
    width: 0,
    height: 0,
    dataset: { specimen: 'office' },
    getAttribute: () => 'An office',
    getContext: () =>
      new Proxy({} as Record<string, unknown>, {
        get: (t, k: string) => (k in t ? t[k] : k === 'createLinearGradient' ? () => ({ addColorStop: () => undefined }) : k === 'measureText' ? () => ({ width: 1 }) : () => undefined),
        set: (t, k: string, v) => ((t[k] = v), true),
      }) as unknown as CanvasRenderingContext2D,
    toDataURL: () => 'data:,drawn',
    replaceWith(node) {
      office.replacedBy = node as SpecimenImage;
    },
    classList: { add: () => undefined },
    replacedBy: null,
  };
  g.document = {
    documentElement: { getAttribute: (n: string) => attrs.get(n) ?? null, setAttribute: (n: string, v: string) => void attrs.set(n, v) },
    getElementById: (id: string) => (id === 'hero' ? hero : id === 'hero-view' ? {} : id === 'hero-shot' ? { style: {} } : null),
    addEventListener: (_t: string, l: () => void) => void listeners.push(l),
    dispatchEvent: () => {
      events += 1;
      for (const l of listeners.splice(0)) l();
      return true;
    },
    querySelectorAll: () => [office],
    createElement: () => ({ src: '', alt: '', width: 0, height: 0, className: '' }),
    visibilityState: 'visible',
    office,
  };
  g.window = {
    matchMedia: (q: string) => ({ matches: q.includes('reduced-motion') ? reducedMotion : true }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  g.requestAnimationFrame = (cb: (now: number) => void) => (frames.push(cb), frames.length);
  g.cancelAnimationFrame = () => undefined;
}

async function startHero(reducedMotion: boolean): Promise<void> {
  install(reducedMotion);
  vi.resetModules();
  await import('../../src/site/hero');
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function specimensDraw(): Promise<string | undefined> {
  const doc = g.document as SpecimenDocument & { office: { replacedBy: SpecimenImage | null } };
  await bootSpecimens({
    doc: doc as never,
    fontsReady: Promise.resolve(),
    wait: () => new Promise(() => undefined),
    dpr: 1,
    viewportHeight: 900,
    observe: null,
    idle: (work) => work(),
  });
  return doc.office.replacedBy?.src;
}

beforeEach(() => {
  for (const k of KEYS) saved[k] = g[k];
  render.mockReset();
});
afterEach(() => {
  for (const k of KEYS) g[k] = saved[k];
});

describe('the hero settles on every path', () => {
  it('under reduced motion it gives up at once: "none", one event, and the specimens draw', async () => {
    await startHero(true);
    expect(attrs.get(HERO_SETTLED_ATTR)).toBe('none');
    expect(events).toBe(1);
    expect(frames).toHaveLength(0);
    expect(await specimensDraw()).toBe('data:,drawn');
  });

  it('when the first frame throws it still settles as "none", and the specimens draw', async () => {
    render.mockImplementation(() => {
      throw new Error('context lost');
    });
    await startHero(false);
    expect(attrs.get(HERO_SETTLED_ATTR)).toBeUndefined();
    expect(frames).toHaveLength(1);
    expect(() => frames[0]!(16)).toThrow('context lost');
    expect(attrs.get(HERO_SETTLED_ATTR)).toBe('none');
    expect(events).toBe(1);
    expect(await specimensDraw()).toBe('data:,drawn');
  });

  it('when the first frame draws it settles as "drawn", once', async () => {
    await startHero(false);
    expect(attrs.get(HERO_SETTLED_ATTR)).toBeUndefined();
    frames[0]!(16);
    expect(render).toHaveBeenCalledTimes(1);
    expect(attrs.get(HERO_SETTLED_ATTR)).toBe('drawn');
    frames[1]!(32);
    expect(events).toBe(1);
  });
});
