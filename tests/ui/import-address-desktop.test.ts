// The desktop (Tauri) dialog import in the Menu points the address back at My tower after a
// successful import, and leaves it alone when the file is refused (audit 2026-09-28, D S4; the
// menu input and game-over paths are in import-address.test.ts).
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../src/game/storage', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  importSaveWithDialog: async () => '{"version":2}',
}));

import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement, choosePauseEntry } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
const g = globalThis as Record<string, unknown>;
let addresses: string[] = [];
let notices: string[] = [];
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  const store = (g['window'] as { localStorage: { setItem(k: string, v: string): void } }).localStorage;
  store.setItem('hs.intro.seen', 'true');
  store.setItem('hs.guide.done', 'true');
  addresses = [];
  g['__TAURI_INTERNALS__'] = {};
  g['location'] = { pathname: '/play/', search: '?seed=4242' };
  g['history'] = { replaceState: (_s: unknown, _t: string, url: string) => addresses.push(url) };
});
afterEach(() => {
  uninstall();
  delete g['location'];
  delete g['history'];
  delete g['__TAURI_INTERNALS__'];
});

function mount(ok: boolean): { root: FakeElement; slot: () => string } {
  let slot = 'friend';
  const subscribers = new Set<() => void>();
  const notify = (): void => subscribers.forEach((cb) => cb());
  const game = {
    world: {
      seed: 4242, cash: 1e6, population: 0, stars: 1, time: { minute: 0 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(),
      sims: new Map(), events: [], stats: { lastQuarter: null }, story: { followed: [], threads: {}, recent: [], seq: 0 },
    },
    subscribe(cb: () => void) { subscribers.add(cb); return () => subscribers.delete(cb); },
    subscribeEvents: () => () => {},
    getHover: () => null, getSpeed: () => 1, setSpeed: () => {}, getTool: () => ({ kind: 'none' }), setTool: () => {},
    getPlacement: () => null, getPlacementRect: () => null, getSelection: () => null, select() {},
    setChrome: () => {}, setReducedMotion: () => {}, getSlot: () => slot, getDaily: () => null, getDailyChoice: () => null,
    exportSave: () => '{}',
    async importSave() {
      if (!ok) return { ok: false, reason: 'This file is not a Hundred Stories save.' };
      slot = 'mine';
      notify();
      return { ok: true };
    },
  };
  const root = dom.createElement('div');
  createUi(root as never, game as never, {} as never);
  return { root, slot: () => slot };
}

const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((fn) => fn({} as never));
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

it('desktop dialog: Menu > Settings > Open a saved file in a friend tower points the address back at My tower', async () => {
  const { root, slot } = mount(true);
  click(root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu')!);
  choosePauseEntry(root, 'settings');
  const pick = root.descendants().find((n) => n.id === 'hs-import');
  expect(pick?.tagName).toBe('BUTTON');
  click(pick!);
  for (let i = 0; i < 5; i++) await settle();
  expect(addresses.at(-1)).toBe('/play/');
});

it('desktop dialog: a refused file leaves the address alone', async () => {
  const { root } = mount(false);
  click(root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu')!);
  choosePauseEntry(root, 'settings');
  const pick = root.descendants().find((n) => n.id === 'hs-import');
  click(pick!);
  for (let i = 0; i < 5; i++) await settle();
  expect(addresses).toEqual([]);
});
