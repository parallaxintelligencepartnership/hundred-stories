// The log and room panels on a fake DOM: what a refresh builds, and what it leaves alone.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogPanel, createQueryPanel, createSettingsPanel, LOG_PANEL_LINES, type PanelContext } from '../../src/ui/panels';
import type { Sound } from '../../src/audio/audio';
import { RENT } from '../../src/sim/rules';
import type { LogEntry } from '../../src/sim/types';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

const ctx: PanelContext = {
  apply: () => ({ ok: true }) as never,
  notice: () => {},
  close: () => {},
  reducedMotion: false,
  setReducedMotion: () => {},
};

function logGame(): { game: never; world: { log: LogEntry[]; logTotal: number }; push(n: number): void } {
  const world = { log: [] as LogEntry[], logTotal: 0 };
  return {
    game: { world } as never,
    world,
    push(n: number) {
      for (let i = 0; i < n; i += 1) {
        world.log.push({ minute: 0, text: `line ${world.logTotal}`, level: 'info' });
        world.logTotal += 1;
      }
    },
  };
}

const node = (panel: unknown): FakeElement => panel as FakeElement;

function listOf(panel: unknown): FakeElement {
  const list = node(panel).descendants().find((n) => n.className === 'hs-log-list');
  if (!list) throw new Error('no log list');
  return list;
}

const texts = (list: FakeElement): string[] =>
  list.children.map((li) => li.children[1]?.textContent ?? li.textContent);

describe('log panel', () => {
  it('appends each new line on top and caps the list, even after 300 lines', () => {
    const { game, push } = logGame();
    const panel = createLogPanel(game, ctx);
    const list = listOf(panel);
    expect(list.children.map((c) => c.textContent)).toEqual(['Nothing has happened yet.']);
    for (let i = 0; i < 300; i += 1) {
      push(1);
      panel.refresh?.();
    }
    expect(list.children.length).toBe(LOG_PANEL_LINES);
    expect(texts(list)[0]).toBe('line 299');
    expect(texts(list)[LOG_PANEL_LINES - 1]).toBe('line 100');
    // Everything in the panel: the header (a title and a close button), the body, the list,
    // and three nodes per line (the li, its time and its text).
    expect(node(panel).descendants().length).toBe(3 + 1 + 1 + LOG_PANEL_LINES * 3);
  });

  it('builds only the lines that landed, and keeps the ones already shown', () => {
    const { game, push } = logGame();
    push(50);
    const panel = createLogPanel(game, ctx);
    const list = listOf(panel);
    const before = [...list.children];
    dom.created = 0;
    push(3);
    panel.refresh?.();
    expect(dom.created).toBe(3 * 3); // three li, each with a time and a text span
    expect(texts(list).slice(0, 4)).toEqual(['line 52', 'line 51', 'line 50', 'line 49']);
    expect(list.children.slice(3)).toEqual(before);
  });

  it('a refresh with no new line builds nothing', () => {
    const { game, push } = logGame();
    push(10);
    const panel = createLogPanel(game, ctx);
    dom.created = 0;
    panel.refresh?.();
    expect(dom.created).toBe(0);
  });

  it('rebuilds from the log when a load swaps it for another world', () => {
    const { game, world, push } = logGame();
    push(10);
    const panel = createLogPanel(game, ctx);
    world.log = [{ minute: 0, text: 'loaded', level: 'info' }];
    world.logTotal = 12;
    panel.refresh?.();
    expect(texts(listOf(panel))).toEqual(['loaded']);
  });

  it('a burst past the cap rebuilds to the newest 200', () => {
    const { game, push } = logGame();
    push(5);
    const panel = createLogPanel(game, ctx);
    push(250);
    panel.refresh?.();
    const list = listOf(panel);
    expect(list.children.length).toBe(LOG_PANEL_LINES);
    expect(texts(list)[0]).toBe('line 254');
  });
});

describe('room panel flags', () => {
  function roomGame(): { game: never; room: Record<string, unknown> } {
    const room: Record<string, unknown> = {
      id: 1,
      kind: 'office',
      floor: 2,
      height: 1,
      eval: 0.8,
      tenants: [],
      occupancy: 0,
      vacant: true,
      dirty: false,
      infested: false,
      onFire: false,
      rent: RENT.default,
    };
    return { game: { world: { rooms: new Map([[1, room]]), shafts: new Map(), sims: new Map() } } as never, room };
  }

  const flags = (panel: unknown): FakeElement[] =>
    node(panel).descendants().filter((n) => n.className.startsWith('hs-flag'));

  it('builds no flag spans on a refresh where the flags did not change', () => {
    const { game } = roomGame();
    const panel = createQueryPanel(game, { roomId: 1 }, ctx);
    expect(flags(panel).map((n) => n.textContent)).toEqual(['Vacant']);
    dom.created = 0;
    panel.refresh?.();
    panel.refresh?.();
    expect(dom.created).toBe(0);
  });

  it('rebuilds the flags when the string changes', () => {
    const { game, room } = roomGame();
    const panel = createQueryPanel(game, { roomId: 1 }, ctx);
    room['vacant'] = false;
    room['onFire'] = true;
    panel.refresh?.();
    expect(flags(panel).map((n) => [n.textContent, n.className])).toEqual([['On fire', 'hs-flag is-alert']]);
  });
});

describe('settings panel sound section', () => {
  function stubSound() {
    const calls: string[] = [];
    const settings = { on: false, effects: 70, ambient: 50 };
    const sound: Sound = {
      settings,
      hasContext: false,
      setEnabled: (on) => {
        settings.on = on;
        calls.push(`on:${on}`);
      },
      setEffects: (n) => calls.push(`effects:${n}`),
      setAmbient: (n) => calls.push(`ambient:${n}`),
      destroy: () => {},
    };
    return { sound, calls };
  }
  const fire = (target: FakeElement, type: string): void => {
    for (const fn of target.listeners.get(type) ?? []) fn({});
  };
  const settingsGame = { world: { seed: 1, log: [], logTotal: 0 } } as never;

  it('shows the switch off and both levels disabled by default, and wires them to the sound module', () => {
    const { sound, calls } = stubSound();
    const panel = node(createSettingsPanel(settingsGame, { ...ctx, sound }));
    const all = panel.descendants();
    expect(all.some((n) => n.className === 'hs-section-title' && n.textContent === 'Sound')).toBe(true);
    const box = all.find((n) => n.id === 'hs-sound') as unknown as FakeElement & { checked: boolean };
    const effects = all.find((n) => n.id === 'hs-sound-effects') as unknown as FakeElement & { value: string; disabled: boolean };
    const ambient = all.find((n) => n.id === 'hs-sound-ambient') as unknown as FakeElement & { value: string; disabled: boolean };
    expect(box.checked).toBe(false);
    expect([effects.value, ambient.value]).toEqual(['70', '50']);
    expect([effects.disabled, ambient.disabled]).toEqual([true, true]);

    box.checked = true;
    fire(box, 'change');
    expect([effects.disabled, ambient.disabled]).toEqual([false, false]);
    effects.value = '25';
    fire(effects, 'input');
    ambient.value = '0';
    fire(ambient, 'input');
    expect(calls).toEqual(['on:true', 'effects:25', 'ambient:0']);
  });

  it('has no sound section when the shell made no sound module', () => {
    const panel = node(createSettingsPanel(settingsGame, ctx));
    expect(panel.descendants().some((n) => n.textContent === 'Sound')).toBe(false);
  });
});
