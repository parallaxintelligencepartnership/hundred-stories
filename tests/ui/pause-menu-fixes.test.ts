// The pause menu's P4 review fixes (2026-09-29, decided by the PM on Matt's delegation):
// - I1: while the menu is open, with Settings over it too, speed keys, the speed pill and the
//   controller's shoulders change nothing, and Resume gives back the speed from before it opened.
// - I2: on a phone held sideways (844 by 390) the entry column scrolls, and moving the selection
//   by key or controller brings the entry into the column's view; the plate stays put.
// - I3: in the app shells How to play opens the site's guide in the system browser.
// - I4: the third entry reads "New tower" in My tower and asks first, inside the card.
// - Save asks first only while My tower's save could not be opened (all three Saves).
// - The first-run hint steps under the night speed chip while both are up on a wide screen.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../../src/sim/types';
import { PAD_BUTTONS, type PadLike } from '../../src/ui/gamepad';
import { NEW_TOWER_NO, NEW_TOWER_QUESTION, NEW_TOWER_YES } from '../../src/ui/pause-menu';
import { HOW_TO_PLAY_URL } from '../../src/ui/panels';
import { HELD_SAVE_NO, HELD_SAVE_QUESTION, HELD_SAVE_YES, SAVED_NOTICE } from '../../src/ui/save-button';
import { createUi } from '../../src/ui/ui';
import { FakeDom, choosePauseEntry, pauseEntry, type FakeElement } from './fake-dom';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');

let dom: FakeDom;
let uninstall: () => void;
let savedNav: PropertyDescriptor | undefined;
const g = globalThis as unknown as Record<string, unknown>;
beforeEach(() => {
  vi.useFakeTimers();
  dom = new FakeDom();
  uninstall = dom.install();
  savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const win = g['window'] as Record<string, unknown> & { localStorage: { setItem(k: string, v: string): void } };
  win.localStorage.setItem('hs.intro.seen', 'true');
  win.localStorage.setItem('hs.guide.done', 'true');
  win['innerWidth'] = 1280;
  win['innerHeight'] = 800;
});
afterEach(() => {
  uninstall();
  if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav);
  delete g['__TAURI_INTERNALS__'];
  delete g['Capacitor'];
  vi.useRealTimers();
});

const has = (n: FakeElement, c: string): boolean => n.className.split(/\s+/).includes(c);
const click = (node: FakeElement, event: Record<string, unknown> = {}): void =>
  (node.listeners.get('click') ?? []).forEach((f) => f({ target: node, preventDefault() {}, ...event }));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

function key(name: string): { defaultPrevented: boolean } {
  const event = {
    key: name,
    code: name === ' ' ? 'Space' : name === '.' ? 'Period' : name === ',' ? 'Comma' : name,
    target: dom.activeElement ?? dom.body,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {},
  };
  dom.fireWindow('keydown', event);
  return event;
}

function pad(held: (keyof typeof PAD_BUTTONS)[] = []): PadLike {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const name of held) buttons[PAD_BUTTONS[name]] = { pressed: true, value: 1 };
  return { connected: true, axes: [0, 0, 0, 0], buttons };
}

function mkGame(opts: { speed?: number; slot?: string; held?: boolean; minute?: number } = {}) {
  const state = { speed: opts.speed ?? 2, held: opts.held ?? false };
  const calls: string[] = [];
  const subscribers = new Set<() => void>();
  const save = vi.fn(async (): Promise<CommandResult> => {
    state.held = false; // as game.ts: the player's save lifts the hold
    return { ok: true };
  });
  const game = {
    world: {
      seed: 1, cash: 1e6, population: 0, stars: 1, time: { minute: opts.minute ?? 12 * 60 }, log: [], logTotal: 0, rooms: new Map(),
      shafts: new Map(), sims: new Map(), events: [], stats: { lastQuarter: null, vipRating: 'none', weddingsHeld: 0 },
      story: { followed: [], threads: {}, recent: [], seq: 0 },
    },
    subscribe(cb: () => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    getHover: () => null,
    getSpeed: () => state.speed,
    setSpeed(speed: number) {
      state.speed = speed;
      subscribers.forEach((cb) => cb());
    },
    togglePause() {
      state.speed = state.speed === 0 ? 1 : 0;
    },
    getTool: () => ({ kind: 'none' }),
    setTool() {},
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    setChrome: () => {},
    setReducedMotion: () => {},
    getSlot: () => opts.slot ?? 'mine',
    getDaily: () => null,
    getDailyChoice: () => null,
    select() {},
    exportSave: () => '',
    save,
    saveHeld: () => state.held,
    load: async () => ({ ok: true }),
    newGame: (n: number) => calls.push(`newGame:${n}`),
    openDaily: async () => {
      calls.push('openDaily');
    },
    openMyTower: async () => {
      calls.push('openMyTower');
    },
  };
  return { game, state, calls, save };
}

function mount(opts: Parameters<typeof mkGame>[0] = {}) {
  const made = mkGame(opts);
  const root = dom.createElement('div');
  createUi(root as never, made.game as never, {} as never);
  const shell = root.children[0]!;
  const menuButton = root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu')!;
  const card = (): FakeElement | undefined => root.descendants().find((n) => has(n, 'hs-pause-card'));
  const items = (): FakeElement[] => root.descendants().filter((n) => has(n, 'hs-pause-item'));
  const words = (): string[] => items().map((n) => n.textContent);
  const selected = (): string | undefined => items().find((n) => has(n, 'is-selected'))?.textContent;
  const open = (): void => {
    menuButton.focus();
    click(menuButton);
  };
  const notices = (): string[] => root.descendants().filter((n) => n.children.length === 0).map((n) => n.textContent);
  return { ...made, root, shell, menuButton, card, items, words, selected, open, notices };
}

function openSettingsOverMenu(ui: ReturnType<typeof mount>): FakeElement {
  ui.open();
  choosePauseEntry(ui.root, 'settings');
  const settings = ui.root.descendants().find((n) => has(n, 'hs-settings'))!;
  expect(settings).toBeDefined();
  expect(ui.card()).toBeUndefined();
  return settings;
}

describe('I1: the menu holds the speed', () => {
  it('with Settings over the menu, speed keys, Space and the speed pill change nothing, and Resume gives back the speed from before', () => {
    const ui = mount({ speed: 2 });
    const settings = openSettingsOverMenu(ui);
    expect(ui.state.speed).toBe(0);
    key('.');
    key(',');
    key(' ');
    expect(ui.state.speed).toBe(0);
    const fast = ui.root.descendants().find((n) => has(n, 'hs-speed-btn') && n.getAttribute('aria-label') === 'Faster')!;
    click(fast);
    expect(ui.state.speed).toBe(0);
    click(settings.descendants().find((n) => has(n, 'hs-panel-close'))!);
    expect(ui.card()).toBeDefined();
    expect(ui.card()!.descendants().find((n) => has(n, 'hs-pause-state'))?.textContent).toBe('Paused');
    choosePauseEntry(ui.root, 'resume');
    expect(ui.state.speed).toBe(2);
    // Closed, the keys and the pill are the speed's again.
    key('.');
    expect(ui.state.speed).toBe(4);
    click(ui.root.descendants().find((n) => has(n, 'hs-speed-btn') && n.getAttribute('aria-label') === 'Play')!);
    expect(ui.state.speed).toBe(1);
  });

  it("the controller's shoulders change nothing while the menu is open, and B gives back the speed from before", () => {
    const pads: PadLike[] = [];
    Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
    const ui = mount({ speed: 2 });
    pads.push(pad(['start']));
    dom.fireWindow('gamepadconnected');
    dom.runFrame();
    expect(ui.card()).toBeDefined();
    expect(ui.state.speed).toBe(0);
    for (const shoulder of ['rb', 'lb', 'rb'] as const) {
      pads[0] = pad([]);
      dom.runFrame();
      pads[0] = pad([shoulder]);
      dom.runFrame();
    }
    expect(ui.state.speed).toBe(0);
    expect(ui.card()!.descendants().find((n) => has(n, 'hs-pause-state'))?.textContent).toBe('Paused');
    pads[0] = pad([]);
    dom.runFrame();
    pads[0] = pad(['b']);
    dom.runFrame();
    expect(ui.card()).toBeUndefined();
    expect(ui.state.speed).toBe(2);
    // Closed, RB steps the speed again.
    pads[0] = pad([]);
    dom.runFrame();
    pads[0] = pad(['rb']);
    dom.runFrame();
    expect(ui.state.speed).toBe(4);
  });
});

describe('I2: a phone held sideways, 844 by 390', () => {
  /** A declaration's value in the first rule for exactly this selector. */
  const decl = (selector: string, prop: string): string | undefined => {
    const at = css.indexOf(`\n${selector} {`);
    if (at < 0) return undefined;
    const body = css.slice(at, css.indexOf('}', at));
    return new RegExp(`\\n\\s*${prop}: ([^;]+);`).exec(body)?.[1];
  };

  it('scrolls the entry column, not the card, with no bar drawn; the plate keeps its height', () => {
    expect(decl('.hs-pause-card', 'overflow')).toBe('hidden');
    expect(decl('.hs-pause-card', 'max-height')).toBe('100%');
    expect(decl('.hs-pause-list', 'overflow-y')).toBe('auto');
    expect(decl('.hs-pause-list', 'min-height')).toBe('0');
    expect(decl('.hs-pause-list', 'flex')).toBe('0 1 auto');
    expect(decl('.hs-pause-list', 'scrollbar-width')).toBe('none');
    expect(css).toMatch(/\n\.hs-pause-list::-webkit-scrollbar \{\s*display: none;/);
    expect(decl('.hs-pause-plate', 'flex')).toBe('none');
  });

  it('End, then Up and Down, keep the selected entry inside the column; the last entry can be chosen', () => {
    const win = g['window'] as Record<string, unknown>;
    win['innerWidth'] = 844;
    win['innerHeight'] = 390;
    const ui = mount();
    ui.open();
    expect(ui.words()).toEqual(['Resume', 'Save', 'New tower', "Today's tower", 'Stories', 'Settings', 'How to play']);
    // The layout at 844 by 390, from ui.css: 12 px edges, the card's 20 and 16 px padding, the
    // plate (69 px), the 16 px gap; the column gets what is left and scrolls. Entries are 48 px
    // with 8 px between.
    const list = ui.card()!.descendants().find((n) => has(n, 'hs-pause-list'))! as FakeElement & { scrollTop: number };
    const columnTop = 12 + 20 + 69 + 16;
    const columnBottom = 390 - 12 - 16;
    expect(columnBottom - columnTop).toBeLessThan(7 * 48 + 6 * 8); // it does not fit
    list.getBoundingClientRect = () => ({ top: columnTop, bottom: columnBottom, left: 0, right: 328, width: 328, height: columnBottom - columnTop });
    ui.items().forEach((item, i) => {
      item.getBoundingClientRect = () => {
        const top = columnTop + i * 56 - (Number(list.scrollTop) || 0);
        return { top, bottom: top + 48, left: 0, right: 328, width: 328, height: 48 };
      };
    });
    const inside = (): boolean => {
      const item = ui.items().find((n) => has(n, 'is-selected'))!;
      const r = item.getBoundingClientRect();
      return r.top >= columnTop && r.bottom <= columnBottom;
    };
    key('End');
    expect(ui.selected()).toBe('How to play');
    expect(inside()).toBe(true);
    key('Home');
    expect(ui.selected()).toBe('Resume');
    expect(inside()).toBe(true);
    for (let i = 0; i < 6; i += 1) {
      key('ArrowDown');
      expect(inside()).toBe(true);
    }
    expect(ui.selected()).toBe('How to play');
    // A focus from elsewhere (the controller's d-pad focuses the entry) scrolls it in too.
    key('Home');
    ui.items()[5]!.focus();
    for (const f of ui.items()[5]!.listeners.get('focus') ?? []) f({});
    expect(ui.selected()).toBe('Settings');
    expect(inside()).toBe(true);
    // The pointer does not scroll the column under itself.
    const before = list.scrollTop;
    for (const f of ui.items()[0]!.listeners.get('pointermove') ?? []) f({});
    expect(ui.selected()).toBe('Resume');
    expect(list.scrollTop).toBe(before);
  });
});

describe('I3: How to play in the app shells', () => {
  for (const [shell, install] of [
    ['Tauri', () => (g['__TAURI_INTERNALS__'] = {})],
    ['Capacitor', () => (g['Capacitor'] = { isNativePlatform: () => true })],
  ] as const) {
    it(`in ${shell}, the menu entry and the Settings row open the site's guide in the system browser`, () => {
      install();
      const open = vi.fn();
      (g['window'] as Record<string, unknown>)['open'] = open;
      const ui = mount();
      ui.open();
      const entry = pauseEntry(ui.root, 'guide')!;
      expect(entry.tagName).toBe('BUTTON');
      choosePauseEntry(ui.root, 'guide');
      expect(open).toHaveBeenCalledWith(HOW_TO_PLAY_URL, '_blank');
      expect(HOW_TO_PLAY_URL).toBe('https://hundredstories.xyz/how-to-play/');
      expect(ui.card()).toBeDefined();
      expect(ui.state.speed).toBe(0);
      open.mockClear();
      choosePauseEntry(ui.root, 'settings');
      const row = ui.root.descendants().find((n) => has(n, 'hs-link') && n.textContent === 'How to play')! as FakeElement & { href: string };
      expect(row.href).toBe(HOW_TO_PLAY_URL);
      const prevented = { value: false };
      click(row, { preventDefault: () => (prevented.value = true) });
      expect(prevented.value).toBe(true);
      expect(open).toHaveBeenCalledWith(HOW_TO_PLAY_URL, '_blank');
    });
  }

  it('on the web both stay same-site links in a new tab', () => {
    const open = vi.fn();
    (g['window'] as Record<string, unknown>)['open'] = open;
    const ui = mount();
    ui.open();
    const entry = pauseEntry(ui.root, 'guide') as FakeElement & { href: string; target: string };
    expect([entry.tagName, entry.href, entry.target]).toEqual(['A', '/how-to-play/', '_blank']);
    choosePauseEntry(ui.root, 'settings');
    const row = ui.root.descendants().find((n) => has(n, 'hs-link') && n.textContent === 'How to play')! as FakeElement & { href: string };
    expect(row.href).toBe('/how-to-play/');
    click(row);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('I4: the third entry', () => {
  it('reads My tower from Today\'s tower and a friend\'s tower, and just switches', () => {
    for (const slot of ['daily', 'friend']) {
      const ui = mount({ slot });
      ui.open();
      expect(ui.words()[2]).toBe('My tower');
      choosePauseEntry(ui.root, 'myTower');
      expect(ui.card()).toBeUndefined();
      expect(ui.calls).toContain('openMyTower');
    }
  });

  it('reads New tower in My tower and asks first in the card; Keep my tower keeps it and goes back to the list', () => {
    const ui = mount({ speed: 2 });
    ui.open();
    expect(ui.words()[2]).toBe('New tower');
    expect(pauseEntry(ui.root, 'newGame')).toBeUndefined();
    choosePauseEntry(ui.root, 'newTower');
    expect(ui.calls).toEqual([]);
    const card = ui.card()!;
    expect(card.getAttribute('data-question')).toBe('newTower');
    expect(card.descendants().find((n) => has(n, 'hs-pause-question'))?.textContent).toBe(NEW_TOWER_QUESTION);
    expect(NEW_TOWER_QUESTION).toBe('Start over? This replaces My tower.');
    expect(ui.words()).toEqual([NEW_TOWER_YES, NEW_TOWER_NO]);
    expect([NEW_TOWER_YES, NEW_TOWER_NO]).toEqual(['Start over', 'Keep my tower']);
    // The safe answer is the one selected: Enter keeps the tower.
    expect(ui.selected()).toBe('Keep my tower');
    key('Enter');
    expect(ui.calls).toEqual([]);
    expect(ui.card()!.getAttribute('data-question')).toBeNull();
    expect(ui.words()[2]).toBe('New tower');
    expect(ui.selected()).toBe('New tower');
    expect(ui.state.speed).toBe(0);
    // Escape inside the question backs out too; a second Escape resumes.
    choosePauseEntry(ui.root, 'newTower');
    key('Escape');
    expect(ui.card()).toBeDefined();
    expect(ui.words()[2]).toBe('New tower');
    key('Escape');
    expect(ui.card()).toBeUndefined();
    expect(ui.calls).toEqual([]);
    expect(ui.state.speed).toBe(2);
  });

  it('only Start over runs the fresh start: the menu closes, the speed comes back, the notice is said', () => {
    const ui = mount({ speed: 2 });
    ui.open();
    const realNow = Date.now;
    Date.now = () => 1_758_700_000_123;
    try {
      choosePauseEntry(ui.root, 'newTower');
      choosePauseEntry(ui.root, 'yes');
    } finally {
      Date.now = realNow;
    }
    expect(ui.card()).toBeUndefined();
    expect(ui.calls).toEqual(['newGame:123']);
    expect(ui.state.speed).toBe(2);
    expect(ui.notices()).toContain('New game started.');
  });
});

describe('Save while My tower\'s save could not be opened', () => {
  it('the pause menu Save asks first; Keep the old one saves nothing, Save anyway saves once and the menu stays', async () => {
    const ui = mount({ held: true });
    ui.open();
    choosePauseEntry(ui.root, 'save');
    expect(ui.save).not.toHaveBeenCalled();
    const card = ui.card()!;
    expect(card.getAttribute('data-question')).toBe('heldSave');
    expect(card.descendants().find((n) => has(n, 'hs-pause-question'))?.textContent).toBe(HELD_SAVE_QUESTION);
    expect(HELD_SAVE_QUESTION).toBe('Your saved tower could not be opened. Saving now replaces it.');
    expect(ui.words()).toEqual(['Save anyway', 'Keep the old one']);
    expect(ui.selected()).toBe(HELD_SAVE_NO);
    choosePauseEntry(ui.root, 'no');
    await settle();
    expect(ui.save).not.toHaveBeenCalled();
    expect(ui.selected()).toBe('Save');
    choosePauseEntry(ui.root, 'save');
    choosePauseEntry(ui.root, 'yes');
    await settle();
    expect(ui.save).toHaveBeenCalledTimes(1);
    expect(ui.card()).toBeDefined();
    expect(pauseEntry(ui.root, 'save')!.textContent).toBe('Saved');
    expect(ui.notices()).toContain(SAVED_NOTICE);
    // The hold is lifted by that save: the next Save is one tap again.
    choosePauseEntry(ui.root, 'save');
    await settle();
    expect(ui.save).toHaveBeenCalledTimes(2);
  });

  it('the round Save button asks in the pause card, which its answer closes, the speed given back', async () => {
    const ui = mount({ held: true, speed: 2 });
    const button = ui.root.descendants().find((n) => has(n, 'hs-save-btn'))!;
    click(button);
    expect(ui.save).not.toHaveBeenCalled();
    expect(ui.card()?.getAttribute('data-question')).toBe('heldSave');
    expect(ui.state.speed).toBe(0);
    choosePauseEntry(ui.root, 'no');
    await settle();
    expect(ui.card()).toBeUndefined();
    expect(ui.save).not.toHaveBeenCalled();
    expect(ui.state.speed).toBe(2);
    click(button);
    choosePauseEntry(ui.root, 'yes');
    await settle();
    expect(ui.card()).toBeUndefined();
    expect(ui.save).toHaveBeenCalledTimes(1);
    expect(ui.state.speed).toBe(2);
    expect(ui.notices()).toContain(SAVED_NOTICE);
  });

  it('Settings, Save now asks in place; either answer puts the row back, and only Save anyway saves', async () => {
    const ui = mount({ held: true });
    const settings = openSettingsOverMenu(ui);
    const row = settings.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === 'Save now')!;
    click(row);
    expect(ui.save).not.toHaveBeenCalled();
    const ask = settings.descendants().find((n) => has(n, 'hs-set-ask'))!;
    expect(ask.hidden).toBe(false);
    expect(row.hidden).toBe(true);
    expect(ask.descendants().find((n) => has(n, 'hs-set-ask-text'))?.textContent).toBe(HELD_SAVE_QUESTION);
    const answers = ask.descendants().filter((n) => n.tagName === 'BUTTON');
    expect(answers.map((n) => n.textContent)).toEqual([HELD_SAVE_YES, HELD_SAVE_NO]);
    expect(dom.activeElement).toBe(answers[1]);
    click(answers[1]!);
    await settle();
    expect(ui.save).not.toHaveBeenCalled();
    expect([ask.hidden, row.hidden]).toEqual([true, false]);
    click(row);
    click(ask.descendants().filter((n) => n.tagName === 'BUTTON')[0]!);
    await settle();
    expect(ui.save).toHaveBeenCalledTimes(1);
    expect(ui.notices()).toContain(SAVED_NOTICE);
  });

  it('in every other state each Save is one tap', async () => {
    const ui = mount({ held: false });
    click(ui.root.descendants().find((n) => has(n, 'hs-save-btn'))!);
    await settle();
    expect(ui.save).toHaveBeenCalledTimes(1);
    expect(ui.card()).toBeUndefined();
    ui.open();
    choosePauseEntry(ui.root, 'save');
    await settle();
    expect(ui.save).toHaveBeenCalledTimes(2);
    const settings = (choosePauseEntry(ui.root, 'settings'), ui.root.descendants().find((n) => has(n, 'hs-settings'))!);
    vi.advanceTimersByTime(5_000);
    click(settings.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === 'Save now')!);
    await settle();
    expect(ui.save).toHaveBeenCalledTimes(3);
  });
});

describe('the first-run hint and the night speed chip', () => {
  it('while both are up the hint takes the row under the chip, where the chip hangs under a wide bar', () => {
    const night = 23 * 60;
    const ui = mount({ minute: night, speed: 1 });
    const hint = ui.shell.children.find((n) => has(n, 'hs-hint'))!;
    const chip = ui.root.descendants().find((n) => has(n, 'hs-speed-mode'))!;
    expect(has(hint, 'is-hidden')).toBe(false);
    expect(has(chip, 'is-hidden')).toBe(false);
    expect(has(ui.shell, 'is-hint-low')).toBe(true);
    // Closing the hint lets it go.
    click(hint.descendants().find((n) => has(n, 'hs-hint-close'))!);
    expect(has(ui.shell, 'is-hint-low')).toBe(false);
  });

  it('by day, with no chip, the hint stays in its row', () => {
    const ui = mount({ speed: 1 });
    const hint = ui.shell.children.find((n) => has(n, 'hs-hint'))!;
    expect(has(hint, 'is-hidden')).toBe(false);
    expect(has(ui.shell, 'is-hint-low')).toBe(false);
  });

  it('the step is one row, only in the layouts where the chip hangs under the bar', () => {
    const step = /\+ 2 \* var\(--gap-float\) \+ var\(--chip-h, 0px\) \+ var\(--touch\)\);/;
    const wide = /@media \(min-width: 1040px\) \{\s*:root:not\(\.hs-large-text\) \.hs-ui\.is-hint-low \.hs-hint \{\s*top: ([^;]+;)/.exec(css);
    const large = /@media \(min-width: 1300px\) \{\s*:root\.hs-large-text \.hs-ui\.is-hint-low \.hs-hint \{\s*top: ([^;]+;)/.exec(css);
    expect(wide?.[1]).toMatch(step);
    expect(large?.[1]).toMatch(step);
    // The chip's own row there: under the bar, a view's chip above it.
    expect(css).toMatch(/:root:not\(\.hs-large-text\) \.hs-speed-mode \{\s*top: calc\(100% \+ var\(--gap-float\) \+ var\(--chip-h, 0px\)\);/);
  });
});
