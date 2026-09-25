// The recycling center panel and a room's waste line, on a fake DOM with a real world. The center
// lists its two workers with where each one is, then what was collected today, the rooms in
// backlog and any floor they cannot reach; a room that makes waste shows one plain line.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/sim/build';
import { EVENT_TEST_HOOKS, resetEventTestHooks } from '../../src/sim/events';
import { personName } from '../../src/sim/identity';
import type { Command, Room, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { createQueryPanel, wasteLine, type PanelContext } from '../../src/ui/panels';
import { atOnDay, buildRow, buildTower, lobbyRun, onlyShaft, roomsMatching } from '../scenarios/helpers';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  resetEventTestHooks();
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 0, theft: 0 };
});
afterEach(() => {
  uninstall();
  resetEventTestHooks();
});

function tower(center: boolean): World {
  const world = createWorld(7);
  world.stars = 3;
  world.cash = 500_000_000;
  const script: Command[] = [...lobbyRun(90, 200), { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: -2, floorMax: 6 }];
  for (let f = 2; f <= 6; f++) script.push(...buildRow('office', f, [100]));
  script.push({ kind: 'build', room: 'parkingSpace', floor: -1, x: 100 });
  if (center) script.push({ kind: 'build', room: 'recycling', floor: -2, x: 10 });
  buildTower(world, script);
  buildTower(world, [{ kind: 'shaft.addCar', shaftId: onlyShaft(world).id }]);
  return world;
}

function context(): PanelContext {
  return { apply: () => ({ ok: true }), notice: () => {}, close: () => {}, reducedMotion: false, setReducedMotion: () => {} };
}

type Panel = FakeElement & { refresh?: () => void };

function panelFor(world: World, room: Room): Panel {
  return createQueryPanel({ world } as never, { roomId: room.id }, context()) as unknown as Panel;
}

const office = (world: World, floor: number): Room => roomsMatching(world, 'office', { floor })[0] as Room;
const center = (world: World): Room => roomsMatching(world, 'recycling')[0] as Room;
const rowValue = (panel: FakeElement, label: string): string | undefined => {
  const row = panel.descendants().find((n) => n.className === 'hs-row' && n.children[0]?.textContent === label);
  return row?.children[1]?.textContent;
};

describe('the recycling center panel', () => {
  it('lists its workers by name and state, with today’s count, backlog and unreachable floors', () => {
    const world = tower(true);
    const c = center(world);
    atOnDay(world, 1, 7, 0);
    let panel = panelFor(world, c);
    const titles = panel.descendants().filter((n) => n.className === 'hs-section-title').map((n) => n.textContent);
    expect(titles).toContain('Workers');
    const items = panel.descendants().filter((n) => n.className === 'hs-occupant');
    expect(items).toHaveLength(2);
    const lines = items.map((n) => n.textContent);
    for (const id of c.tenants) expect(lines).toContain(`${personName(world.seed, id)}Off work`);
    expect(rowValue(panel, 'Workers')).toBe('2 (grows with the tower)');
    expect(rowValue(panel, 'Collected today')).toBe('0 units');
    expect(rowValue(panel, 'Rooms piling up')).toBe('0');
    expect(rowValue(panel, 'Cannot reach')).toBe('None');

    // On shift: out collecting, then the count moves on refresh.
    atOnDay(world, 1, 9, 3);
    panel.refresh?.();
    const states = panel.descendants().filter((n) => n.className === 'hs-occupant-goal').map((n) => n.textContent);
    expect(states.some((s) => /^Collecting on floor \d$/.test(s))).toBe(true);
    atOnDay(world, 1, 12, 0);
    panel.refresh?.();
    expect(rowValue(panel, 'Collected today')).toBe('5 units');

    // With the center's floor cut off, the floor it could not reach shows.
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: onlyShaft(world).id, floor: -2, stops: false }).ok).toBe(true);
    atOnDay(world, 2, 10, 0);
    panel = panelFor(world, c);
    expect(rowValue(panel, 'Cannot reach')).toBe('Floors 2, 3, 4, 5, 6');
  });
});

describe('a room’s waste line', () => {
  it('shows nothing without a center', () => {
    const world = tower(false);
    atOnDay(world, 1, 7, 0);
    const panel = panelFor(world, office(world, 3));
    expect(panel.textContent).not.toContain('Waste:');
    expect(wasteLine(world, office(world, 3))).toBeNull();
  });

  it('reads waiting, then collected today, then backlog since a day, in plain words', () => {
    const world = tower(true);
    atOnDay(world, 1, 7, 0);
    const room = office(world, 3);
    const panel = panelFor(world, room);
    expect(panel.textContent).toContain('Waste: 1 of 9, waiting to be picked up');
    atOnDay(world, 1, 12, 0);
    panel.refresh?.();
    expect(panel.textContent).toContain('Waste: 0 of 9, collected today');

    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: onlyShaft(world).id, floor: -2, stops: false }).ok).toBe(true);
    room.waste = 7;
    atOnDay(world, 3, 7, 0);
    expect(wasteLine(world, room)).toBe('Waste: 9 of 9, piling up since this morning');
    atOnDay(world, 4, 7, 0);
    expect(wasteLine(world, room)).toBe('Waste: 9 of 9, piling up since weekday 1');
    atOnDay(world, 5, 7, 0);
    expect(wasteLine(world, room)).toBe('Waste: 9 of 9, piling up since weekday 1');
    panel.refresh?.();
    expect(panel.textContent).toContain('Waste: 9 of 9, piling up since weekday 1');
    expect(panel.textContent).not.toMatch(/—/);
  });
});
