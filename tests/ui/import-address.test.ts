// Opening a saved file from a friend's tower lands it in My tower, so the address must drop the
// friend's ?seed= query, or a reload opens the friend's tower again (audit 2026-09-28, D S4).
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
const g = globalThis as Record<string, unknown>;
let addresses: string[] = [];
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  const store = (g['window'] as { localStorage: { setItem(k: string, v: string): void } }).localStorage;
  store.setItem('hs.intro.seen', 'true');
  store.setItem('hs.guide.done', 'true');
  addresses = [];
  g['location'] = { pathname: '/play/', search: '?seed=4242' };
  g['history'] = { replaceState: (_s: unknown, _t: string, url: string) => addresses.push(url) };
});
afterEach(() => {
  uninstall();
  delete g['location'];
  delete g['history'];
});

function mount(): { root: FakeElement } {
  let slot = 'friend';
  const subscribers = new Set<() => void>();
  const notify = (): void => subscribers.forEach((cb) => cb());
  const game = {
    world: {
      seed: 4242, cash: 1e6, population: 0, stars: 1, time: { minute: 0 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(),
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
    getDaily: () => null,
    getDailyChoice: () => null,
    exportSave: () => '{}',
    importSave() {
      slot = 'mine';
      notify();
      return { ok: true };
    },
  };
  const root = dom.createElement('div');
  createUi(root as never, game as never, {} as never);
  return { root };
}

const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((fn) => fn({} as never));
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function chooseFile(input: FakeElement): void {
  (input as unknown as { files: unknown[] }).files = [{ text: async () => '{"version":2}' }];
  for (const fn of input.listeners.get('change') ?? []) fn({} as never);
}

it('Menu > Open a saved file in a friend\'s tower points the address back at My tower', async () => {
  const { root } = mount();
  click(root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu')!);
  const input = root.descendants().find((n) => n.id === 'hs-import');
  expect(input?.tagName).toBe('INPUT');
  chooseFile(input!);
  await settle();
  await settle();
  expect(addresses.at(-1)).toBe('/play/');
});

it('the game over card\'s Open a saved file does the same', async () => {
  const { root } = mount();
  const input = root.descendants().find((n) => n.tagName === 'INPUT' && n.className === 'hs-file' && n.id !== 'hs-import');
  expect(input).toBeDefined();
  chooseFile(input!);
  await settle();
  await settle();
  expect(addresses.at(-1)).toBe('/play/');
});
