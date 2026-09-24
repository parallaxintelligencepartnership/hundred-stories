// The demo cap card on a fake DOM: what it says, and that the ui opens it once per session when a
// stub game logs demo cap refusals.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_CAP_REASON } from '../../src/sim/rules';
import type { LogEntry } from '../../src/sim/types';
import { createDemoCapCard, isDemoCapEntry } from '../../src/ui/demo';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

const cardsIn = (root: FakeElement): FakeElement[] =>
  root.descendants().filter((n) => n.className.split(' ').includes('hs-demo-cap'));

/** Just enough game for createUi: a world with a log, and a subscribe the test can fire. */
function stubGame(): { api: never; world: { log: LogEntry[]; logTotal: number }; push(entry: LogEntry): void } {
  const subscribers = new Set<() => void>();
  const world = {
    cash: 1_000_000,
    population: 0,
    stars: 1,
    time: { minute: 0 },
    log: [] as LogEntry[],
    logTotal: 0,
    rooms: new Map(),
    shafts: new Map(),
    sims: new Map(),
    events: [],
  };
  const api = {
    world,
    subscribe(cb: () => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
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
  } as never;
  return {
    api,
    world,
    push(entry) {
      world.log.push(entry);
      world.logTotal += 1;
      subscribers.forEach((cb) => cb());
    },
  };
}

const capRefusal: LogEntry = { minute: 0, text: DEMO_CAP_REASON, level: 'warn' };

describe('the demo cap card', () => {
  it('knows a demo cap refusal from any other refusal', () => {
    expect(isDemoCapEntry(capRefusal)).toBe(true);
    expect(isDemoCapEntry({ text: 'Something is already there.', level: 'warn' })).toBe(false);
    expect(isDemoCapEntry({ text: DEMO_CAP_REASON, level: 'info' })).toBe(false);
  });

  it('says where the demo stops, names the stores, and shows empty links as coming soon', () => {
    const host = dom.createElement('div');
    const card = createDemoCapCard(host as never);
    expect(card.offer()).toBe(true);
    const text = host.textContent;
    expect(text).toContain('20 floors');
    expect(text).toContain('150 tiles');
    expect(text).toContain('the App Store and Google Play');
    expect(text).toContain('App Store: coming soon');
    expect(text).toContain('Google Play: coming soon');
    expect(text).not.toContain('Steam');
    expect(host.descendants().some((n) => n.tagName === 'A')).toBe(false);
  });

  it('sets no inline style: the store row is laid out by the ui.css rule', () => {
    const host = dom.createElement('div');
    createDemoCapCard(host as never).offer();
    const nodes = host.descendants();
    expect(nodes.some((n) => n.className.split(' ').includes('hs-demo-stores'))).toBe(true);
    const styled = nodes.filter(
      (n) => n.attributes.has('style') || Object.keys(n.style).some((key) => key !== 'setProperty'),
    );
    expect(styled.map((n) => n.className)).toEqual([]);

    const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
    const rule = /\.hs-demo-cap \.hs-demo-stores \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('display: flex;');
    expect(rule).toContain('flex-direction: column;');
    expect(rule).toContain('gap: 4px;');
    expect(rule).toContain('margin: 12px 0;');
  });

  it('opens once: a second offer does nothing, even after it was closed', () => {
    const host = dom.createElement('div');
    const card = createDemoCapCard(host as never);
    expect(card.offer()).toBe(true);
    card.close();
    expect(cardsIn(host)).toHaveLength(0);
    expect(card.offer()).toBe(false);
    expect(cardsIn(host)).toHaveLength(0);
  });

  it('appears once per session when the stub game logs demo cap refusals', () => {
    const game = stubGame();
    const root = dom.createElement('div');
    const ui = createUi(root as never, game.api, {} as never);
    game.push({ minute: 0, text: 'Something is already there.', level: 'warn' });
    expect(cardsIn(root)).toHaveLength(0);
    game.push(capRefusal);
    expect(cardsIn(root)).toHaveLength(1);
    game.push(capRefusal);
    game.push(capRefusal);
    expect(cardsIn(root)).toHaveLength(1);
    ui.destroy();
  });
});
