// Pages in the pause card (Matt, 2026-09-30: "the pause menu is fine but the sub menus inside of
// them are still disjointed and pull up from the bottom and arent styled to match"). Settings,
// Stories, Share and Today's tower open inside .hs-pause-card: no sheet, no backdrop, the scrim
// and the pause stay. The plate names the page, a round Back sits at its left, the body's rows
// are the card's faces. Back or Escape goes back one page, the scrim closes everything.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyPeek } from '../../src/game/api';
import type { CommandResult } from '../../src/sim/types';
import { createPauseMenu, PAUSED_WORD, wearFaces, type PausePage } from '../../src/ui/pause-menu';
import { createUi } from '../../src/ui/ui';
import { FakeDom, choosePauseEntry, pauseEntry, type FakeElement } from './fake-dom';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  dom = new FakeDom();
  uninstall = dom.install();
  const win = (globalThis as unknown as { window: Record<string, unknown> & { localStorage: { setItem(k: string, v: string): void } } }).window;
  win.localStorage.setItem('hs.intro.seen', 'true');
  win.localStorage.setItem('hs.guide.done', 'true');
  win['innerWidth'] = 1280;
  win['innerHeight'] = 800;
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

const has = (n: FakeElement, c: string): boolean => n.className.split(/\s+/).includes(c);
const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((f) => f({ target: node }));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

function key(name: string, extra: Record<string, unknown> = {}): { defaultPrevented: boolean } {
  const event = {
    key: name,
    code: name === ' ' ? 'Space' : name,
    target: dom.activeElement ?? dom.body,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {},
    ...extra,
  };
  dom.fireWindow('keydown', event);
  return event;
}

function mount(opts: { speed?: number; peek?: DailyPeek | null } = {}) {
  const state = { speed: opts.speed ?? 2, slot: 'mine', daily: null as null | { date: string; twist: { name: string; line: string }; endMinute: number; finished: boolean } };
  const calls: string[] = [];
  const subscribers = new Set<() => void>();
  const notify = (): void => subscribers.forEach((cb) => cb());
  let choice: { savedDate: string; today: string; yesterday: boolean; ahead: boolean } | null = null;
  const game = {
    world: {
      seed: 1, cash: 1e6, population: 0, stars: 1, time: { minute: 12 * 60 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(),
      sims: new Map(), events: [], stats: { lastQuarter: null, vipRating: 'none', weddingsHeld: 0 },
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
      notify();
    },
    togglePause: () => {},
    getTool: () => ({ kind: 'none' }),
    setTool: () => {},
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    setChrome: () => {},
    setReducedMotion: () => {},
    getSlot: () => state.slot,
    getDaily: () => state.daily,
    getDailyChoice: () => choice,
    select() {},
    exportSave: () => '',
    save: async (): Promise<CommandResult> => ({ ok: true }),
    ...(opts.peek === null
      ? {}
      : {
          peekDaily: async () => {
            calls.push('peekDaily');
            return opts.peek ?? { today: '2026-09-30', opening: 'fresh', savedDate: null, savedUnfinished: false, yesterday: false, result: null };
          },
        }),
    async openDaily() {
      calls.push('openDaily');
      state.slot = 'daily';
      const peek = opts.peek;
      if (peek?.opening === 'choose') choice = { savedDate: peek.savedDate!, today: peek.today, yesterday: peek.yesterday, ahead: false };
      state.daily = { date: peek?.savedDate ?? '2026-09-30', twist: { name: 'Normal day', line: 'x' }, endMinute: 0, finished: false };
      state.speed = choice ? 0 : 1;
      notify();
    },
    async chooseDaily(which: string) {
      calls.push(`chooseDaily:${which}`);
      choice = null;
      state.daily = { date: '2026-09-30', twist: { name: 'Normal day', line: 'x' }, endMinute: 0, finished: false };
      state.speed = 1;
      notify();
    },
    openMyTower: async () => {
      calls.push('openMyTower');
    },
  };
  const root = dom.createElement('div');
  createUi(root as never, game as never, { snapshot: () => { throw new Error('no canvas'); } } as never);
  const menuButton = root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu')!;
  const card = (): FakeElement | undefined => root.descendants().find((n) => has(n, 'hs-pause-card'));
  const plateTitle = (): string | undefined => card()?.descendants().find((n) => has(n, 'hs-plate-title'))?.textContent;
  const back = (): FakeElement => card()!.descendants().find((n) => n.getAttribute('aria-label') === 'Back')!;
  const page = (): FakeElement | undefined => card()?.descendants().find((n) => has(n, 'hs-pause-page'));
  const named = (words: string): FakeElement => {
    const found = card()!.descendants().find((n) => (n.tagName === 'BUTTON' || n.tagName === 'A') && n.textContent === words);
    if (!found) throw new Error(`no ${words} on the page`);
    return found;
  };
  const open = (): void => {
    menuButton.focus();
    click(menuButton);
  };
  return { game, state, calls, root, menuButton, card, plateTitle, back, page, named, open };
}

describe('Settings, a page in the card', () => {
  it('opens inside .hs-pause-card with no sheet and no backdrop; the plate reads Settings over Paused, Back at its left', () => {
    const ui = mount({ speed: 2 });
    ui.open();
    choosePauseEntry(ui.root, 'settings');
    expect(ui.root.descendants().some((n) => has(n, 'hs-sheet') || has(n, 'hs-sheet-backdrop'))).toBe(false);
    const card = ui.card()!;
    expect(has(card.parentNode!, 'hs-pause')).toBe(true); // the scrim stays
    expect(has(card, 'is-page')).toBe(true);
    expect(card.getAttribute('data-page')).toBe('settings');
    expect(card.contains(ui.root.descendants().find((n) => has(n, 'hs-set-main')))).toBe(true);
    expect(ui.plateTitle()).toBe('Settings');
    expect(card.descendants().find((n) => has(n, 'hs-plate-state'))?.textContent).toBe(PAUSED_WORD);
    // The page takes the column's place: the root's entries are not in the card.
    expect(card.descendants().some((n) => has(n, 'hs-pause-item'))).toBe(false);
    const back = ui.back();
    expect(back.hidden).toBe(false);
    expect(back.parentNode && has(back.parentNode, 'hs-plate')).toBe(true);
    expect(back.descendants().some((n) => n.tagName === 'USE')).toBe(true);
    // Focus on the page's first control; the game stays paused.
    expect(dom.activeElement?.textContent).toBe('Save now');
    expect(ui.state.speed).toBe(0);
  });

  it('wears the faces: each row a face, the switch row one face, Theme three faces side by side', () => {
    const ui = mount();
    ui.open();
    choosePauseEntry(ui.root, 'settings');
    const page = ui.page()!;
    expect(has(ui.named('Save now'), 'hs-face')).toBe(true);
    const motion = page.descendants().find((n) => n.id === 'hs-reduced-motion')!;
    expect(has(motion.parentNode!, 'hs-face')).toBe(true);
    const theme = page.descendants().find((n) => has(n, 'hs-segmented'))!;
    expect(theme.children.map((b) => has(b, 'hs-face'))).toEqual([true, true, true]);
    expect(has(theme.parentNode!, 'hs-face')).toBe(false);
    // No head band and no Close: Back replaces them.
    expect(page.descendants().some((n) => has(n, 'hs-panel-head') || has(n, 'hs-panel-close'))).toBe(false);
  });

  it('Back returns to the root list with focus on the Settings entry, still paused', () => {
    const ui = mount({ speed: 2 });
    ui.open();
    choosePauseEntry(ui.root, 'settings');
    click(ui.back());
    expect(has(ui.card()!, 'is-page')).toBe(false);
    expect(ui.plateTitle()).toBe('Hundred Stories');
    expect(ui.back().hidden).toBe(true);
    expect(dom.activeElement).toBe(pauseEntry(ui.root, 'settings'));
    expect(has(pauseEntry(ui.root, 'settings')!, 'is-selected')).toBe(true);
    expect(ui.state.speed).toBe(0);
  });

  it('Escape on a page goes back one page; Escape at the root resumes with the speed from before', () => {
    const ui = mount({ speed: 4 });
    ui.open();
    choosePauseEntry(ui.root, 'settings');
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(ui.card()).toBeDefined();
    expect(ui.plateTitle()).toBe('Hundred Stories');
    expect(ui.state.speed).toBe(0);
    key('Escape');
    expect(ui.card()).toBeUndefined();
    expect(ui.state.speed).toBe(4);
    expect(dom.activeElement).toBe(ui.menuButton);
  });

  it('a tap on the scrim from a page closes everything and gives the speed back', () => {
    const ui = mount({ speed: 2 });
    ui.open();
    choosePauseEntry(ui.root, 'settings');
    click(ui.named('Controls'));
    const scrim = ui.card()!.parentNode!;
    (scrim.listeners.get('click') ?? []).forEach((f) => f({ target: scrim }));
    expect(ui.card()).toBeUndefined();
    expect(ui.root.descendants().some((n) => has(n, 'hs-settings') || has(n, 'hs-help-controls'))).toBe(false);
    expect(ui.state.speed).toBe(2);
    // Opened again, it starts at the root.
    ui.open();
    expect(ui.plateTitle()).toBe('Hundred Stories');
    expect(ui.card()!.descendants().some((n) => has(n, 'hs-pause-item'))).toBe(true);
  });

  it('Controls is a page under Settings: Back returns to Settings on the Controls row, then to the menu', () => {
    const ui = mount();
    ui.open();
    choosePauseEntry(ui.root, 'settings');
    const row = ui.named('Controls');
    click(row);
    expect(ui.plateTitle()).toBe('Controls');
    expect(ui.card()!.getAttribute('data-page')).toBe('controls');
    expect(ui.card()!.descendants().some((n) => has(n, 'hs-help-controls'))).toBe(true);
    expect(ui.card()!.descendants().some((n) => has(n, 'hs-set-main'))).toBe(false);
    click(ui.back());
    expect(ui.plateTitle()).toBe('Settings');
    expect(dom.activeElement).toBe(row);
    click(ui.back());
    expect(ui.plateTitle()).toBe('Hundred Stories');
  });

  it("keys on a page: Down and Up move through its controls in order, Back first; Enter presses the one with focus", () => {
    const ui = mount();
    ui.open();
    choosePauseEntry(ui.root, 'settings');
    expect(dom.activeElement?.textContent).toBe('Save now');
    key('ArrowUp');
    expect(dom.activeElement).toBe(ui.back());
    key('ArrowDown');
    key('ArrowDown');
    expect(dom.activeElement?.textContent).toBe('Go back to last save');
    key('Enter');
    expect(dom.clicked.at(-1)?.textContent).toBe('Go back to last save');
    // The tower's keys stay out: the menu holds the speed.
    key('.');
    expect(ui.state.speed).toBe(0);
  });
});

describe('Stories and Share, pages too', () => {
  it('Stories opens as a page with its sections, no sheet', () => {
    const ui = mount();
    ui.open();
    choosePauseEntry(ui.root, 'stories');
    expect(ui.root.descendants().some((n) => has(n, 'hs-sheet'))).toBe(false);
    expect(ui.plateTitle()).toBe('Stories');
    const titles = ui.page()!.descendants().filter((n) => has(n, 'hs-section-title')).map((n) => n.textContent);
    expect(titles).toEqual(expect.arrayContaining(['Following', 'Around the tower']));
    // No controls on it yet: focus waits on Back.
    expect(dom.activeElement).toBe(ui.back());
  });

  it('Share (a phone entry) opens as a page, its buttons faces', () => {
    (globalThis as unknown as { window: Record<string, unknown> }).window['innerWidth'] = 390;
    const ui = mount();
    ui.open();
    choosePauseEntry(ui.root, 'share');
    expect(ui.root.descendants().some((n) => has(n, 'hs-sheet'))).toBe(false);
    expect(ui.plateTitle()).toBe('Share');
    const copy = ui.named('Copy message');
    expect(has(copy, 'hs-face')).toBe(true);
    expect(ui.page()!.descendants().some((n) => has(n, 'hs-share-text'))).toBe(true);
  });
});

describe("Today's tower, a page before the switch", () => {
  it('shows the start card without switching; Start building switches, closes the menu, and no card comes up again', async () => {
    const ui = mount({ speed: 2 });
    ui.open();
    choosePauseEntry(ui.root, 'daily');
    await settle();
    expect(ui.calls).toEqual(['peekDaily']);
    expect(ui.plateTitle()).toBe("Today's tower");
    expect(ui.page()!.textContent).toContain('Everyone gets the same start today.');
    expect(ui.state.slot).toBe('mine');
    click(ui.named('Start building'));
    await settle();
    expect(ui.calls).toEqual(['peekDaily', 'openDaily']);
    expect(ui.card()).toBeUndefined();
    expect(ui.state.slot).toBe('daily');
    expect(ui.root.descendants().some((n) => n.getAttribute('role') === 'dialog')).toBe(false);
  });

  it("offers yesterday's unfinished tower or today's; Start today's switches and answers the choice in one go", async () => {
    const ui = mount({ peek: { today: '2026-09-30', opening: 'choose', savedDate: '2026-09-29', savedUnfinished: true, yesterday: true, result: null } });
    ui.open();
    choosePauseEntry(ui.root, 'daily');
    await settle();
    expect(ui.page()!.textContent).toContain("You did not finish yesterday's tower yet.");
    expect(has(ui.named("Finish yesterday's"), 'hs-face')).toBe(true);
    click(ui.named("Start today's"));
    await settle();
    expect(ui.calls).toEqual(['peekDaily', 'openDaily', 'chooseDaily:today']);
    expect(ui.card()).toBeUndefined();
    expect(ui.root.descendants().some((n) => n.getAttribute('role') === 'dialog')).toBe(false);
  });

  it('a game that cannot read ahead shows the start card at once', () => {
    const ui = mount({ peek: null });
    ui.open();
    choosePauseEntry(ui.root, 'daily');
    expect(ui.plateTitle()).toBe("Today's tower");
    expect(ui.named('Start building')).toBeDefined();
  });

  it('a day already played offers nothing but Back', async () => {
    const ui = mount({ peek: { today: '2026-09-30', opening: 'done', savedDate: null, savedUnfinished: false, yesterday: false, result: null } });
    ui.open();
    choosePauseEntry(ui.root, 'daily');
    await settle();
    expect(ui.page()!.descendants().some((n) => n.tagName === 'BUTTON')).toBe(false);
    expect(dom.activeElement).toBe(ui.back());
  });
});

describe('the page stack itself', () => {
  it('lets go of each page when it is popped or the menu closes', () => {
    const host = dom.createElement('div');
    let speed = 2;
    const menu = createPauseMenu({
      host: host as never,
      getSpeed: () => speed as never,
      setSpeed: (s) => (speed = s),
      entries: () => [{ id: 'resume', label: 'Resume', icon: 'play', kind: 'resume' }],
      returnFocus: () => null,
    });
    const gone: string[] = [];
    const page = (id: string): PausePage => ({
      id,
      title: id,
      build: () => dom.createElement('div') as never,
      onBack: () => gone.push(`back:${id}`),
      dispose: () => gone.push(`dispose:${id}`),
    });
    menu.pushPage(page('closed')); // not open: nothing
    expect(menu.page()).toBeNull();
    menu.open();
    menu.pushPage(page('a'));
    menu.pushPage(page('b'));
    expect(menu.popPage()).toBe(true);
    expect(gone).toEqual(['back:b', 'dispose:b']);
    menu.close();
    expect(gone).toEqual(['back:b', 'dispose:b', 'dispose:a']);
    expect(menu.page()).toBeNull();
    expect(menu.popPage()).toBe(false);
    expect(speed).toBe(2);
  });

  it('wearFaces turns rows and buttons into faces, not the theme holder or the Controls lines', () => {
    const root = dom.createElement('div');
    const make = (cls: string): FakeElement => {
      const n = dom.createElement('div');
      n.className = cls;
      root.append(n);
      return n;
    };
    const row = make('hs-set-row hs-set-action');
    const choice = make('hs-set-row hs-set-choice');
    const line = make('hs-set-row hs-controls-row');
    const btn = make('hs-btn');
    wearFaces(root);
    expect([row, choice, line, btn].map((n) => has(n, 'hs-face'))).toEqual([true, false, false, true]);
  });
});

describe('the look of a page', () => {
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };

  it('widens the card to 440 on a page, easing the width on --motion-fast, and not at all under reduced motion', () => {
    expect(rule('.hs-pause-card.is-page')).toMatch(/width: min\(440px, 100%\);/);
    expect(rule('.hs-pause-card')).toMatch(/width: min\(360px, 100%\);/);
    expect(rule('.hs-pause-card')).toMatch(/transition: width var\(--motion-fast\)/);
    expect(rule('.hs-ui.is-reduced .hs-pause-card')).toMatch(/transition: none;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.hs-pause-card \{\s*animation: none;\s*transition: none;/);
  });

  it('crossfades a page in on --motion-fast, and not under reduced motion', () => {
    expect(rule('.hs-pause-list')).toMatch(/animation: hs-pause-swap var\(--motion-fast\)/);
    expect(css).toMatch(/@keyframes hs-pause-swap \{\s*from \{\s*opacity: 0;/);
    expect(rule('.hs-ui.is-reduced .hs-pause-list')).toMatch(/animation: none;/);
  });

  it('puts a round 44 px Back at the plate\'s left, out of the flow', () => {
    const back = rule('.hs-pause-back');
    expect(back).toMatch(/position: absolute;/);
    expect(back).toMatch(/left: 0;/);
    expect(back).toMatch(/width: var\(--touch\);[\s\S]*height: var\(--touch\);/);
    expect(back).toMatch(/border-radius: 50%;/);
    expect(rule('.hs-pause-plate')).toMatch(/position: relative;/);
  });
});
