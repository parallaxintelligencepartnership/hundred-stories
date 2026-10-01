// An evaluation eviction that lands while a tenant rides a car (game readiness review
// 2026-10-01, F8). moveOut used to set the rider `leaving` with no route but left it aboard, so
// it walked or queued while still in the car's list; in a tower whose lunch shuttle never stops
// at the lobby the ghost stayed aboard for good and the shaft could not be demolished. Now an
// evicted rider is let off at the car's next stop like every other eviction, and a waiting
// evictee's old wait is cleared. Every case runs the real tick; the only state seeded by hand is
// the office's rating (infested, below the line for a full day) so tickEvaluation evicts it.

import { describe, expect, it } from 'vitest';

import { deserialize, serialize } from '../../src/sim/save';
import { tick } from '../../src/sim/tick';
import { clockOf } from '../../src/sim/types';
import type { Command, Shaft, Sim, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { buildTower, lobbyRun } from './helpers';

/** Every seat whose sim is gone or not riding, and every rider not in its car's list. */
function seatProblems(world: World): string[] {
  const out: string[] = [];
  const cars = new Map<number, Shaft['cars'][number]>();
  for (const shaft of world.shafts.values()) {
    for (const car of shaft.cars) {
      cars.set(car.id, car);
      for (const id of car.passengers) {
        const sim = world.sims.get(id);
        if (!sim) out.push(`car ${car.id}: seat for removed sim ${id}`);
        else if (sim.state !== 'riding') out.push(`car ${car.id}: sim ${id} aboard but ${sim.state}`);
        else if (sim.inCarId !== car.id) out.push(`car ${car.id}: sim ${id} has inCarId ${sim.inCarId}`);
      }
    }
  }
  for (const sim of world.sims.values()) {
    if (sim.inCarId !== null && !cars.get(sim.inCarId)?.passengers.includes(sim.id)) out.push(`sim ${sim.id} in car ${sim.inCarId} but not seated`);
  }
  return out;
}

const OFFICES_X = [100, 109, 118, 127, 136];

/** Offices on 2, fast food on 3, one shaft from the lobby to 3. */
function quietTower(): World {
  const world = createWorld(11);
  world.cash = 50_000_000;
  world.stars = 3;
  buildTower(world, [
    ...lobbyRun(0, 200),
    ...OFFICES_X.map((x): Command => ({ kind: 'build', room: 'office', floor: 2, x })),
    { kind: 'build', room: 'fastFood', floor: 3, x: 100 },
    { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 3 },
  ]);
  return world;
}

/** The lobby shaft works floors 1 and 2 only; a lunch shuttle works 2 and 3 only and never reaches the lobby. */
function shuttleTower(): World {
  const world = createWorld(21);
  world.cash = 50_000_000;
  world.stars = 3;
  buildTower(world, [
    ...lobbyRun(0, 200),
    { kind: 'shaft.build', shaft: 'standard', x: 10, floorMin: 1, floorMax: 2 },
    ...OFFICES_X.map((x): Command => ({ kind: 'build', room: 'office', floor: 2, x })),
    { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 2, floorMax: 3 },
    { kind: 'build', room: 'fastFood', floor: 3, x: 100 },
  ]);
  return world;
}

/** Offices on 2 to 7, two fast foods on 8, one shaft: busy enough that workers queue for the car. */
function busyTower(): World {
  const world = createWorld(21);
  world.cash = 50_000_000;
  world.stars = 3;
  const offices: Command[] = [];
  for (let f = 2; f <= 7; f++) for (const x of [100, 109, 118, 127, 136, 145, 154, 163, 172]) offices.push({ kind: 'build', room: 'office', floor: f, x });
  buildTower(world, [
    ...lobbyRun(0, 200),
    ...offices,
    { kind: 'build', room: 'fastFood', floor: 8, x: 100 },
    { kind: 'build', room: 'fastFood', floor: 8, x: 116 },
    { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 8 },
  ]);
  return world;
}

type Ride = 'inward' | 'outward' | 'lunch';

function rideOf(world: World, sim: Sim): Ride | null {
  const leg = sim.route[0];
  if (!leg || leg.kind !== 'ride' || sim.homeRoomId === null) return null;
  const home = world.rooms.get(sim.homeRoomId);
  if (leg.fromFloor === 1 && home && leg.toFloor === home.floor) return 'inward';
  if (leg.toFloor === 1) return 'outward';
  if (leg.toFloor === 3) return 'lunch';
  return null;
}

interface Evicted {
  world: World;
  riderId: number;
  evictees: number[];
}

/**
 * Tick the tower on and, at each weekday evaluation minute, try every riding worker on a clone:
 * its office is pushed below the line for a full day and one real tick runs. The first clone of
 * each wanted ride whose rider is still aboard after its eviction is kept.
 */
function evictMidRide(world: World, wanted: readonly Ride[], days: number): Map<Ride, Evicted> {
  const found = new Map<Ride, Evicted>();
  for (let i = 0; i < days * 1440 && found.size < wanted.length; i++) {
    const clock = clockOf(world.time.minute);
    if (clock.minuteOfDay % 60 === 30 && !clock.isWeekend) {
      for (const rider of world.sims.values()) {
        if (rider.kind !== 'worker' || rider.state !== 'riding' || rider.inCarId === null) continue;
        const ride = rideOf(world, rider);
        if (ride === null || !wanted.includes(ride) || found.has(ride)) continue;
        const loaded = deserialize(serialize(world));
        if (!loaded.ok) throw new Error(loaded.reason);
        const clone = loaded.world;
        const office = clone.rooms.get(rider.homeRoomId as number);
        if (!office) continue;
        const evictees = [...office.tenants];
        office.infested = true;
        office.lowEvalSinceMinute = clone.time.minute - 1440;
        tick(clone);
        const after = clone.sims.get(rider.id);
        if (!after || after.inCarId === null || after.homeRoomId !== null) continue; // off before the evaluation ran
        found.set(ride, { world: clone, riderId: rider.id, evictees });
      }
    }
    tick(world);
  }
  return found;
}

/** From the eviction tick on: the passenger invariants hold every tick and every evictee walks out of the tower. */
function followOut(evicted: Evicted, limit: number): number {
  const { world, evictees } = evicted;
  expect(seatProblems(world)).toEqual([]);
  let t = 0;
  while (evictees.some((id) => world.sims.has(id)) && t < limit) {
    tick(world);
    t += 1;
    expect(seatProblems(world)).toEqual([]);
  }
  expect(evictees.filter((id) => world.sims.has(id))).toEqual([]);
  return t;
}

describe('an evaluation eviction during a ride', () => {
  it('in the lunch shuttle tower: inward, outward and lunch rides all get off and leave', () => {
    const found = evictMidRide(shuttleTower(), ['inward', 'outward', 'lunch'], 6);
    expect([...found.keys()].sort()).toEqual(['inward', 'lunch', 'outward']);
    for (const evicted of found.values()) {
      const rider = evicted.world.sims.get(evicted.riderId) as Sim;
      // Still aboard, as a rider, to the car's next stop.
      expect(rider.state).toBe('riding');
      expect(rider.route).toHaveLength(1);
      expect(rider.exiting).toBe(true);
      followOut(evicted, 6 * 60);
    }
  });

  it('in a one shaft tower: inward and lunch rides get off at the next stop and leave', () => {
    const found = evictMidRide(quietTower(), ['inward', 'lunch'], 6);
    expect([...found.keys()].sort()).toEqual(['inward', 'lunch']);
    for (const evicted of found.values()) {
      const minutes = followOut(evicted, 6 * 60);
      expect(minutes).toBeGreaterThan(0);
    }
  });

  it('a waiting evictee starts its walk out with no old wait on the clock', () => {
    const world = busyTower();
    let checked = 0;
    for (let i = 0; i < 3 * 1440 && checked === 0; i++) {
      const clock = clockOf(world.time.minute);
      if (clock.minuteOfDay % 60 === 30 && !clock.isWeekend) {
        const waiter = [...world.sims.values()].find((s) => s.kind === 'worker' && s.state === 'waiting' && s.waitStart !== null && s.homeRoomId !== null);
        if (waiter) {
          const loaded = deserialize(serialize(world));
          if (!loaded.ok) throw new Error(loaded.reason);
          const clone = loaded.world;
          const office = clone.rooms.get(waiter.homeRoomId as number);
          if (office) {
            office.infested = true;
            office.lowEvalSinceMinute = clone.time.minute - 1440;
            const evictees = [...office.tenants];
            tick(clone);
            const after = clone.sims.get(waiter.id);
            if (after && after.homeRoomId === null && after.inCarId === null && after.state === 'leaving') {
              expect(after.waitStart).toBeNull();
              expect(after.firstWaitStart).toBeUndefined();
              followOut({ world: clone, riderId: waiter.id, evictees }, 6 * 60);
              checked += 1;
            }
          }
        }
      }
      tick(world);
    }
    expect(checked).toBe(1);
  });
});
