// Audit 2026-09-25 B S3, B S7, B S8: nobody is left stuck, or moved, by a way that is gone.
// S3: a person on the way out whose floor loses its last route gives up after the retry
// budget. S7: stairs demolished mid climb are not climbed. S8: a car whose floors change
// while its doors are open does not board a rider at a floor outside its new floors.

import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { requestHallCall } from '../../src/sim/elevators';
import { HALL_CALL_RETRY_MINUTES, RETRIES_BEFORE_REROUTE } from '../../src/sim/people';
import { tick } from '../../src/sim/tick';
import type { Room, Sim, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { buildTower, lobbyRun, onlyShaft } from './helpers';

function baseTower(): World {
  const world = createWorld(11);
  world.cash = 50_000_000;
  buildTower(world, lobbyRun(100, 159));
  return world;
}

function shopper(world: World, over: Partial<Sim>): Sim {
  const sim: Sim = {
    id: world.nextId++,
    kind: 'shopper',
    homeRoomId: null,
    pos: { floor: 1, x: 150 },
    inCarId: null,
    inRoomId: null,
    route: [],
    state: 'walking',
    stress: 0,
    waitStart: null,
    schedule: [],
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
    ...over,
  };
  world.sims.set(sim.id, sim);
  return sim;
}

describe('B S3: an exiting person whose floor loses its only route', () => {
  it('gives up and is gone within the retry budget, with a plain reason in the log', () => {
    const world = baseTower();
    buildTower(world, [
      { kind: 'build', room: 'office', floor: 2, x: 100 },
      { kind: 'build', room: 'fastFood', floor: 3, x: 100 },
      { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 3 },
    ]);
    const shaft = onlyShaft(world);
    let diner: Sim | undefined;
    for (let i = 0; i < 3000 && !diner; i++) {
      tick(world);
      diner = [...world.sims.values()].find((s) => s.kind === 'diner' && s.state === 'waiting' && s.exiting && s.pos.floor === 3);
    }
    if (!diner) throw new Error('no diner ever waited on 3 on the way out');
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 3, stops: false }).ok).toBe(true);

    const budget = HALL_CALL_RETRY_MINUTES * RETRIES_BEFORE_REROUTE + 1;
    for (let i = 0; i < budget && world.sims.has(diner.id); i++) tick(world);
    expect(world.sims.has(diner.id)).toBe(false);
    expect(world.log.some((e) => e.text === 'Someone on floor 3 found no way out and left the tower.')).toBe(true);
  });
});

describe('B S7: stairs demolished mid climb', () => {
  it('are not climbed: the sim stays on floor 1', () => {
    const world = baseTower();
    buildTower(world, [
      { kind: 'build', room: 'stairs', floor: 1, x: 120 },
      { kind: 'build', room: 'office', floor: 2, x: 100 },
      { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 2 },
    ]);
    const stairs = [...world.rooms.values()].find((r) => r.kind === 'stairs') as Room;
    const sim = shopper(world, {
      pos: { floor: 1, x: 110 },
      route: [{ kind: 'walk', toX: 124 }, { kind: 'stairs', roomId: stairs.id, toFloor: 2 }, { kind: 'walk', toX: 104 }],
    });
    expect(applyCommand(world, { kind: 'demolish', roomId: stairs.id }).ok).toBe(true);
    for (let i = 0; i < 3; i++) {
      tick(world);
      if (world.sims.has(sim.id)) expect(sim.pos.floor).toBe(1);
    }
  });
});

describe('B S8: a car range changed while its doors are open', () => {
  it('does not board a rider at a floor outside the new range', () => {
    const world = baseTower();
    buildTower(world, [{ kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 5 }]);
    const shaft = onlyShaft(world);
    const car = shaft.cars[0];
    if (!car) throw new Error('no car');
    for (let i = 0; i < 3; i++) tick(world);
    requestHallCall(world, shaft.id, 1, 1, 'other'); // a caller who walked away: the car opens at 1, empty
    for (let i = 0; i < 5 && car.state !== 'doorsOpen'; i++) tick(world);
    expect(car.state).toBe('doorsOpen');
    expect(car.y).toBe(1);
    const b = shopper(world, {
      pos: { floor: 1, x: 150 },
      state: 'waiting',
      waitStart: world.time.minute,
      route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 5 }, { kind: 'walk', toX: 100 }],
    });
    expect(applyCommand(world, { kind: 'shaft.setCarRange', shaftId: shaft.id, carId: car.id, range: { lo: 4, hi: 5 } }).ok).toBe(true);
    tick(world);
    expect(b.state).toBe('waiting');
    expect(b.inCarId).toBeNull();
    expect(car.passengers).toEqual([]);
  });
});
