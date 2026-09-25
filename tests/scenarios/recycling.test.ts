/**
 * Waste and its collection. Rooms gather one number of waste a day, only while a recycling
 * center stands; two named workers from the center collect it by the normal routes and
 * elevators and unload at the center; a room nobody reaches for two days goes into backlog
 * and takes the dirty penalty until it is emptied, then clears at the next roll.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/sim/build';
import { EVENT_TEST_HOOKS, resetEventTestHooks } from '../../src/sim/events';
import { personIdentity } from '../../src/sim/identity';
import { centerSummary, collectorStatus } from '../../src/sim/recycling';
import { WASTE } from '../../src/sim/rules';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import { personCard } from '../../src/sim/story';
import { tick } from '../../src/sim/tick';
import type { Command, Room, Sim, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { collectionLines, wasteLine } from '../../src/ui/panels';
import { atOnDay, buildRow, buildTower, lobbyRun, onlyShaft, roomsMatching, runDays, runMinutes, simsOfKind } from './helpers';

const TOP = 6;

beforeEach(() => {
  resetEventTestHooks();
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 0, theft: 0 };
});
afterEach(() => resetEventTestHooks());

/**
 * A three star tower: a lobby, one standard shaft from B2 to floor 6, an office at x 100 on
 * every floor from 2 to 6, a parking space on B1 for support and, when asked, a recycling
 * center on B2 (covering B2 and B1) at x 10.
 */
function tower(opts: { center: boolean; seed?: number }): World {
  const world = createWorld(opts.seed ?? 7);
  world.stars = 3;
  world.cash = 500_000_000;
  const script: Command[] = [...lobbyRun(90, 200), { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: -2, floorMax: TOP }];
  for (let f = 2; f <= TOP; f++) script.push(...buildRow('office', f, [100]));
  script.push({ kind: 'build', room: 'parkingSpace', floor: -1, x: 100 });
  if (opts.center) script.push({ kind: 'build', room: 'recycling', floor: -2, x: 10 });
  buildTower(world, script);
  buildTower(world, [{ kind: 'shaft.addCar', shaftId: onlyShaft(world).id }]);
  return world;
}

function center(world: World): Room {
  const room = roomsMatching(world, 'recycling')[0];
  if (!room) throw new Error('no recycling center');
  return room;
}

function officeOn(world: World, floor: number): Room {
  const room = roomsMatching(world, 'office', { floor })[0];
  if (!room) throw new Error(`no office on floor ${floor}`);
  return room;
}

/** Leave waste only where the test wants it. */
function setWaste(world: World, wanted: Record<number, number>): void {
  for (const room of world.rooms.values()) if (room.kind === 'office') room.waste = wanted[room.floor] ?? 0;
}

function collectors(world: World): Sim[] {
  return simsOfKind(world, 'collector');
}

function logCount(world: World, text: string): number {
  return world.log.filter((l) => l.text === text).length;
}

function setStop(world: World, floor: number, stops: boolean): void {
  expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: onlyShaft(world).id, floor, stops })).toEqual({ ok: true });
}

describe('waste accrues only with a recycling center', () => {
  it('without a center no room ever holds waste and nobody is hired', () => {
    const world = tower({ center: false });
    atOnDay(world, 2, 7, 0);
    for (const room of world.rooms.values()) {
      expect(room.waste).toBeUndefined();
      expect(room.wasteBacklogSince).toBeUndefined();
    }
    expect(collectors(world)).toHaveLength(0);
  });

  it('with one, each room anyone used gains a load at 06:00, sized by the people in it', () => {
    const world = tower({ center: true });
    atOnDay(world, 1, 6, 1);
    // Six workers each: ceil(6 / 8) is one unit.
    for (let f = 2; f <= TOP; f++) expect(officeOn(world, f).waste).toBe(1);
    // The parking space and the center itself make none.
    expect(roomsMatching(world, 'parkingSpace')[0]?.waste).toBeUndefined();
    expect(center(world).waste).toBeUndefined();
  });
});

describe('collection workers', () => {
  it('are two people hired with the center, not occupancy, named, and go with it', () => {
    const world = tower({ center: true });
    const c = center(world);
    tick(world);
    const staff = collectors(world);
    expect(staff).toHaveLength(WASTE.workersPerCenter);
    expect(c.tenants).toEqual(staff.map((s) => s.id));
    expect(c.occupancy).toBe(0);
    const card = personCard(world, staff[0] as Sim);
    expect(card.who).toEqual([personIdentity(world.seed, staff[0]!.id, 'collector').name, 'Collection worker', 'Works for the recycling center on floor B2']);
    expect(collectorStatus(world, staff[0] as Sim)).toBe('Off work');
    expect(applyCommand(world, { kind: 'demolish', roomId: c.id })).toEqual({ ok: true });
    tick(world);
    expect(collectors(world)).toHaveLength(0);
  });

  it('collect two rooms across three floors by the elevator, unload at the center, and the counts add up', () => {
    const world = tower({ center: true });
    atOnDay(world, 1, 6, 1);
    setWaste(world, { 3: 4, 5: 5 });
    const c = center(world);
    const statuses = new Set<string>();
    let rode = false;
    atOnDay(world, 1, 8, 59);
    for (let i = 0; i < 180; i++) {
      tick(world);
      for (const sim of collectors(world)) {
        statuses.add(collectorStatus(world, sim));
        if (sim.state === 'riding') rode = true;
      }
    }
    expect(officeOn(world, 3).waste).toBe(0);
    expect(officeOn(world, 5).waste).toBe(0);
    expect(rode).toBe(true);
    expect(statuses).toContain('Collecting on floor 3');
    expect(statuses).toContain('Collecting on floor 5');
    expect(statuses).toContain('Unloading');
    // Both back in the center, carts empty.
    for (const sim of collectors(world)) {
      expect(sim.collector?.load).toBe(0);
      expect(sim.inRoomId).toBe(c.id);
      expect(collectorStatus(world, sim)).toBe('In the center');
    }
    expect(centerSummary(world, c)).toEqual({ workers: 2, collectedToday: 9, backlogRooms: 0, unreachableFloors: [] });
    expect(collectionLines(world, c)).toEqual([
      ['Workers', '2 (grows with the tower)'],
      ['Collected today', '9 units'],
      ['Rooms piling up', '0'],
      ['Cannot reach', 'None'],
    ]);
    expect(wasteLine(world, officeOn(world, 3))).toBe('Waste: 0 of 9, collected today');
    expect(c.occupancy).toBe(0);
  });

  it('a worker carries no more than its capacity before going back to unload', () => {
    const world = tower({ center: true });
    atOnDay(world, 1, 6, 1);
    setWaste(world, { 2: 9, 3: 9, 4: 9, 5: 9, 6: 9 });
    atOnDay(world, 1, 8, 59);
    let maxLoad = 0;
    for (let i = 0; i < 300; i++) {
      tick(world);
      for (const sim of collectors(world)) maxLoad = Math.max(maxLoad, sim.collector?.load ?? 0);
    }
    expect(maxLoad).toBe(WASTE.workerCapacity);
    expect(centerSummary(world, center(world)).collectedToday).toBe(45);
  });

  it('cannot reach a room while the center floor has no stop, says so once, and collects after the stop is added', () => {
    const world = tower({ center: true });
    setStop(world, -2, false);
    atOnDay(world, 1, 6, 1);
    setWaste(world, { 4: 5 });
    const c = center(world);
    atOnDay(world, 1, 11, 0);
    expect(officeOn(world, 4).waste).toBe(5);
    expect(logCount(world, 'The waste collectors could not reach floor 4.')).toBe(1);
    expect(collectionLines(world, c)[3]).toEqual(['Cannot reach', 'Floor 4']);
    for (const sim of collectors(world)) expect(sim.inRoomId).toBe(c.id);

    // The player adds the stop: the next look finds the way.
    setStop(world, -2, true);
    runMinutes(world, 120);
    expect(officeOn(world, 4).waste).toBe(0);
    expect(centerSummary(world, c).collectedToday).toBe(5);
    expect(centerSummary(world, c).unreachableFloors).toEqual([]);
    expect(logCount(world, 'The waste collectors could not reach floor 4.')).toBe(1);
  });
});

describe('backlog', () => {
  it('after two rolls at the line the room turns dirty, and clears the roll after it is emptied', () => {
    const world = tower({ center: true });
    setStop(world, -2, false); // nobody can collect
    atOnDay(world, 1, 6, 1);
    setWaste(world, { 3: WASTE.backlogAt });
    const room = officeOn(world, 3);
    atOnDay(world, 2, 6, 1);
    expect(room.wasteDays).toBe(1);
    expect(room.dirty).toBe(false);
    atOnDay(world, 3, 6, 1);
    expect(room.wasteDays).toBe(2);
    expect(room.dirty).toBe(true);
    expect(room.wasteBacklogSince).toBe(3 * 1440 + 6 * 60);
    expect(world.story.recent.filter((b) => b.code === 'waste.backlog' && b.roomId === room.id)).toHaveLength(1);
    expect(wasteLine(world, room)).toMatch(/^Waste: \d of 9, piling up since this morning$/);
    expect(centerSummary(world, center(world)).backlogRooms).toBeGreaterThanOrEqual(1);
    // Evaluation takes the dirty penalty and names the waste if the tenant leaves over it.
    atOnDay(world, 3, 7, 31);
    expect(room.eval).toBeLessThanOrEqual(0.7 + 1e-9);
    // No alert card: backlog is a panel and story matter.
    expect(world.log.some((l) => l.level === 'alert' && /waste|collect/i.test(l.text))).toBe(false);

    // The fix: the stop goes back and the workers empty it the same day; it stays dirty until the roll.
    setStop(world, -2, true);
    atOnDay(world, 3, 16, 0);
    expect(room.waste).toBe(0);
    expect(room.dirty).toBe(true);
    atOnDay(world, 4, 6, 1);
    expect(room.dirty).toBe(false);
    expect(room.wasteBacklogSince).toBeNull();
    expect(world.story.recent.filter((b) => b.code === 'waste.cleared' && b.roomId === room.id)).toHaveLength(1);
    atOnDay(world, 4, 7, 31);
    expect(room.eval).toBeGreaterThan(0.7);
  });

  it('housekeeping cannot clean a hotel room held dirty by waste', () => {
    const world = tower({ center: true });
    buildTower(world, [...buildRow('housekeeping', 2, [160]), ...buildRow('hotelSingle', 3, [160])]);
    setStop(world, -2, false);
    atOnDay(world, 1, 6, 1);
    const hotel = roomsMatching(world, 'hotelSingle')[0] as Room;
    hotel.waste = 8;
    atOnDay(world, 3, 6, 1);
    expect(hotel.wasteBacklogSince).not.toBeNull();
    expect(hotel.dirty).toBe(true);
    atOnDay(world, 3, 20, 0);
    expect(hotel.dirty).toBe(true);
  });

  it('demolishing the center lets every backlog go at the next roll', () => {
    const world = tower({ center: true });
    setStop(world, -2, false);
    atOnDay(world, 1, 6, 1);
    setWaste(world, { 3: 8 });
    atOnDay(world, 3, 6, 1);
    const room = officeOn(world, 3);
    expect(room.dirty).toBe(true);
    atOnDay(world, 3, 20, 0);
    expect(applyCommand(world, { kind: 'demolish', roomId: center(world).id })).toEqual({ ok: true });
    atOnDay(world, 4, 6, 1);
    expect(room.dirty).toBe(false);
    expect(room.waste).toBeUndefined();
  });
});

/** 200 offices on floors 2 to 6, one shaft from B2 with four cars, and a recycling center on B2. */
function bigTower(): World {
  const world = createWorld(31);
  world.stars = 3;
  world.cash = 2_000_000_000;
  const script: Command[] = [...lobbyRun(0, 374), { kind: 'shaft.build', shaft: 'standard', x: 0, floorMin: -2, floorMax: 6 }];
  const xs: number[] = [];
  for (let x = 5; x + 9 <= 365; x += 9) xs.push(x); // 40 offices a floor
  for (let f = 2; f <= 6; f++) script.push(...buildRow('office', f, xs));
  script.push({ kind: 'build', room: 'parkingSpace', floor: -1, x: 100 }, { kind: 'build', room: 'recycling', floor: -2, x: 10 });
  buildTower(world, script);
  for (let c = 0; c < 3; c++) buildTower(world, [{ kind: 'shaft.addCar', shaftId: onlyShaft(world).id }]);
  expect(roomsMatching(world, 'office')).toHaveLength(200);
  return world;
}

describe('a large tower', () => {
  it('grows its workers at the roll, one number per room, and keeps every room out of backlog for five days', () => {
    const world = bigTower();
    atOnDay(world, 1, 6, 0);
    expect(collectors(world)).toHaveLength(WASTE.workersPerCenter);
    tick(world); // the roll: 200 rooms gained waste, 2 + floor(200 / 30) is 8
    expect(center(world).wasteWorkers).toBe(8);
    tick(world);
    expect(collectors(world)).toHaveLength(8);
    const hired = collectors(world).map((s) => s.id);
    expect(hired).toEqual([...hired].sort((a, b) => a - b));
    const kinds = new Set([...world.sims.values()].map((s) => s.kind));
    expect([...kinds].sort()).toEqual(['collector', 'worker']);

    let backlog = 0;
    for (let day = 1; day <= 5; day++) {
      atOnDay(world, day + 1, 6, 1);
      for (const room of world.rooms.values()) if (room.wasteBacklogSince != null) backlog += 1;
    }
    expect(backlog).toBe(0);
    expect(collectors(world)).toHaveLength(8);
    // Waste is a bounded number on the room, never a list of items.
    for (const room of world.rooms.values()) {
      if (room.waste === undefined) continue;
      expect(Number.isInteger(room.waste)).toBe(true);
      expect(room.waste).toBeLessThanOrEqual(WASTE.roomCap);
    }
    const saved = JSON.parse(serialize(world)) as { rooms: Record<string, unknown>[] };
    for (const room of saved.rooms) {
      for (const [key, value] of Object.entries(room)) if (key.startsWith('waste') && key !== 'wasteUnreachable') expect(typeof value === 'number' || value === null).toBe(true);
    }
  }, 300_000);

  it('a small tower stays at two, and a tower that shrinks lets its newest workers go', () => {
    const world = tower({ center: true });
    atOnDay(world, 3, 6, 5);
    expect(center(world).wasteWorkers).toBe(2);
    expect(collectors(world)).toHaveLength(2);
    // Pretend the last roll called for five: the next roll brings it back to two, newest out first.
    const c = center(world);
    c.wasteWorkers = 5;
    tick(world);
    const five = collectors(world).map((s) => s.id).sort((a, b) => a - b);
    expect(five).toHaveLength(5);
    atOnDay(world, 4, 6, 1);
    expect(collectors(world).map((s) => s.id).sort((a, b) => a - b)).toEqual(five.slice(0, 2));
    expect(c.tenants).toHaveLength(2);
  });
});

describe('saves', () => {
  it('an older save with no waste and no workers loads with 0 and hires the same workers', () => {
    const world = tower({ center: true });
    atOnDay(world, 1, 10, 0);
    // As a save made before this package would have it: no waste fields, no collectors.
    const data = JSON.parse(serialize(world)) as { rooms: Record<string, unknown>[]; sims: { id: number; kind: string }[] };
    const collectorIds = new Set(data.sims.filter((s) => s.kind === 'collector').map((s) => s.id));
    data.sims = data.sims.filter((s) => !collectorIds.has(s.id));
    for (const room of data.rooms) {
      for (const key of Object.keys(room)) if (key.startsWith('waste')) delete room[key];
      if (room.kind === 'recycling') room.tenants = [];
    }
    const loaded = deserialize(JSON.stringify(data));
    if (!loaded.ok) throw new Error(loaded.reason);
    const copy = loaded.world;
    expect(officeOn(copy, 3).waste).toBeUndefined();
    expect(wasteLine(copy, officeOn(copy, 3))).toBe('Waste: 0 of 9');
    tick(copy);
    expect(collectors(copy)).toHaveLength(WASTE.workersPerCenter);
    // Hired deterministically: the same ids a second load hands out.
    const again = deserialize(JSON.stringify(data));
    if (!again.ok) throw new Error(again.reason);
    tick(again.world);
    expect(collectors(again.world).map((s) => s.id)).toEqual(collectors(copy).map((s) => s.id));
    runDays(copy, 1);
    expect(officeOn(copy, 3).waste).toBeDefined();
    // Its next roll set the count: five offices is still two.
    expect(center(copy).wasteWorkers).toBe(2);
    expect(collectors(copy)).toHaveLength(2);
  });

  it('an older save of a large tower loads at two workers and reaches eight at its next roll', () => {
    const world = bigTower();
    atOnDay(world, 1, 5, 0);
    const data = JSON.parse(serialize(world)) as { rooms: Record<string, unknown>[]; sims: { id: number; kind: string }[] };
    const collectorIds = new Set(data.sims.filter((s) => s.kind === 'collector').map((s) => s.id));
    data.sims = data.sims.filter((s) => !collectorIds.has(s.id));
    for (const room of data.rooms) {
      for (const key of Object.keys(room)) if (key.startsWith('waste')) delete room[key];
      if (room.kind === 'recycling') room.tenants = [];
    }
    const loaded = deserialize(JSON.stringify(data));
    if (!loaded.ok) throw new Error(loaded.reason);
    const copy = loaded.world;
    tick(copy);
    expect(collectors(copy)).toHaveLength(2);
    atOnDay(copy, 1, 6, 2);
    expect(center(copy).wasteWorkers).toBe(8);
    expect(collectors(copy)).toHaveLength(8);
  }, 120_000);

  it('saved and loaded mid round, replays to the same hash', () => {
    const world = tower({ center: true });
    atOnDay(world, 1, 6, 1);
    setWaste(world, { 3: 4, 5: 5 });
    atOnDay(world, 1, 9, 4);
    const loaded = deserialize(serialize(world));
    if (!loaded.ok) throw new Error(loaded.reason);
    runMinutes(world, 600);
    runMinutes(loaded.world, 600);
    expect(hashWorld(loaded.world)).toBe(hashWorld(world));
  });

  it('refuses a room with waste past the cap', () => {
    const world = tower({ center: true });
    const data = JSON.parse(serialize(world)) as { rooms: Record<string, unknown>[] };
    (data.rooms[0] as Record<string, unknown>).waste = WASTE.roomCap + 1;
    const loaded = deserialize(JSON.stringify(data));
    expect(loaded.ok).toBe(false);
  });
});

describe('a tower without a center', () => {
  it('a one star tower hashes exactly as it did before waste', () => {
    // Recorded on 90682ab, before this package. Re-recorded when rooms had to rest on structure:
    // the same tower with the second condo moved onto the floor 3 offices hashes 2ee5cd9f on 90682ab too.
    const world = createWorld(1999);
    world.cash = 5_000_000;
    buildTower(world, [
      ...lobbyRun(90, 200),
      { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 6 },
      ...buildRow('office', 2, [100, 109, 118, 127, 160, 169]),
      ...buildRow('office', 3, [100, 109, 118]),
      ...buildRow('condo', 4, [100, 116]),
      ...buildRow('fastFood', 5, [100]),
    ]);
    runDays(world, 3);
    expect(hashWorld(world)).toBe('2ee5cd9f');
  });
});
