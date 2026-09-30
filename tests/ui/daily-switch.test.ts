// Menu > Today's tower on a phone (Matt, 2026-09-26): the daily card that opening the daily puts
// up must close again. The open notifies (and mounts the card) before the tower switch finishes;
// the switch used to forget that sheet was mounted, so Close, Escape, the backdrop and the swipe
// all did nothing and the modal sheet trapped the game.
//
// Since 2026-09-30 the card is a page inside the pause card, said before the switch; the day
// chosen there switches towers and closes the menu, and no card comes up again on its own.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  const store = (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage;
  store.setItem('hs.intro.seen', 'true');
  store.setItem('hs.guide.done', 'true');
});
afterEach(() => uninstall());

const DAILY = { date: '2026-09-26', twist: { name: 'x', line: 'y' }, endMinute: 0, finished: false };

function mount(): { root: FakeElement; shell: FakeElement } {
  let slot = 'mine';
  let daily: typeof DAILY | null = null;
  const subscribers = new Set<() => void>();
  const notify = (): void => subscribers.forEach((cb) => cb());
  const game = {
    world: {
      seed: 1, cash: 1e6, population: 0, stars: 1, time: { minute: 0 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(),
      sims: new Map(), events: [], stats: { lastQuarter: null }, story: { followed: [], threads: {}, recent: [], seq: 0 },
    },
    subscribe(cb: () => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    subscribeEvents: () => () => {},
    getHover: () => null,
    getSpeed: () => 1,
    setSpeed: () => {},
    getTool: () => ({ kind: 'none' }),
    setTool: () => {},
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    select() {},
    setChrome: () => {},
    setReducedMotion: () => {},
    getSlot: () => slot,
    getDaily: () => daily,
    getDailyChoice: () => null,
    async openDaily() {
      slot = 'daily';
      daily = { ...DAILY };
      notify();
    },
    async openMyTower() {
      slot = 'mine';
      daily = null;
      notify();
    },
  };
  const root = dom.createElement('div');
  createUi(root as never, game as never, {} as never);
  return { root, shell: root.children[0]! };
}

function click(node: FakeElement): void {
  for (const fn of node.listeners.get('click') ?? []) fn({} as never);
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const dialogs = (root: FakeElement): FakeElement[] => root.descendants().filter((n) => n.getAttribute('role') === 'dialog');
const backdrops = (root: FakeElement): FakeElement[] =>
  root.descendants().filter((n) => n.className.split(/\s+/).includes('hs-sheet-backdrop'));

function button(within: FakeElement, test: (n: FakeElement) => boolean, what: string): FakeElement {
  const found = within.descendants().find((n) => n.tagName === 'BUTTON' && test(n));
  if (!found) throw new Error(`no ${what} button`);
  return found;
}

function menuRow(root: FakeElement, label: string): void {
  click(button(root, (n) => n.getAttribute('aria-label') === 'Menu', 'Menu'));
  const [menu] = dialogs(root);
  if (!menu) throw new Error('Menu did not open');
  click(button(menu, (n) => n.textContent === label, label));
}

async function openToday(root: FakeElement): Promise<FakeElement> {
  menuRow(root, "Today's tower");
  await settle();
  const open = dialogs(root);
  expect(open).toHaveLength(1);
  expect(open[0]!.className.split(/\s+/)).toContain('hs-pause-card');
  const heading = open[0]!.descendants().find((n) => /^H[1-6]$/.test(n.tagName));
  expect(heading?.textContent).toBe("Today's tower");
  return open[0]!;
}

function expectNothingOpen(root: FakeElement, shell: FakeElement): void {
  expect(dialogs(root)).toEqual([]);
  expect(backdrops(root)).toEqual([]);
  expect(shell.classList.contains('is-panel-open')).toBe(false);
}

describe("Menu > Today's tower", () => {
  it('opens the daily card as a page; choosing the day switches towers and leaves nothing open', async () => {
    const { root, shell } = mount();
    const card = await openToday(root);
    click(button(card, (n) => n.textContent === 'Start building', 'Start building'));
    await settle();
    expectNothingOpen(root, shell);
  });

  it("then Menu > My tower leaves nothing open", async () => {
    const { root, shell } = mount();
    const card = await openToday(root);
    click(button(card, (n) => n.textContent === 'Start building', 'Start building'));
    await settle();
    menuRow(root, 'My tower');
    await settle();
    expectNothingOpen(root, shell);
  });
});
