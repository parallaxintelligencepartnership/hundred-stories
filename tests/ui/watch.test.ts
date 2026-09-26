// Watch mode (design pass 2026-09-25, BB-5): after 20 s with no pointer, key or pad input and
// nothing open, the chrome steps aside (the top bar but the clock, the dock, the goals card and
// the map fade out over 400 ms); any input brings it back at once. Off by default, a switch in
// Settings named "Watch mode", remembered with the other prefs. Under reduced motion there is
// no fade.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAD_BUTTONS, type PadLike } from '../../src/ui/gamepad';
import { createSettingsPanel, type PanelContext } from '../../src/ui/panels';
import { getFlag, PREF_KEYS, setFlag } from '../../src/ui/prefs';
import { createUi } from '../../src/ui/ui';
import { WATCH_CLASS, WATCH_FADE_MS, WATCH_IDLE_MS } from '../../src/ui/watch';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
let savedNav: PropertyDescriptor | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  dom = new FakeDom();
  uninstall = dom.install();
  savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const store = (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage;
  store.setItem('hs.intro.seen', 'true');
  store.setItem('hs.guide.done', 'true');
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
  if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

function mkGame(calls: string[] = []): never {
  return {
    world: {
      seed: 1, cash: 1e6, population: 0, stars: 1, time: { minute: 0 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(),
      sims: new Map(), events: [], stats: { lastQuarter: null, vipRating: 'none', weddingsHeld: 0 },
      story: { followed: [], threads: {}, recent: [], seq: 0 },
    },
    subscribe: () => () => {},
    getHover: () => null,
    getSpeed: () => 1,
    setSpeed: () => {},
    togglePause: () => calls.push('togglePause'),
    getTool: () => ({ kind: 'none' }),
    setTool: () => {},
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    setChrome: () => {},
    setReducedMotion: () => {},
    getSlot: () => 'mine',
    select() {},
  } as never;
}

function mount(calls: string[] = []): { root: FakeElement; shell: FakeElement; ui: ReturnType<typeof createUi> } {
  const root = dom.createElement('div');
  const ui = createUi(root as never, mkGame(calls), {} as never);
  return { root, shell: root.children[0] as FakeElement, ui };
}

const watching = (shell: FakeElement): boolean => shell.classList.contains(WATCH_CLASS);
const menuButton = (root: FakeElement): FakeElement =>
  root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu')!;
const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((f) => f({}));
const keydown = (): void =>
  dom.fireWindow('keydown', { key: 'Shift', code: 'ShiftLeft', target: dom.body, defaultPrevented: false, preventDefault() {}, stopImmediatePropagation() {} });

/** An event that records what the listeners did to it, as a browser event would. */
function spied(fields: Record<string, unknown>): Record<string, unknown> & { stopped: boolean; defaultPrevented: boolean } {
  const event = {
    ...fields,
    target: dom.body,
    stopped: false,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {
      event.stopped = true;
    },
    stopImmediatePropagation() {
      event.stopped = true;
    },
  };
  return event;
}

function pad(held: (keyof typeof PAD_BUTTONS)[] = []): PadLike {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const name of held) buttons[PAD_BUTTONS[name]] = { pressed: true, value: 1 };
  return { connected: true, axes: [0, 0, 0, 0], buttons };
}

describe('watch mode', () => {
  it('is off by default: the Settings switch reads "Watch mode", unchecked, and nothing is stored', () => {
    expect(getFlag(PREF_KEYS.watchMode)).toBe(null);
    const ctx = { apply: () => ({ ok: true }), notice() {}, close() {}, reducedMotion: false, setReducedMotion() {} } as unknown as PanelContext;
    const panel = createSettingsPanel({ world: { seed: 1, log: [], logTotal: 0 } } as never, ctx) as unknown as FakeElement;
    const control = panel.descendants().find((n) => n.id === 'hs-watch-mode') as FakeElement;
    expect(control.getAttribute('role')).toBe('switch');
    expect(control.getAttribute('aria-checked')).toBe('false');
    const label = panel.descendants().find((n) => n.tagName === 'LABEL' && n.textContent === 'Watch mode') as unknown as { htmlFor: string };
    expect(label.htmlFor).toBe('hs-watch-mode');
    click(control);
    expect(PREF_KEYS.watchMode).toBe('hs.watchMode');
    expect(getFlag(PREF_KEYS.watchMode)).toBe(true);
  });

  it('never hides the chrome while it is off', () => {
    const { shell } = mount();
    vi.advanceTimersByTime(5 * WATCH_IDLE_MS);
    expect(watching(shell)).toBe(false);
  });

  it('hides the chrome after 20 s without input when on, with a 400 ms fade', () => {
    expect([WATCH_IDLE_MS, WATCH_FADE_MS]).toEqual([20_000, 400]);
    setFlag(PREF_KEYS.watchMode, true);
    const { shell } = mount();
    vi.advanceTimersByTime(WATCH_IDLE_MS - 1);
    expect(watching(shell)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(watching(shell)).toBe(true);
  });

  it('restores at once on pointer, key or pad input, and the idle clock starts over from it', () => {
    setFlag(PREF_KEYS.watchMode, true);
    const pads: PadLike[] = [];
    Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
    const { shell } = mount();
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true);

    dom.fireWindow('pointermove', { clientX: 10, clientY: 10, pointerType: 'mouse', target: dom.body });
    expect(watching(shell)).toBe(false);
    vi.advanceTimersByTime(WATCH_IDLE_MS - 1000);
    dom.fireWindow('pointerdown', { clientX: 10, clientY: 10, pointerType: 'touch', target: dom.body });
    vi.advanceTimersByTime(WATCH_IDLE_MS - 1);
    expect(watching(shell)).toBe(false); // the tap restarted the 20 s
    vi.advanceTimersByTime(1);
    expect(watching(shell)).toBe(true);

    keydown();
    expect(watching(shell)).toBe(false);
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true);

    dom.fireWindow('wheel', { deltaY: 10, target: dom.body });
    expect(watching(shell)).toBe(false);
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true);

    pads.push(pad(['rb']));
    dom.fireWindow('gamepadconnected');
    dom.runFrame();
    expect(watching(shell)).toBe(false);
  });

  it('never hides while a panel is open, and a panel that opens brings the chrome back', () => {
    setFlag(PREF_KEYS.watchMode, true);
    const { root, shell } = mount();
    click(menuButton(root));
    expect(shell.descendants().some((n) => n.getAttribute('role') === 'dialog')).toBe(true);
    vi.advanceTimersByTime(3 * WATCH_IDLE_MS);
    expect(watching(shell)).toBe(false);

    click(menuButton(root)); // Menu again closes it
    expect(shell.descendants().some((n) => n.getAttribute('role') === 'dialog')).toBe(false);
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true);
  });

  it('follows the switch live: on starts the idle clock, off brings everything back at once', () => {
    const { shell } = mount();
    setFlag(PREF_KEYS.watchMode, true);
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true);
    setFlag(PREF_KEYS.watchMode, false);
    expect(watching(shell)).toBe(false);
    vi.advanceTimersByTime(3 * WATCH_IDLE_MS);
    expect(watching(shell)).toBe(false);
  });

  it('while hidden, the first key only brings the chrome back: nothing under it hears it', () => {
    setFlag(PREF_KEYS.watchMode, true);
    const calls: string[] = [];
    const { shell } = mount(calls);
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    const first = spied({ type: 'keydown', key: ' ', code: 'Space' });
    dom.fireWindow('keydown', first);
    expect(watching(shell)).toBe(false);
    expect([first.stopped, first.defaultPrevented]).toEqual([true, true]);
    expect(calls).toEqual([]); // Space did not pause: it only restored
    const second = spied({ type: 'keydown', key: ' ', code: 'Space' });
    dom.fireWindow('keydown', second);
    expect(second.stopped).toBe(false);
    expect(calls).toEqual(['togglePause']);
    // A browser shortcut is not the game's, but it is not taken from the browser either.
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    const shortcut = spied({ type: 'keydown', key: 't', code: 'KeyT', metaKey: true });
    dom.fireWindow('keydown', shortcut);
    expect([watching(shell), shortcut.stopped, shortcut.defaultPrevented]).toEqual([false, true, false]);
  });

  it('while hidden, the first tap only brings the chrome back: its press, release and click are swallowed', () => {
    setFlag(PREF_KEYS.watchMode, true);
    const { shell } = mount();
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    const down = spied({ type: 'pointerdown', pointerId: 7, pointerType: 'touch', clientX: 900, clientY: 40 });
    dom.fireWindow('pointerdown', down);
    expect([watching(shell), down.stopped, down.defaultPrevented]).toEqual([false, true, true]);
    const other = spied({ type: 'pointerup', pointerId: 8, pointerType: 'touch' });
    dom.fireWindow('pointerup', other);
    expect(other.stopped).toBe(false); // another finger is the player's own
    const up = spied({ type: 'pointerup', pointerId: 7, pointerType: 'touch' });
    dom.fireWindow('pointerup', up);
    expect(up.stopped).toBe(true);
    const clicked = spied({ type: 'click' });
    dom.fireWindow('click', clicked);
    expect(clicked.stopped).toBe(true);
    // Then every press is the player's again.
    const next = spied({ type: 'pointerdown', pointerId: 9, pointerType: 'touch' });
    dom.fireWindow('pointerdown', next);
    expect(next.stopped).toBe(false);
    const later = spied({ type: 'click' });
    dom.fireWindow('click', later);
    expect(later.stopped).toBe(false);
  });

  it('while hidden, the first pad press only brings the chrome back', () => {
    setFlag(PREF_KEYS.watchMode, true);
    const pads: PadLike[] = [];
    Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
    const { shell } = mount();
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    pads.push(pad(['start']));
    dom.fireWindow('gamepadconnected');
    dom.runFrame();
    expect(watching(shell)).toBe(false);
    expect(shell.descendants().some((n) => n.getAttribute('role') === 'dialog')).toBe(false); // Start opened nothing
    pads[0] = pad([]);
    dom.runFrame();
    pads[0] = pad(['start']);
    dom.runFrame();
    expect(shell.descendants().some((n) => n.getAttribute('role') === 'dialog')).toBe(true);
  });

  it('fades again after a panel opened and closed on its own, 20 s from the close', () => {
    setFlag(PREF_KEYS.watchMode, true);
    const { root, shell } = mount();
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true);
    click(menuButton(root)); // no window input: the panel opens by itself as far as watch mode knows
    expect(watching(shell)).toBe(false);
    vi.advanceTimersByTime(3 * WATCH_IDLE_MS);
    expect(watching(shell)).toBe(false);
    click(menuButton(root)); // and closes by itself
    vi.advanceTimersByTime(WATCH_IDLE_MS - 1);
    expect(watching(shell)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(watching(shell)).toBe(true);
  });

  it('lets go of its timer and listeners on destroy', () => {
    setFlag(PREF_KEYS.watchMode, true);
    const { ui } = mount();
    ui.destroy();
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'click', 'wheel']) {
      expect(dom.windowListeners.get(type) ?? []).toHaveLength(0);
    }
  });
});

describe('watch mode styles', () => {
  const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
  const block = (start: string): string => {
    const at = css.indexOf(start);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };

  it('fades the top bar but the clock, the dock, the goals card and the map over 400 ms', () => {
    expect(block(':root {')).toContain(`--watch-fade: ${WATCH_FADE_MS}ms;`);
    const hide = block(`.hs-ui.${WATCH_CLASS} :is(`);
    for (const part of ['.hs-status-pill > :not(.hs-status-clock)', '.hs-top-actions', '.hs-view-chip', '.hs-palette', '.hs-build-fab', '.hs-card', '.hs-minimap', '.hs-hover-card']) {
      expect(hide).toContain(part);
    }
    expect(hide).toContain('opacity: 0;');
    // Hidden controls take no clicks.
    expect(hide).toContain('pointer-events: none;');
    expect(hide).toContain('var(--watch-fade)');
  });

  it('has no fade under reduced motion, the setting or the system', () => {
    expect(block('.hs-ui.is-reduced {')).toContain('--watch-fade: 0ms;');
    const system = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .hs-ui {'));
    expect(system.slice(0, system.indexOf('}'))).toContain('--watch-fade: 0ms;');
  });
});
