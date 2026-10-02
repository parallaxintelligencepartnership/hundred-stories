/**
 * Several recycling centers, the longest waiting rooms first, made against collected, and waste
 * that goes on piling once the last center is gone (decisions 2026-10-01). Every test runs the
 * real tick: the workers ride the elevators, and nothing is set by hand but waste levels.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/sim/build';
import { EVENT_TEST_HOOKS, resetEventTestHooks } from '../../src/sim/events';
import { centerSummary, collectorsOf, LAST_CENTER_GONE, workerTarget } from '../../src/sim/recycling';
import { ROOMS, SHAFTS, WASTE } from '../../src/sim/rules';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import { tick } from '../../src/sim/tick';
import type { Command, Id, Room, Sim, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { atOnDay, buildRow, buildTower, lobbyRun, onlyShaft, roomsMatching, simsOfKind } from './helpers';

beforeEach(() => {
  resetEventTestHooks();
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 0, theft: 0 };
});
afterEach(() => resetEventTestHooks());

const OFFICE_XS = [10, 30, 50, 70, 90, 170, 190, 210, 230, 250];

/**
 * A three star tower: a lobby across 0 to 299, one standard shaft from B2 to floor 8 with four
 * cars, ten offices on each floor from 2 to 8, and recycling centers on B2 at the given x.
 */
function tower(centerXs: number[], seed = 13): World {
  const world = createWorld(seed);
  world.stars = 3;
  world.cash = 500_000_000;
  const script: Command[] = [...lobbyRun(0, 299), { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: -2, floorMax: 8 }];
  for (let f = 2; f <= 8; f++) script.push(...buildRow('office', f, OFFICE_XS));
  for (const x of centerXs) script.push({ kind: 'build', room: 'recycling', floor: -2, x });
  buildTower(world, script);
  for (let c = 0; c < 3; c++) buildTower(world, [{ kind: 'shaft.addCar', shaftId: onlyShaft(world).id }]);
  return world;
}

function centers(world: World): Room[] {
  return roomsMatching(world, 'recycling').sort((a, b) => a.id - b.id);
}

function offices(world: World): Room[] {
  return roomsMatching(world, 'office');
}

function totalWaste(world: World): number {
  let sum = 0;
  for (const room of world.rooms.values()) sum += room.waste ?? 0;
  return sum;
}

/** The rooms collectors are walking to or emptying; a room twice in the list is served twice at once. */
function claims(world: World): Id[] {
  const out: Id[] = [];
  for (const sim of simsOfKind(world, 'collector')) {
    const c = sim.collector;
    if (c && (c.task === 'toRoom' || c.task === 'collecting') && c.roomId !== null) out.push(c.roomId);
  }
  return out;
}

/** Seats and riders that disagree, collectors with no standing center, rooms with a negative head count. */
function orphans(world: World): string[] {
  const out: string[] = [];
  const carOf = new Map<Id, Id[]>();
  for (const shaft of world.shafts.values()) {
    for (const car of shaft.cars) {
      carOf.set(car.id, car.passengers);
      for (const id of car.passengers) {
        const sim = world.sims.get(id);
        if (!sim) out.push(`car ${car.id} seats removed sim ${id}`);
        else if (sim.inCarId !== car.id) out.push(`car ${car.id} seats sim ${id} who is not in it`);
      }
    }
  }
  for (const sim of world.sims.values()) {
    if (sim.inCarId !== null && !carOf.get(sim.inCarId)?.includes(sim.id)) out.push(`sim ${sim.id} rides car ${sim.inCarId} without a seat`);
    if (sim.kind !== 'collector') continue;
    const home = sim.homeRoomId === null ? undefined : world.rooms.get(sim.homeRoomId);
    if (!home || home.kind !== 'recycling') out.push(`collector ${sim.id} has no center`);
    else if (!home.tenants.includes(sim.id)) out.push(`collector ${sim.id} is not on its center's list`);
    if (sim.inRoomId !== null && !world.rooms.has(sim.inRoomId)) out.push(`collector ${sim.id} is inside a room that is gone`);
  }
  for (const room of world.rooms.values()) {
    if (room.occupancy < 0) out.push(`room ${room.id} occupancy ${room.occupancy}`);
    for (const id of room.tenants) if (!world.sims.has(id)) out.push(`room ${room.id} lists removed sim ${id}`);
  }
  return out;
}

/** Leave this much waste in every office. */
function fillOffices(world: World, waste: number): void {
  for (const room of offices(world)) room.waste = waste;
}

describe('two centers', () => {
  it('both staff their own workers and both collect, and no room is served by two workers at once', () => {
    const world = tower([10, 200]);
    atOnDay(world, 1, 6, 1);
    const [a, b] = centers(world) as [Room, Room];
    fillOffices(world, 5);
    let most = 0;
    while (world.time.minute < 1 * 1440 + 17 * 60) {
      tick(world);
      const held = claims(world);
      expect(new Set(held).size).toBe(held.length);
      most = Math.max(most, held.length);
    }
    for (const center of [a, b]) {
      const crew = collectorsOf(world, center);
      expect(crew).toHaveLength(workerTarget(center));
      expect(crew.length).toBeGreaterThanOrEqual(WASTE.workersPerCenter);
      for (const sim of crew) expect(sim.homeRoomId).toBe(center.id);
      expect(center.wasteCollectedToday ?? 0).toBeGreaterThan(0);
    }
    expect(most).toBeGreaterThan(WASTE.workersPerCenter); // the two crews worked at the same time
    // Every worker unloads at its own center, and the counts are the center's own.
    const total = (a.wasteCollectedToday ?? 0) + (b.wasteCollectedToday ?? 0);
    expect(world.wasteToday?.collected).toBe(total);
    expect(orphans(world)).toEqual([]);
    const sumA = centerSummary(world, a);
    expect(sumA.centers).toBe(2);
    expect(sumA.collectedHere).toBe(a.wasteCollectedToday);
    expect(sumA.collectedToday).toBe(total);
  });

  it('demolishing one while its workers are out leaves no orphan workers, seats or claims, and the other goes on', () => {
    const world = tower([10, 200]);
    atOnDay(world, 1, 6, 1);
    const [a, b] = centers(world) as [Room, Room];
    fillOffices(world, 6);
    atOnDay(world, 1, 9, 0);
    // Wait until one of b's workers is riding a car, and another is out of the center.
    let out: Sim[] = [];
    for (let i = 0; i < 240; i++) {
      tick(world);
      out = collectorsOf(world, b).filter((s) => s.inRoomId !== b.id);
      if (out.some((s) => s.state === 'riding') && out.length >= 2) break;
    }
    expect(out.some((s) => s.state === 'riding')).toBe(true);
    const goneIds = collectorsOf(world, b).map((s) => s.id);
    const before = a.wasteCollectedToday ?? 0;
    expect(applyCommand(world, { kind: 'demolish', roomId: b.id })).toEqual({ ok: true });
    expect(world.rooms.has(b.id)).toBe(false);
    for (const id of goneIds) expect(world.sims.has(id)).toBe(false);
    expect(orphans(world)).toEqual([]);
    expect(claims(world).every((id) => world.rooms.has(id))).toBe(true);
    expect(world.log.some((l) => l.text === LAST_CENTER_GONE)).toBe(false);
    // The other center's crew finishes the day without trouble.
    while (world.time.minute < 1 * 1440 + 17 * 60) {
      tick(world);
      const held = claims(world);
      expect(new Set(held).size).toBe(held.length);
    }
    expect(orphans(world)).toEqual([]);
    expect(a.wasteCollectedToday ?? 0).toBeGreaterThan(before);
    expect(centerSummary(world, a).centers).toBe(1);
  });

  it('made and collected add up: the roll adds what it says it made, and the day takes away what the centers collected', () => {
    const world = tower([10, 200]);
    atOnDay(world, 2, 6, 0);
    const beforeRoll = totalWaste(world);
    tick(world); // the 06:00 roll
    const made = world.wasteToday?.made ?? -1;
    expect(made).toBeGreaterThan(0);
    expect(totalWaste(world)).toBe(beforeRoll + made);
    expect(world.wasteToday?.collected).toBe(0);
    const afterRoll = totalWaste(world);
    atOnDay(world, 3, 6, 0); // the minute before the next roll
    const collected = world.wasteToday?.collected ?? -1;
    expect(collected).toBeGreaterThan(0);
    expect(afterRoll - totalWaste(world)).toBe(collected);
    const shares = centers(world).map((c) => c.wasteCollectedToday ?? 0);
    expect(shares.every((n) => n > 0)).toBe(true);
    expect(shares.reduce((s, n) => s + n, 0)).toBe(collected);
    const [first] = centers(world) as [Room];
    expect(centerSummary(world, first)).toMatchObject({ madeToday: made, collectedToday: collected, collectedHere: shares[0], centers: 2 });
  });
});

describe('a tower that loses its last center', () => {
  it('piles waste and turns rooms dirty; a tower that never had one does not; a new center clears it over time', () => {
    const world = tower([10]);
    atOnDay(world, 1, 7, 0);
    expect(world.hadRecycling).toBe(true);
    const [center] = centers(world) as [Room];
    expect(applyCommand(world, { kind: 'demolish', roomId: center.id })).toEqual({ ok: true });
    expect(world.log.filter((l) => l.text === LAST_CENTER_GONE)).toHaveLength(1);
    expect(simsOfKind(world, 'collector')).toHaveLength(0);
    fillOffices(world, 5); // a busy tower's level, so the backlog line is near
    const before = totalWaste(world);
    atOnDay(world, 6, 7, 0);
    expect(totalWaste(world)).toBeGreaterThan(before);
    const piled = offices(world).filter((r) => r.wasteBacklogSince != null);
    expect(piled.length).toBeGreaterThan(0);
    for (const room of piled) expect(room.dirty).toBe(true);
    expect(world.log.filter((l) => l.text === LAST_CENTER_GONE)).toHaveLength(1);

    // The same tower that never had a center: nothing at all.
    const never = tower([]);
    atOnDay(never, 6, 7, 0);
    expect(never.hadRecycling).toBeUndefined();
    expect(never.wasteToday).toBeUndefined();
    for (const room of never.rooms.values()) {
      expect(room.waste).toBeUndefined();
      expect(room.wasteBacklogSince).toBeUndefined();
    }

    // A center again: the workers clear the backlog over the next days.
    expect(applyCommand(world, { kind: 'build', room: 'recycling', floor: -2, x: 10 })).toEqual({ ok: true });
    // Four workers against 70 full rooms: fewer in backlog by day 10, none by day 14.
    atOnDay(world, 10, 7, 0);
    expect(offices(world).filter((r) => r.wasteBacklogSince != null).length).toBeLessThan(piled.length);
    atOnDay(world, 14, 7, 0);
    const still = offices(world).filter((r) => r.wasteBacklogSince != null);
    expect(still).toHaveLength(0);
    for (const room of piled) expect(room.dirty).toBe(false);
  }, 120_000);
});

describe('the hadRecycling marker in a save', () => {
  it('survives save and load, and keeps the waste piling in the loaded tower', () => {
    const world = tower([10]);
    atOnDay(world, 1, 7, 0);
    expect(applyCommand(world, { kind: 'demolish', roomId: (centers(world)[0] as Room).id })).toEqual({ ok: true });
    const text = serialize(world);
    const saved = JSON.parse(text) as Record<string, unknown>;
    expect(saved.version).toBe(5);
    expect(saved.hadRecycling).toBe(true);
    const loaded = deserialize(text);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.world.hadRecycling).toBe(true);
    expect(loaded.world.wasteToday).toEqual(world.wasteToday);
    expect(hashWorld(loaded.world)).toBe(hashWorld(world));
    const before = totalWaste(loaded.world);
    atOnDay(loaded.world, 2, 7, 0);
    expect(totalWaste(loaded.world)).toBeGreaterThan(before);
  });

  it('is set on load for an older save that has a center standing', () => {
    const world = tower([10]);
    atOnDay(world, 1, 7, 0);
    const saved = JSON.parse(serialize(world)) as Record<string, unknown>;
    delete saved.hadRecycling;
    delete saved.wasteToday;
    const loaded = deserialize(JSON.stringify(saved));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.world.hadRecycling).toBe(true);
  });

  it('a tower without it saves no new keys and hashes exactly as before; a bad marker is refused, bad counts are dropped', () => {
    const world = tower([]);
    atOnDay(world, 1, 7, 0);
    const text = serialize(world);
    expect(text).not.toContain('hadRecycling');
    expect(text).not.toContain('wasteToday');
    const hash = hashWorld(world);
    world.hadRecycling = false;
    expect(hashWorld(world)).toBe(hash);
    world.hadRecycling = true;
    expect(hashWorld(world)).not.toBe(hash);
    delete world.hadRecycling;
    expect(hashWorld(world)).toBe(hash);

    const bad = JSON.parse(text) as Record<string, unknown>;
    bad.hadRecycling = 'yes';
    const refused = deserialize(JSON.stringify(bad));
    expect(refused).toMatchObject({ ok: false, reason: expect.stringContaining('(hadRecycling)') });
    bad.hadRecycling = false;
    bad.wasteToday = { made: -1, collected: 'many' };
    const kept = deserialize(JSON.stringify(bad));
    expect(kept.ok).toBe(true);
    if (kept.ok) {
      expect(kept.world.hadRecycling).toBeUndefined();
      expect(kept.world.wasteToday).toBeUndefined();
      expect(hashWorld(kept.world)).toBe(hash);
    }
  });
});

/**
 * The bench "large" tower the review measured (scripts/bench/bench3.ts): 20 office floors of 41
 * offices, seven shafts of eight cars, one of them reaching a recycling center on B2. Nearest
 * first never reached floors 18 to 21 in twelve days; the longest waiting rooms come first now.
 */
describe('the longest waiting rooms first', () => {
  it('reaches the top floors of the 820 office tower', () => {
    const world = createWorld(4242);
    world.cash = 5_000_000_000;
    world.stars = 3;
    const script: Command[] = lobbyRun(0, 374);
    const top = 21;
    [10, 60, 110, 160, 210, 260, 310].forEach((x, i) => script.push({ kind: 'shaft.build', shaft: 'standard', x, floorMin: i === 0 ? -2 : 1, floorMax: top }));
    buildTower(world, script);
    for (const shaft of [...world.shafts.values()]) for (let c = 1; c < SHAFTS.standard.maxCars; c++) buildTower(world, [{ kind: 'shaft.addCar', shaftId: shaft.id }]);
    const rows: Command[] = [];
    for (let f = 2; f <= top; f++) for (let x = 0; x + ROOMS.office.width <= 375; x += ROOMS.office.width) rows.push({ kind: 'build', room: 'office', floor: f, x });
    rows.push({ kind: 'build', room: 'recycling', floor: -2, x: 20 });
    buildTower(world, rows);
    expect(offices(world)).toHaveLength(820);
    atOnDay(world, 6, 6, 0);
    const visited = new Set(offices(world).filter((r) => r.wasteCollectedAt !== undefined).map((r) => r.floor));
    const never: number[] = [];
    for (let f = 2; f <= top; f++) if (!visited.has(f)) never.push(f);
    expect(never).toEqual([]);
  }, 300_000);
});
