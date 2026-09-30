// The elevator card (panels.ts shaftPanel) in the pause menu's look, with honest rider words
// (Matt, 2026-09-29: "Those riders first"). A car's rider setting is a priority, not a lock:
// - each car has three faces, Everyone, Hotel guests first and Office staff first, in a radio
//   group named for that car; a tap sends one shaft.setCarServes straight to that choice, never
//   through the one between, and the stored choice shows when the card opens again;
// - while a car serves some riders first, one line under its choices says what that means;
// - when other tenants' routed trips ride this elevator on a kept car as leftovers (no Everyone
//   car or car of their own covers the ride), one line warns that they will wait longer;
// - the card neither pauses the game, nor dims the tower, nor holds focus.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame } from '../../src/game/game';
import { applyCommand } from '../../src/sim/build';
import type { Command } from '../../src/sim/types';
import { addRoom, addShaft, allocId, createWorld } from '../../src/sim/world';
import type { Room, RoomKind, Shaft } from '../../src/sim/types';
import { ROOMS, SHAFTS } from '../../src/sim/rules';
import { resetEventTestHooks } from '../../src/sim/events';
import { createQueryPanel, type PanelContext } from '../../src/ui/panels';
import { othersWaitLonger, RIDER_LABEL, RIDER_NOTE, RIDER_WARNING } from '../../src/ui/riders';
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
  resetEventTestHooks();
});
afterEach(() => {
  uninstall();
  resetEventTestHooks();
});

const has = (n: FakeElement, c: string): boolean => n.className.split(/\s+/).includes(c);
const click = (n: FakeElement): void => (n.listeners.get('click') ?? []).forEach((fn) => fn({} as never));
const setWidth = (width: number): void => {
  (globalThis as unknown as { window: Record<string, unknown> }).window['innerWidth'] = width;
};

/** A lobby, an office and a hotel room on 2, and a standard elevator 1 to 3 with `cars` cars. */
function tower(cars = 1) {
  const world = createWorld(7);
  world.cash = 50_000_000;
  world.stars = 3;
  for (let x = 0; x < 40; x += 1) applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x });
  expect(applyCommand(world, { kind: 'build', room: 'office', floor: 2, x: 0 }).ok).toBe(true);
  expect(applyCommand(world, { kind: 'build', room: 'hotelSingle', floor: 2, x: 30 }).ok).toBe(true);
  expect(applyCommand(world, { kind: 'shaft.build', shaft: 'standard', x: 20, floorMin: 1, floorMax: 3 }).ok).toBe(true);
  const shaftId = [...world.shafts.keys()][0]!;
  for (let i = 1; i < cars; i += 1) expect(applyCommand(world, { kind: 'shaft.addCar', shaftId }).ok).toBe(true);
  return { world, shaftId, shaft: world.shafts.get(shaftId)! };
}

/** The panel over a real world; every command is recorded and applied. */
function open(world: ReturnType<typeof tower>['world'], shaftId: number) {
  const sent: Command[] = [];
  const ctx: PanelContext = {
    apply: (cmd: Command) => {
      sent.push(cmd);
      return applyCommand(world, cmd);
    },
    notice: () => {},
    close: () => {},
    reducedMotion: false,
    setReducedMotion: () => {},
  };
  const game = { world, canExtend: () => ({ ok: true }) } as never;
  const panel = createQueryPanel(game, { shaftId }, ctx) as unknown as FakeElement & { refresh(): void; sheet: { mount(h: unknown): void; handleKey(e: unknown): boolean; backdrop: FakeElement } };
  const groups = (): FakeElement[] => panel.descendants().filter((n) => n.getAttribute('role') === 'radiogroup');
  const choices = (car: number): FakeElement[] => groups()[car]!.children.filter((n) => n.getAttribute('role') === 'radio');
  const choice = (car: number, label: string): FakeElement => choices(car).find((n) => n.textContent === label)!;
  const checked = (car: number): string[] => choices(car).filter((n) => n.getAttribute('aria-checked') === 'true').map((n) => n.textContent);
  const notes = (): string[] => panel.descendants().filter((n) => has(n, 'hs-rider-note') && !n.hidden).map((n) => n.textContent);
  const warning = (): FakeElement => panel.descendants().find((n) => has(n, 'hs-elevator-warning'))!;
  return { panel, sent, groups, choices, choice, checked, notes, warning };
}

describe('the rider choice', () => {
  it('is three faces per car in a radio group named for that car, with the new words', () => {
    const { world, shaftId } = tower(2);
    const card = open(world, shaftId);
    expect(card.groups().map((g) => g.getAttribute('aria-label'))).toEqual(['Who car 1 serves first', 'Who car 2 serves first']);
    expect(card.choices(0).map((n) => n.textContent)).toEqual(['Everyone', 'Hotel guests first', 'Office staff first']);
    expect(Object.values(RIDER_LABEL)).toEqual(['Everyone', 'Hotel guests first', 'Office staff first']);
    for (const n of card.choices(0)) {
      expect(n.tagName).toBe('BUTTON');
      expect(has(n, 'hs-face')).toBe(true);
    }
    expect(card.checked(0)).toEqual(['Everyone']);
    // The choice made is the one tab stop; the arrow keys reach the others.
    expect(card.choices(0).map((n) => (n as unknown as { tabIndex: number }).tabIndex)).toEqual([0, -1, -1]);
    // The car's name sits over its choices, in words: which car the setting belongs to.
    const labels = card.panel.descendants().filter((n) => has(n, 'hs-car-label')).map((n) => n.textContent);
    expect(labels).toEqual(['Car 1 · Floors 1–3', 'Car 2 · Floors 1–3']);
    // No cycling button is left.
    expect(card.panel.descendants().some((n) => n.textContent.startsWith('Serves'))).toBe(false);
  });

  it('sends one command per choice, straight to it, for that car only; choosing the current one sends none', () => {
    const { world, shaftId, shaft } = tower(2);
    const card = open(world, shaftId);
    click(card.choice(1, 'Office staff first'));
    expect(card.sent).toEqual([{ kind: 'shaft.setCarServes', shaftId, carId: shaft.cars[1]!.id, serves: 'office' }]);
    card.panel.refresh();
    expect([card.checked(0), card.checked(1)]).toEqual([['Everyone'], ['Office staff first']]);
    click(card.choice(1, 'Office staff first'));
    expect(card.sent).toHaveLength(1);
    // Office staff first back to Everyone: one command, never through Hotel guests first.
    click(card.choice(1, 'Everyone'));
    expect(card.sent.slice(1)).toEqual([{ kind: 'shaft.setCarServes', shaftId, carId: shaft.cars[1]!.id, serves: 'any' }]);
    expect(card.sent.some((c) => c.kind === 'shaft.setCarServes' && c.serves === 'hotel')).toBe(false);
  });

  it('shows the stored choice of each car when the card opens again', () => {
    const { world, shaftId, shaft } = tower(3);
    applyCommand(world, { kind: 'shaft.setCarServes', shaftId, carId: shaft.cars[0]!.id, serves: 'hotel' });
    applyCommand(world, { kind: 'shaft.setCarServes', shaftId, carId: shaft.cars[2]!.id, serves: 'office' });
    const card = open(world, shaftId);
    expect([card.checked(0), card.checked(1), card.checked(2)]).toEqual([['Hotel guests first'], ['Everyone'], ['Office staff first']]);
  });
});

describe('the note and the warning', () => {
  it('says what "first" means under a car that serves some riders first, and nothing under Everyone', () => {
    const { world, shaftId } = tower(2);
    const card = open(world, shaftId);
    expect(card.notes()).toEqual([]);
    click(card.choice(0, 'Hotel guests first'));
    card.panel.refresh();
    expect(card.notes()).toEqual([RIDER_NOTE]);
    expect(RIDER_NOTE).toBe('These riders go first. Others ride when the car is free, so they may wait longer.');
    // The old promise is gone.
    expect(card.panel.descendants().some((n) => n.textContent.includes('picks up anyone else'))).toBe(false);
  });

  it('warns once when no car carries everyone and other tenants on its floors depend on it', () => {
    const { world, shaftId, shaft } = tower(2);
    const card = open(world, shaftId);
    expect(card.warning().hidden).toBe(true);
    click(card.choice(0, 'Hotel guests first'));
    card.panel.refresh();
    expect(card.warning().hidden).toBe(true); // car 2 still carries everyone
    click(card.choice(1, 'Hotel guests first'));
    card.panel.refresh();
    // The office on 2 is not the hotel's, and only this elevator reaches it.
    expect([card.warning().hidden, card.warning().textContent]).toEqual([false, RIDER_WARNING]);
    expect(RIDER_WARNING).toBe('Other tenants on these floors will wait longer for this elevator.');
    expect(card.panel.descendants().filter((n) => n.textContent === RIDER_WARNING)).toHaveLength(1);
    // One car each for the two groups on its floors: nobody else depends on it.
    click(card.choice(1, 'Office staff first'));
    card.panel.refresh();
    expect(card.warning().hidden).toBe(true);
    expect(shaft.cars.map((c) => c.serves)).toEqual(['hotel', 'office']);
  });

  it('decides from the trips other tenants plan and the other elevators', () => {
    const { world, shaft } = tower(1);
    const serve = (serves: 'any' | 'hotel' | 'office'): void => {
      expect(applyCommand(world, { kind: 'shaft.setCarServes', shaftId: shaft.id, carId: shaft.cars[0]!.id, serves }).ok).toBe(true);
    };
    serve('office');
    expect(othersWaitLonger(world, shaft)).toBe(true); // the hotel room on 2
    serve('hotel');
    expect(othersWaitLonger(world, shaft)).toBe(true); // the office on 2
    // Another elevator with an Everyone car stopping on 2 carries them.
    expect(applyCommand(world, { kind: 'shaft.build', shaft: 'standard', x: 36, floorMin: 1, floorMax: 2 }).ok).toBe(true);
    expect(othersWaitLonger(world, shaft)).toBe(false);
  });

  it('stays quiet on a hotel elevator beside an office elevator, where each tenant has a car of its own (P6-I3)', () => {
    const { world, shaft: hotel } = tower(1);
    expect(applyCommand(world, { kind: 'shaft.build', shaft: 'standard', x: 36, floorMin: 1, floorMax: 3 }).ok).toBe(true);
    const office = [...world.shafts.values()].find((s) => s !== hotel)!;
    const serve = (shaft: Shaft, serves: 'any' | 'hotel' | 'office'): void => {
      expect(applyCommand(world, { kind: 'shaft.setCarServes', shaftId: shaft.id, carId: shaft.cars[0]!.id, serves }).ok).toBe(true);
    };
    serve(hotel, 'hotel');
    serve(office, 'office');
    // The office's staff ride the office car and the guests the hotel car: nobody waits longer.
    expect([othersWaitLonger(world, hotel), othersWaitLonger(world, office)]).toEqual([false, false]);
    // A home on 3 is nobody's group, and neither elevator carries everyone: the elevator its
    // residents' trip rides warns (routing plans them on one of the two, as a leftover).
    expect(applyCommand(world, { kind: 'build', room: 'condo', floor: 3, x: 0 }).ok).toBe(true);
    expect([othersWaitLonger(world, hotel), othersWaitLonger(world, office)].filter(Boolean)).toHaveLength(1);
    // Turned back to Everyone, the other elevator carries the home, so the hotel card is quiet.
    serve(office, 'any');
    expect(othersWaitLonger(world, hotel)).toBe(false);
  });

  it('never warns for a trip an Everyone car of the shaft covers; warns for floors past its range (closeout 0.6.11)', () => {
    // The sweep's probe: car A Everyone on floors 1-3, car B Hotel guests first on the whole
    // shaft 1-6. The warning it saw came from offices on 4-6, which only the hotel car reaches.
    const world = createWorld(7);
    world.cash = 50_000_000;
    world.stars = 3;
    for (let x = 0; x < 40; x += 1) applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x });
    for (const floor of [2, 3]) expect(applyCommand(world, { kind: 'build', room: 'office', floor, x: 0 }).ok).toBe(true);
    expect(applyCommand(world, { kind: 'shaft.build', shaft: 'standard', x: 20, floorMin: 1, floorMax: 6 }).ok).toBe(true);
    const shaft = [...world.shafts.values()][0]!;
    expect(applyCommand(world, { kind: 'shaft.addCar', shaftId: shaft.id }).ok).toBe(true);
    const [a, b] = shaft.cars;
    expect(applyCommand(world, { kind: 'shaft.setCarRange', shaftId: shaft.id, carId: a!.id, range: { lo: 1, hi: 3 } }).ok).toBe(true);
    expect(applyCommand(world, { kind: 'shaft.setCarServes', shaftId: shaft.id, carId: b!.id, serves: 'hotel' }).ok).toBe(true);
    // Every office trip ends on 2 or 3, inside the Everyone car's floors: quiet.
    expect(othersWaitLonger(world, shaft)).toBe(false);
    // Offices on 4-6 are past car A, so their staff ride the hotel car as leftovers: it warns.
    for (const floor of [4, 5, 6]) expect(applyCommand(world, { kind: 'build', room: 'office', floor, x: 0 }).ok).toBe(true);
    expect(othersWaitLonger(world, shaft)).toBe(true);
    // Car A stretched to the whole shaft covers every trip again: quiet.
    expect(applyCommand(world, { kind: 'shaft.setCarRange', shaftId: shaft.id, carId: a!.id, range: { lo: 1, hi: 6 } }).ok).toBe(true);
    expect(othersWaitLonger(world, shaft)).toBe(false);
  });

  it('warns on an express kept for hotel guests that is the only way up to a sky lobby, whose floors hold no office (P6 review A1)', () => {
    const world = createWorld(8);
    const room = (kind: RoomKind, floor: number, x: number): Room => {
      const rule = ROOMS[kind];
      const made: Room = {
        id: allocId(world), kind, floor, x, width: rule.width, height: rule.height, eval: 0.7, tenants: [], occupancy: 0,
        builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
      };
      addRoom(world, made);
      return made;
    };
    const shaft = (kind: 'express' | 'standard', x: number, floorMin: number, floorMax: number, stops: number[], serves: 'any' | 'hotel'): Shaft => {
      const made: Shaft = {
        id: allocId(world), kind, x, width: SHAFTS[kind].width, floorMin, floorMax, stops: new Set(stops), homeFloor: floorMin, cars: [], hallCalls: new Map(),
      };
      made.cars.push({ id: allocId(world), shaftId: made.id, y: floorMin, dir: 0, state: 'idle', doorTimer: 0, idleSince: null, passengers: [], calls: new Set(), serves, range: null });
      addShaft(world, made);
      return made;
    };
    for (let x = 100; x < 140; x += 1) room('lobby', 1, x);
    room('skyLobby', 15, 100);
    room('office', 17, 100);
    const express = shaft('express', 140, 1, 15, [1, 15], 'hotel');
    shaft('standard', 150, 15, 20, [15, 16, 17, 18, 19, 20], 'any');
    world.routingDirty = true;
    // The express stops only at 1 and 15, where no office stands: the old floors-only rule was
    // silent, but every office trip rides it as a leftover to reach the sky lobby.
    expect(othersWaitLonger(world, express)).toBe(true);
    express.cars[0]!.serves = 'any';
    world.routingDirty = true;
    expect(othersWaitLonger(world, express)).toBe(false);
  });
});

describe("a car's floors and keys (P6 review A2, A4)", () => {
  it('reads as one face, "Floors 1-3", with the bottom\'s minus and plus at its left end and the top\'s at its right', () => {
    const { world, shaftId } = tower(1);
    const card = open(world, shaftId);
    const strip = card.panel.descendants().find((n) => has(n, 'hs-car-range'))!;
    expect(strip.getAttribute('role')).toBe('group');
    expect(strip.getAttribute('aria-label')).toBe('Floors car 1 works');
    expect(strip.children.map((n) => n.textContent)).toEqual(['\u2212', '+', 'Floors 1\u20133', '\u2212', '+']);
    expect(strip.children.filter((n) => n.tagName === 'BUTTON').map((n) => n.getAttribute('aria-label'))).toEqual([
      'Bottom \u2212 floor for car 1', 'Bottom + floor for car 1', 'Top \u2212 floor for car 1', 'Top + floor for car 1',
    ]);
    // The top's minus takes the car to floors 1 to 2, and the words follow.
    click(strip.children[3]!);
    card.panel.refresh();
    expect(card.sent.at(-1)).toMatchObject({ kind: 'shaft.setCarRange', range: { lo: 1, hi: 2 } });
    expect(strip.children[2]!.textContent).toBe('Floors 1\u20132');
  });

  it('keeps the arrow keys inside the rider choices, so the tower behind does not pan on them', () => {
    const { world, shaftId } = tower(1);
    const card = open(world, shaftId);
    const group = card.groups()[0]!;
    let stopped = 0;
    let prevented = 0;
    for (const fn of group.listeners.get('keydown') ?? []) {
      fn({ key: 'ArrowRight', preventDefault: () => (prevented += 1), stopPropagation: () => (stopped += 1) } as never);
    }
    expect([prevented, stopped]).toEqual([1, 1]);
  });
});

describe('it is not the pause menu', () => {
  it('on a phone it is a sheet with no backdrop, not modal, and Tab and keys go on past it', () => {
    setWidth(390);
    const { world, shaftId } = tower(1);
    const card = open(world, shaftId);
    const host = dom.createElement('div');
    card.panel.sheet.mount(host);
    expect(host.children).toEqual([card.panel]);
    expect(card.panel.getAttribute('aria-modal')).toBeNull();
    // Focus starts in it (mount), and Tab goes on out of it.
    const tab = { key: 'Tab', shiftKey: false, preventDefault: () => {} };
    expect(card.panel.sheet.handleKey(tab)).toBe(false);
    // Focus back on the tower: its keys are the tower's again (a modal sheet would take Escape).
    dom.activeElement = null;
    expect(card.panel.sheet.handleKey({ key: 'Escape', preventDefault: () => {} })).toBe(false);
  });

  it('as a card Tab is not held inside it either', () => {
    setWidth(1280);
    const { world, shaftId } = tower(1);
    const card = open(world, shaftId);
    const host = dom.createElement('div');
    card.panel.sheet.mount(host);
    dom.activeElement = card.panel.descendants().find((n) => n.getAttribute('role') === 'radio')!;
    expect(card.panel.sheet.handleKey({ key: 'Tab', shiftKey: false, preventDefault: () => {} })).toBe(false);
  });

  it('in the game it leaves the speed alone, puts no scrim up, and the tower keeps its keys', () => {
    setWidth(1280);
    const game = createGame(5);
    game.world.cash = 10_000_000;
    for (let x = 90; x < 130; x += 1) game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
    expect(game.apply({ kind: 'shaft.build', shaft: 'standard', x: 100, floorMin: 1, floorMax: 3 }).ok).toBe(true);
    game.setSpeed(2);
    const root = dom.createElement('div');
    createUi(root as never, game, {} as never);
    game.select({ shaftId: [...game.world.shafts.keys()][0]! });
    const card = root.descendants().find((n) => has(n, 'hs-elevator-card'))!;
    expect(card).toBeDefined();
    expect(game.getSpeed()).toBe(2);
    expect(root.descendants().some((n) => has(n, 'hs-pause') || has(n, 'hs-sheet-backdrop'))).toBe(false);
    expect(has(root.children[0]!, 'is-paused-menu')).toBe(false);
    // Choosing a setting from the card: still running at the same speed.
    click(card.descendants().find((n) => n.textContent === 'Hotel guests first')!);
    expect(game.world.shafts.values().next().value!.cars[0]!.serves).toBe('hotel');
    expect(game.getSpeed()).toBe(2);
  });
});

describe('the look', () => {
  const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };

  it('wears the pause menu\'s plate and faces, and nothing in its own rules dims or covers the tower', () => {
    const { world, shaftId } = tower(1);
    const card = open(world, shaftId);
    const plate = card.panel.descendants().find((n) => has(n, 'hs-plate'))!;
    expect(plate.descendants().filter((n) => has(n, 'hs-plate-title')).map((n) => n.textContent)).toEqual(['Elevator']);
    expect(plate.descendants().find((n) => has(n, 'hs-plate-state'))!.textContent).toBe('Floor 1 to floor 3 · 1 of 8 cars · nobody riding');
    // Every button on the card is a face, with its icon where it has one, or a step inside the
    // one face-shaped strip of a car's floors.
    const buttons = card.panel.descendants().filter((n) => n.tagName === 'BUTTON' && !has(n, 'hs-sheet-handle') && !has(n, 'hs-panel-close'));
    expect(buttons.filter((n) => !has(n, 'hs-face') && !(has(n, 'hs-car-step') && has(n.parentNode as FakeElement, 'hs-car-range')))).toEqual([]);
    const iconOf = (label: string): string | null =>
      buttons.find((n) => n.textContent === label)!.descendants().find((n) => n.tagName.toLowerCase() === 'use')?.getAttribute('href') ?? null;
    expect([iconOf('Everyone'), iconOf('Hotel guests first'), iconOf('Office staff first'), iconOf('Remove car')]).toEqual([
      '#hs-icon-population', '#hs-icon-hotel', '#hs-icon-structure', '#hs-icon-demolish',
    ]);
    // No label and value rows, and no helper paragraph but the refusal lines.
    expect(card.panel.descendants().some((n) => has(n, 'hs-row'))).toBe(false);
    const paragraphs = card.panel.descendants().filter((n) => n.tagName === 'P' && has(n, 'hs-note') && !has(n, 'hs-refused'));
    expect(paragraphs).toEqual([]);
    // The rules: the shared face's amber choice, and no scrim or pointer block on the card.
    expect(rule(".hs-ui .hs-face:is(.is-selected, [aria-checked='true'], [aria-pressed='true'])")).toMatch(/background: var\(--amber\);/);
    for (const m of css.matchAll(/([^{}]*hs-(elevator-card|elevator-plate|elevator-warning|riders|rider|face-row)[^{}]*)\{([^{}]*)\}/g)) {
      expect(m[3], m[1]).not.toMatch(/scrim|pointer-events: none|position: fixed/);
    }
  });
});
