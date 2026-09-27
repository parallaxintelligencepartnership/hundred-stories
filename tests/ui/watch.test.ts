// Watch mode (design pass 2026-09-25, BB-5): after 5 s with no pointer, key or pad input and
// nothing open, the chrome steps aside (the top bar but the clock, the dock, the goals card and
// the map fade out over 400 ms); any input brings it back at once. Off by default, a round
// Watch button under Views on the game view (no longer a Settings switch), remembered with the
// other prefs. Under reduced motion there is no fade.
// 2026-09-26 (Matt: the toggle "doesn't seem to do much"): turning it on steps the chrome aside
// after a 600 ms grace, not 5 s; the build sheet's row is not busy and closes as the chrome
// goes; the placing chip and bar go too; no news toasts while watching, alerts still show.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAD_BUTTONS, type PadLike } from '../../src/ui/gamepad';
import { createSettingsPanel, type PanelContext } from '../../src/ui/panels';
import { getFlag, PREF_KEYS, setFlag } from '../../src/ui/prefs';
import { ROOMS } from '../../src/sim/rules';
import type { RoomKind } from '../../src/sim/types';
import { addRoom, allocId, createWorld, log } from '../../src/sim/world';
import { createUi } from '../../src/ui/ui';
import { WATCH_CLASS, WATCH_ENABLE_GRACE_MS, WATCH_FADE_MS, WATCH_IDLE_MS, WATCH_TIP } from '../../src/ui/watch';
import { FakeDom, type FakeElement } from './fake-dom';

// ------------------------------------------------------------ the stylesheet, read as a browser would
// The fake DOM lays nothing out and computes no style, so these few helpers apply ui.css's own
// rules to the fake tree: what the watch rule hides, and what --watch-fade resolves to.

const sheet = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/@import[^;]*;/g, '');

/** The rules outside any at-rule (@media, @supports and @keyframes blocks are skipped whole). */
function topLevelRules(): { selectors: string[]; body: string }[] {
  const out: { selectors: string[]; body: string }[] = [];
  let i = 0;
  while (i < sheet.length) {
    const open = sheet.indexOf('{', i);
    if (open < 0) break;
    const head = sheet.slice(i, open).trim();
    if (head.startsWith('@')) {
      let depth = 1;
      let j = open + 1;
      for (; j < sheet.length && depth > 0; j += 1) {
        if (sheet[j] === '{') depth += 1;
        else if (sheet[j] === '}') depth -= 1;
      }
      i = j;
      continue;
    }
    const close = sheet.indexOf('}', open);
    out.push({ selectors: head.split(',').map((x) => x.trim()), body: sheet.slice(open + 1, close) });
    i = close + 1;
  }
  return out;
}

const classesOf = (node: FakeElement): string[] => node.className.split(/\s+/).filter(Boolean);

/** A compound of classes only (".hs-ui.is-reduced") that the node carries every class of. */
function matchesCompound(selector: string, node: FakeElement): boolean {
  if (!/^(\.[\w-]+)+$/.test(selector)) return false;
  const own = classesOf(node);
  return selector.split('.').filter(Boolean).every((c) => own.includes(c));
}

/** What a custom property resolves to on this node: its own matching rules win over :root's. */
function resolvedVar(node: FakeElement, name: string): string | null {
  let own: string | null = null;
  let root: string | null = null;
  const decl = new RegExp(`${name}:\\s*([^;]+);`);
  for (const rule of topLevelRules()) {
    const value = decl.exec(rule.body)?.[1]?.trim() ?? null;
    if (value === null) continue;
    if (rule.selectors.includes(':root')) root = value;
    if (rule.selectors.some((sel) => matchesCompound(sel, node))) own = value;
  }
  return own ?? root;
}

/** The watch rule: `.hs-ui.is-watching :is(...)` and its declarations. */
function watchRule(): { parts: string[]; body: string } {
  const rule = topLevelRules().find((r) => r.selectors.join(',').startsWith(`.hs-ui.${WATCH_CLASS} :is(`));
  if (!rule) throw new Error('no watch rule');
  const all = rule.selectors.join(', ');
  const list = all.slice(all.indexOf(':is(') + 4, all.lastIndexOf(')'));
  return { parts: list.split(',').map((x) => x.trim()), body: rule.body };
}

/** Does the watch rule apply to this node now: an ancestor is the watching shell, and a part matches? */
function hiddenByWatch(node: FakeElement): boolean {
  let up = node.parentNode;
  let shellWatching = false;
  for (; up; up = up.parentNode) if (matchesCompound(`.hs-ui.${WATCH_CLASS}`, up)) shellWatching = true;
  if (!shellWatching) return false;
  return watchRule().parts.some((part) => {
    if (matchesCompound(part, node)) return true;
    const child = /^(\.[\w-]+) > :not\((\.[\w-]+)\)$/.exec(part);
    return !!child && !!node.parentNode && matchesCompound(child[1] as string, node.parentNode) && !matchesCompound(child[2] as string, node);
  });
}

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
const watchButton = (root: FakeElement): FakeElement =>
  root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Watch')!;
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
  it('is off by default: the Watch button under Views reads not pressed, and nothing is stored', () => {
    expect(getFlag(PREF_KEYS.watchMode)).toBe(null);
    const { root } = mount();
    const button = watchButton(root);
    expect(classesOf(button)).toEqual(expect.arrayContaining(['hs-icon-btn', 'hs-round', 'hs-watch-btn']));
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.title).toBe(WATCH_TIP);
    expect(WATCH_TIP).toContain('5 seconds');
    // In the top bar, beside the Views button's row rather than inside it.
    const top = root.descendants().find((n) => n.className === 'hs-top') as FakeElement;
    expect(top.children).toContain(button);
    click(button);
    expect(PREF_KEYS.watchMode).toBe('hs.watchMode');
    expect([getFlag(PREF_KEYS.watchMode), button.getAttribute('aria-pressed')]).toEqual([true, 'true']);
  });

  it('the Watch button turns Watch mode off again, and follows the pref however it changes', () => {
    const { root, shell } = mount();
    const button = watchButton(root);
    click(button);
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true);
    click(button);
    expect([getFlag(PREF_KEYS.watchMode), button.getAttribute('aria-pressed'), watching(shell)]).toEqual([false, 'false', false]);
    setFlag(PREF_KEYS.watchMode, true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('Settings no longer has a Watch mode switch', () => {
    const ctx = { apply: () => ({ ok: true }), notice() {}, close() {}, reducedMotion: false, setReducedMotion() {} } as unknown as PanelContext;
    const panel = createSettingsPanel({ world: { seed: 1, log: [], logTotal: 0 } } as never, ctx) as unknown as FakeElement;
    expect(panel.descendants().some((n) => n.id === 'hs-watch-mode' || n.textContent === 'Watch mode')).toBe(false);
  });

  it('never hides the chrome while it is off', () => {
    const { shell } = mount();
    vi.advanceTimersByTime(5 * WATCH_IDLE_MS);
    expect(watching(shell)).toBe(false);
  });

  it('hides the chrome after 5 s without input when on, with a 400 ms fade', () => {
    expect([WATCH_IDLE_MS, WATCH_FADE_MS]).toEqual([5_000, 400]);
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
    expect(watching(shell)).toBe(false); // the tap restarted the 5 s
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

  it('turned on, hides at once after a 600 ms grace that the toggle tap\'s own pointer events do not cancel', () => {
    expect(WATCH_ENABLE_GRACE_MS).toBe(600);
    const { root, shell } = mount();
    click(watchButton(root));
    // The mouse leaves the button and the touch finishes, inside the grace.
    vi.advanceTimersByTime(100);
    dom.fireWindow('pointermove', { type: 'pointermove', clientX: 12, clientY: 12, pointerType: 'mouse', target: dom.body });
    const up = spied({ type: 'pointerup', pointerId: 3, pointerType: 'touch' });
    dom.fireWindow('pointerup', up);
    vi.advanceTimersByTime(WATCH_ENABLE_GRACE_MS - 101);
    expect(watching(shell)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(watching(shell)).toBe(true);
    // Later input brings the chrome back, and it steps aside again 5 s after the last input.
    dom.fireWindow('pointermove', { type: 'pointermove', clientX: 20, clientY: 20, pointerType: 'mouse', target: dom.body });
    expect(watching(shell)).toBe(false);
    vi.advanceTimersByTime(WATCH_IDLE_MS - 1);
    expect(watching(shell)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(watching(shell)).toBe(true);
  });

  it('follows the switch live: on hides after the grace, off brings everything back at once', () => {
    const { shell } = mount();
    setFlag(PREF_KEYS.watchMode, true);
    vi.advanceTimersByTime(WATCH_ENABLE_GRACE_MS);
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

  it('a restore press that makes no click (a drag) does not take the next tap\'s click, nor a key\'s', () => {
    setFlag(PREF_KEYS.watchMode, true);
    const { shell } = mount();
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    dom.fireWindow('pointerdown', spied({ type: 'pointerdown', pointerId: 7, pointerType: 'touch', clientX: 900, clientY: 40 }));
    dom.fireWindow('pointerup', spied({ type: 'pointerup', pointerId: 7, pointerType: 'touch' }));
    expect(watching(shell)).toBe(false);
    // No click came (the press moved); 100 ms on, well inside the grace, the player taps.
    vi.advanceTimersByTime(100);
    const down = spied({ type: 'pointerdown', pointerId: 9, pointerType: 'touch' });
    dom.fireWindow('pointerdown', down);
    dom.fireWindow('pointerup', spied({ type: 'pointerup', pointerId: 9, pointerType: 'touch' }));
    const clicked = spied({ type: 'click' });
    dom.fireWindow('click', clicked);
    expect([down.stopped, clicked.stopped]).toEqual([false, false]);

    // The same after a key: hidden again, a drag restores, then Enter on a button clicks it.
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true);
    dom.fireWindow('pointerdown', spied({ type: 'pointerdown', pointerId: 11, pointerType: 'mouse' }));
    dom.fireWindow('pointerup', spied({ type: 'pointerup', pointerId: 11, pointerType: 'mouse' }));
    vi.advanceTimersByTime(100);
    dom.fireWindow('keydown', spied({ type: 'keydown', key: 'Enter', code: 'Enter' }));
    const keyClick = spied({ type: 'click' });
    dom.fireWindow('click', keyClick);
    expect(keyClick.stopped).toBe(false);
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

  it('fades again after a panel opened and closed on its own, 5 s from the close', () => {
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

describe('watch mode keeps the chrome up while anything is open', () => {
  const byClass = (root: FakeElement, name: string): FakeElement => {
    const found = root.descendants().find((n) => classesOf(n).includes(name));
    if (!found) throw new Error(`no .${name}`);
    return found;
  };
  const phone = (): void => {
    (globalThis as unknown as { window: { innerWidth?: number } }).window.innerWidth = 390;
  };

  it('the Views list', () => {
    setFlag(PREF_KEYS.watchMode, true);
    const { shell } = mount();
    const views = byClass(shell, 'hs-views-btn');
    click(views); // no window input: as far as watch mode knows, the list is simply open
    expect(byClass(shell, 'hs-views-menu').hidden).toBe(false);
    vi.advanceTimersByTime(3 * WATCH_IDLE_MS);
    expect(watching(shell)).toBe(false);
    click(views);
    vi.advanceTimersByTime(2 * WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true); // closed, the chrome steps aside again
  });

  it('but not the build sheet in row view: it is not busy, and it closes as the chrome steps aside', () => {
    phone();
    setFlag(PREF_KEYS.watchMode, true);
    const { shell } = mount();
    click(byClass(shell, 'hs-build-fab'));
    expect(classesOf(byClass(shell, 'hs-palette'))).toContain('is-sheet-row');
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true);
    expect(classesOf(byClass(shell, 'hs-palette'))).not.toContain('is-sheet-row');
    expect(classesOf(shell)).not.toContain('is-building'); // the sheet is shut, not just faded
    expect(watching(shell)).toBe(true); // and its closing did not wake the chrome
  });

  it('turning Watch on over the row sheet closes it after the grace', () => {
    phone();
    const { root, shell } = mount();
    click(byClass(shell, 'hs-build-fab'));
    expect(classesOf(byClass(shell, 'hs-palette'))).toContain('is-sheet-row');
    click(watchButton(root));
    vi.advanceTimersByTime(WATCH_ENABLE_GRACE_MS);
    expect(watching(shell)).toBe(true);
    expect(classesOf(byClass(shell, 'hs-palette'))).not.toContain('is-sheet-row');
  });

  it('the build sheet in full view', () => {
    phone();
    setFlag(PREF_KEYS.watchMode, true);
    const { shell } = mount();
    click(byClass(shell, 'hs-build-fab'));
    click(byClass(shell, 'hs-build-handle'));
    expect(classesOf(byClass(shell, 'hs-palette'))).toContain('is-sheet-full');
    vi.advanceTimersByTime(3 * WATCH_IDLE_MS);
    expect(watching(shell)).toBe(false);
    click(byClass(shell, 'hs-build-fab')); // closed
    vi.advanceTimersByTime(2 * WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true);
  });

  it('the guide, and its end starts the 5 s over', () => {
    const store = (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage;
    store.setItem('hs.guide.done', 'false'); // an empty tower with the guide still to do
    setFlag(PREF_KEYS.watchMode, true);
    const { shell } = mount();
    const card = byClass(shell, 'hs-card');
    expect(classesOf(card)).not.toContain('is-hidden');
    expect(card.textContent).toContain('First tower');
    vi.advanceTimersByTime(3 * WATCH_IDLE_MS);
    expect(watching(shell)).toBe(false);
    const skip = card.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === 'Skip') as FakeElement;
    click(skip); // the guide ends by itself as far as watch mode knows: no window input
    vi.advanceTimersByTime(WATCH_IDLE_MS - 1);
    expect(watching(shell)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(watching(shell)).toBe(true);
  });
});

describe('watch mode on the page, with ui.css applied', () => {
  it('hides the chrome but the clock, and the hover card with it; any input brings them back', () => {
    // A real world with an office under the pointer, so the hover card is up when watching starts.
    const world = createWorld(3);
    const kind: RoomKind = 'office';
    const office = {
      id: allocId(world), kind, floor: 4, x: 100, width: ROOMS[kind].width, height: ROOMS[kind].height, eval: 0.72, tenants: [],
      occupancy: 0, builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
    };
    addRoom(world, office as never);
    const game = mkGame() as unknown as Record<string, unknown>;
    game['world'] = world;
    game['getHover'] = () => ({ floor: 4, x: 104 });
    setFlag(PREF_KEYS.watchMode, true);
    const root = dom.createElement('div');
    createUi(root as never, game as never, {} as never);
    const shell = root.children[0] as FakeElement;
    const find = (name: string): FakeElement => shell.descendants().find((n) => classesOf(n).includes(name)) as FakeElement;
    dom.fireWindow('pointermove', { type: 'pointermove', pointerType: 'mouse', clientX: 300, clientY: 300, target: { tagName: 'CANVAS' } });
    const hover = find('hs-hover-card');
    expect(classesOf(hover)).not.toContain('is-hidden'); // the office's card is up
    const clock = find('hs-status-clock');
    const parts = ['hs-status-cash', 'hs-top-actions', 'hs-watch-btn', 'hs-palette', 'hs-card', 'hs-hover-card'].map(find);
    expect([hiddenByWatch(hover), hiddenByWatch(clock)]).toEqual([false, false]);

    vi.advanceTimersByTime(WATCH_IDLE_MS);
    expect(parts.map(hiddenByWatch)).toEqual([true, true, true, true, true, true]);
    expect(hiddenByWatch(clock)).toBe(false);
    expect(watchRule().body).toContain('opacity: 0;');
    expect(watchRule().body).toContain('pointer-events: none;');
    // The fade they go with, on this shell: the full 400 ms without reduced motion.
    expect(resolvedVar(shell, '--watch-fade')).toBe(`${WATCH_FADE_MS}ms`);

    dom.fireWindow('pointermove', { type: 'pointermove', pointerType: 'mouse', clientX: 302, clientY: 300, target: { tagName: 'CANVAS' } });
    expect(parts.map(hiddenByWatch)).toEqual([false, false, false, false, false, false]);
  });

  it('under reduced motion hides at once: only the watch class goes on, nothing inline, and the fade is 0 ms', () => {
    const store = (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage;
    store.setItem(PREF_KEYS.reducedMotion, 'true');
    setFlag(PREF_KEYS.watchMode, true);
    const { shell } = mount();
    expect(classesOf(shell)).toContain('is-reduced');
    const before = classesOf(shell);
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    // One step, one class: no fading state in between and none added after.
    expect(classesOf(shell).sort()).toEqual([...before, WATCH_CLASS].sort());
    vi.advanceTimersByTime(WATCH_FADE_MS);
    expect(classesOf(shell).sort()).toEqual([...before, WATCH_CLASS].sort());
    // Nothing in the ui writes a transition or an animation inline: the stylesheet decides.
    for (const node of [shell, ...shell.descendants()]) {
      for (const key of Object.keys(node.style)) expect(key).not.toMatch(/transition|animation/i);
    }
    const palette = shell.descendants().find((n) => classesOf(n).includes('hs-palette')) as FakeElement;
    expect(hiddenByWatch(palette)).toBe(true);
    expect(watchRule().body).toContain('var(--watch-fade)');
    expect(resolvedVar(shell, '--watch-fade')).toBe('0ms');
  });

  it('hides the placing chip and bar; raises no news toast; an alert still shows and does not wake the chrome', () => {
    const world = createWorld(3);
    const subscribers = new Set<() => void>();
    const game = mkGame() as unknown as Record<string, unknown>;
    game['world'] = world;
    game['subscribe'] = (cb: () => void) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    };
    const notify = (): void => subscribers.forEach((cb) => cb());
    const root = dom.createElement('div');
    createUi(root as never, game as never, {} as never);
    const shell = root.children[0] as FakeElement;
    const find = (name: string): FakeElement => shell.descendants().find((n) => classesOf(n).includes(name)) as FakeElement;
    const newsToasts = (): FakeElement[] => shell.descendants().filter((n) => classesOf(n).includes('hs-news-toast'));

    setFlag(PREF_KEYS.watchMode, true);
    vi.advanceTimersByTime(WATCH_ENABLE_GRACE_MS);
    expect(watching(shell)).toBe(true);
    expect([hiddenByWatch(find('hs-place-bar')), hiddenByWatch(find('hs-place-chip'))]).toEqual([true, true]);

    // Even a notable line waits in the News panel while watching.
    log(world, 'The VIP checked into the suite on floor 9.', 'info', { notable: true });
    notify();
    expect(newsToasts()).toHaveLength(0);
    expect(world.log.at(-1)?.text).toBe('The VIP checked into the suite on floor 9.');

    log(world, 'Fire broke out in the office on floor 2.', 'alert');
    notify();
    const alerts = find('hs-alerts');
    expect(alerts.textContent).toContain('Fire');
    expect([hiddenByWatch(alerts), hiddenByWatch(find('hs-toasts')), watching(shell)]).toEqual([false, false, true]);

    // Watching off: the next notable line toasts again.
    setFlag(PREF_KEYS.watchMode, false);
    log(world, 'The wedding is over and the guests have left.', 'info', { notable: true });
    notify();
    expect(newsToasts().map((n) => n.textContent)).toEqual(['The wedding is over and the guests have left.']);
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
    for (const part of ['.hs-status-pill > :not(.hs-status-clock)', '.hs-top-actions', '.hs-watch-btn', '.hs-view-chip', '.hs-palette', '.hs-build-fab', '.hs-card', '.hs-minimap', '.hs-hover-card', '.hs-place-bar', '.hs-place-chip']) {
      expect(hide).toContain(part);
    }
    // The toasts' region (alert cards and alert toasts) is never in it.
    expect(hide).not.toMatch(/\.hs-(toasts|alerts|alert-toast|toast)\b/);
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
