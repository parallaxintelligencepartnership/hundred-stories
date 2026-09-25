// Haptics, mocked: a light tap on a build, a double tap on a refusal, a success pattern on a
// star. navigator.vibrate on the web, the Capacitor plugin in the apps, nothing when switched
// off, and the switch as one row at the end of Settings, Display.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createHaptics,
  createHapticsRow,
  DOUBLE_TAP_GAP_MS,
  hapticsEnabled,
  VIBRATE_PATTERNS,
  type HapticsDeps,
} from '../../src/ui/haptics';
import { PREF_KEYS, getPref } from '../../src/ui/prefs';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

function deps(overrides: Partial<HapticsDeps> = {}) {
  const vibrated: (number | number[])[] = [];
  const native: string[] = [];
  const later: { fn: () => void; ms: number }[] = [];
  let now = 0;
  const d: HapticsDeps = {
    native: () => false,
    vibrate: (p) => {
      vibrated.push(p);
      return true;
    },
    loadNative: async () => ({
      lightTap: async () => void native.push('light'),
      success: async () => void native.push('success'),
    }),
    enabled: () => true,
    now: () => now,
    later: (fn, ms) => later.push({ fn, ms }),
    ...overrides,
  };
  return { d, vibrated, native, later, tick: (ms: number) => (now += ms) };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('haptics on the web', () => {
  it('vibrates a light tap, a double tap and a success pattern', () => {
    const h = deps();
    const haptics = createHaptics(h.d);
    haptics.play('place');
    h.tick(100);
    haptics.play('refuse');
    h.tick(100);
    haptics.play('star');
    expect(h.vibrated).toEqual([VIBRATE_PATTERNS.place, VIBRATE_PATTERNS.refuse, VIBRATE_PATTERNS.star]);
    expect(VIBRATE_PATTERNS.place).toBe(10);
    expect((VIBRATE_PATTERNS.refuse as number[]).length).toBe(3); // on, off, on: two taps
    expect((VIBRATE_PATTERNS.star as number[]).length).toBeGreaterThan(3);
  });

  it('feels a burst of builds in one batch once', () => {
    const h = deps();
    const haptics = createHaptics(h.d);
    haptics.play('place');
    haptics.play('place');
    h.tick(100);
    haptics.play('place');
    expect(h.vibrated).toHaveLength(2);
  });

  it('does nothing when switched off, or where the browser cannot vibrate', () => {
    const off = deps({ enabled: () => false });
    createHaptics(off.d).play('star');
    expect(off.vibrated).toEqual([]);
    const none = deps({ vibrate: null });
    expect(() => createHaptics(none.d).play('place')).not.toThrow();
  });
});

describe('haptics in the apps', () => {
  it('goes through the plugin: a light impact, two for a refusal, a success notification for a star', async () => {
    const h = deps({ native: () => true });
    const haptics = createHaptics(h.d);
    haptics.play('place');
    await flush();
    expect(h.native).toEqual(['light']);
    haptics.play('refuse');
    await flush();
    expect(h.native).toEqual(['light', 'light']);
    expect(h.later.map((l) => l.ms)).toEqual([DOUBLE_TAP_GAP_MS]);
    h.later[0]!.fn();
    await flush();
    expect(h.native).toEqual(['light', 'light', 'light']);
    haptics.play('star');
    await flush();
    expect(h.native.at(-1)).toBe('success');
    expect(h.vibrated).toEqual([]); // never the web path inside the apps
  });

  it('stays quiet if the plugin will not load', async () => {
    const h = deps({ native: () => true, loadNative: () => Promise.reject(new Error('no plugin')) });
    createHaptics(h.d).play('place');
    await flush();
    expect(h.native).toEqual([]);
  });
});

describe('the Haptics switch', () => {
  it('is on by default and stores off when turned off', () => {
    expect(hapticsEnabled()).toBe(true);
    const row = createHapticsRow() as unknown as FakeElement;
    const box = row.children.find((n) => n.tagName === 'INPUT') as FakeElement & { checked: boolean };
    const label = row.children.find((n) => n.tagName === 'LABEL')!;
    expect(label.textContent).toBe('Haptics');
    expect(box.checked).toBe(true);
    box.checked = false;
    for (const fn of box.listeners.get('change') ?? []) fn({});
    expect(getPref(PREF_KEYS.haptics)).toBe('false');
    expect(hapticsEnabled()).toBe(false);
  });

  it('is the last row of the Display section in Settings', () => {
    const game = {
      world: { cash: 1_000_000, population: 0, stars: 1, time: { minute: 0 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(), sims: new Map(), events: [] },
      subscribe: () => () => {},
      getHover: () => null,
      getSpeed: () => 1,
      getTool: () => ({ kind: 'none' }),
      setTool: () => {},
      getPlacement: () => null,
      getPlacementRect: () => null,
      getSelection: () => null,
      setChrome: () => {},
      setReducedMotion: () => {},
      getSlot: () => 'mine',
    };
    const root = dom.createElement('div');
    createUi(root as never, game as never, {} as never);
    const menu = root.descendants().find((n) => n.getAttribute('aria-label') === 'Menu')!;
    for (const fn of menu.listeners.get('click') ?? []) fn({});
    const box = root.descendants().find((n) => n.id === 'hs-haptics')!;
    const field = box.parentNode!;
    const section = field.parentNode!;
    expect(section.textContent).toContain('Display');
    expect(section.children.at(-1)).toBe(field);
  });

  it('in the shell: a build taps, a refusal double taps and a new star plays success, on a touch screen that can vibrate', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const vibrated: (number | number[])[] = [];
    Object.defineProperty(globalThis, 'navigator', { value: { vibrate: (p: number | number[]) => vibrated.push(p) }, configurable: true });
    (globalThis as { window: { matchMedia: unknown } }).window.matchMedia = () => ({ matches: true }); // coarse pointer
    try {
      let listener: ((e: unknown) => void) | null = null;
      const game = {
        world: { cash: 1_000_000, population: 0, stars: 1, time: { minute: 0 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(), sims: new Map(), events: [] },
        subscribe: () => () => {},
        subscribeEvents: (fn: (e: unknown) => void) => {
          listener = fn;
          return () => (listener = null);
        },
        getHover: () => null,
        getSpeed: () => 1,
        getTool: () => ({ kind: 'none' }),
        setTool: () => {},
        getPlacement: () => null,
        getPlacementRect: () => null,
        getSelection: () => null,
        setChrome: () => {},
        setReducedMotion: () => {},
      };
      const root = dom.createElement('div');
      const ui = createUi(root as never, game as never, {} as never);
      expect(listener).not.toBeNull();
      listener!({ kind: 'build', command: 'build' });
      listener!({ kind: 'refused', command: 'build' });
      listener!({ kind: 'stars', from: 1, to: 2 });
      listener!({ kind: 'stars', from: 2, to: 1 }); // a star lost is not a success
      expect(vibrated).toEqual([VIBRATE_PATTERNS.place, VIBRATE_PATTERNS.refuse, VIBRATE_PATTERNS.star]);
      ui.destroy();
      expect(listener).toBeNull();
    } finally {
      if (saved) Object.defineProperty(globalThis, 'navigator', saved);
    }
  });
});
