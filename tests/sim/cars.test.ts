// Per car floor ranges and rider settings: who a car carries, where it works, and
// what the leftover rule lets it do when its own riders have nothing on.

import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { isLeftoverCar, requestHallCall, stopOffRefusal, tickElevators } from '../../src/sim/elevators';
import { findRoute } from '../../src/sim/routing';
import { SHAFTS } from '../../src/sim/rules';
import { deserialize, hashWorld, serialize, SAVE_VERSION } from '../../src/sim/save';
import { carCovers, riderClassOf } from '../../src/sim/types';
import type { Car, Id, Shaft, ShaftKind, Sim, SimKind, World } from '../../src/sim/types';
import { addShaft, addSim, allocId, createWorld } from '../../src/sim/world';

interface CarOpts {
  y?: number;
  serves?: Car['serves'];
  range?: { lo: number; hi: number } | null;
}

interface ShaftOpts {
  kind?: ShaftKind;
  x?: number;
  floorMin?: number;
  floorMax?: number;
  stops?: number[];
  cars?: CarOpts[];
  homeFloor?: number;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let f = from; f <= to; f++) out.push(f);
  return out;
}

function buildShaft(world: World, opts: ShaftOpts = {}): Shaft {
  const kind = opts.kind ?? 'standard';
  const floorMin = opts.floorMin ?? 1;
  const floorMax = opts.floorMax ?? 10;
  const shaft: Shaft = {
    id: allocId(world),
    kind,
    x: opts.x ?? 150,
    width: SHAFTS[kind].width,
    floorMin,
    floorMax,
    stops: new Set(opts.stops ?? range(floorMin, floorMax)),
    homeFloor: opts.homeFloor ?? floorMin,
    cars: [],
    hallCalls: new Map(),
  };
  for (const car of opts.cars ?? [{}]) {
    shaft.cars.push({
      id: allocId(world),
      shaftId: shaft.id,
      y: car.y ?? floorMin,
      dir: 0,
      state: 'idle',
      doorTimer: 0,
      idleSince: null,
      passengers: [],
      calls: new Set<number>(),
      serves: car.serves ?? 'any',
      range: car.range ?? null,
    });
  }
  addShaft(world, shaft);
  return shaft;
}

function carAt(shaft: Shaft, index: number): Car {
  const car = shaft.cars[index];
  if (!car) throw new Error(`no car ${index}`);
  return car;
}

/** A sim of some kind standing at the doors, wanting a ride, with its hall call in. */
function addWaiter(
  world: World,
  shaft: Shaft,
  kind: SimKind,
  fromFloor: number,
  toFloor: number,
): Sim {
  const sim: Sim = {
    id: allocId(world),
    kind,
    homeRoomId: null,
    pos: { floor: fromFloor, x: shaft.x },
    inCarId: null,
    inRoomId: null,
    route: [{ kind: 'ride', shaftId: shaft.id, fromFloor, toFloor }],
    state: 'waiting',
    stress: 0,
    waitStart: world.time.minute,
    schedule: [],
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
  };
  addSim(world, sim);
  requestHallCall(world, shaft.id, fromFloor, toFloor > fromFloor ? 1 : -1, riderClassOf(kind));
  return sim;
}

function run(world: World, minutes: number): void {
  for (let i = 0; i < minutes; i++) {
    tickElevators(world);
    world.time.minute += 1;
  }
}

describe('riderClassOf', () => {
  it('sorts every sim kind into hotel, office or other', () => {
    expect(riderClassOf('guest')).toBe('hotel');
    expect(riderClassOf('vip')).toBe('hotel');
    expect(riderClassOf('worker')).toBe('office');
    expect(riderClassOf('resident')).toBe('other');
    expect(riderClassOf('shopper')).toBe('other');
    expect(riderClassOf('diner')).toBe('other');
    expect(riderClassOf('staff')).toBe('other');
    expect(riderClassOf('visitor')).toBe('other');
  });
});

describe('carCovers', () => {
  it('follows the shaft with no range, and the range when there is one', () => {
    const world = createWorld(1);
    const shaft = buildShaft(world, { cars: [{}, { range: { lo: 3, hi: 5 } }] });
    expect(carCovers(shaft, carAt(shaft, 0), 10)).toBe(true);
    expect(carCovers(shaft, carAt(shaft, 1), 3)).toBe(true);
    expect(carCovers(shaft, carAt(shaft, 1), 6)).toBe(false);
  });
});

describe('dispatch by rider class', () => {
  it('leaves an office call to the general car while the hotel car has its own work', () => {
    const world = createWorld(2);
    const shaft = buildShaft(world, {
      cars: [{ serves: 'hotel', y: 5 }, { serves: 'any', y: 1 }],
    });
    const hotelCar = carAt(shaft, 0);
    const generalCar = carAt(shaft, 1);
    // A hotel guest waiting somewhere in the shaft keeps the hotel car dedicated.
    requestHallCall(world, shaft.id, 2, 1, 'hotel');
    const worker = addWaiter(world, shaft, 'worker', 5, 8);

    expect(isLeftoverCar(shaft, hotelCar)).toBe(false);
    run(world, 6);
    expect(worker.inCarId).toBe(generalCar.id);
    expect(hotelCar.passengers).toEqual([]);
  });

  it('lets an idle hotel car take an office call when no hotel call is pending', () => {
    const world = createWorld(3);
    const shaft = buildShaft(world, { cars: [{ serves: 'hotel', y: 5 }] });
    const car = carAt(shaft, 0);
    const worker = addWaiter(world, shaft, 'worker', 5, 8);

    expect(isLeftoverCar(shaft, car)).toBe(true);
    run(world, 2);
    expect(worker.inCarId).toBe(car.id);
  });

  it('holds that same car for its own riders while a hotel call is pending', () => {
    const world = createWorld(3);
    const shaft = buildShaft(world, { cars: [{ serves: 'hotel', y: 5 }] });
    const car = carAt(shaft, 0);
    requestHallCall(world, shaft.id, 3, 1, 'hotel');
    const worker = addWaiter(world, shaft, 'worker', 5, 8);

    expect(isLeftoverCar(shaft, car)).toBe(false);
    run(world, 1);
    expect(worker.inCarId).toBeNull();
    expect(worker.state).toBe('waiting');
    expect(car.y).toBeLessThan(5); // gone down to its own call instead
    expect(shaft.hallCalls.get(5)?.up.has('office')).toBe(true);
  });

  it('holds a hotel car with someone already aboard, even with no hotel call pending', () => {
    const world = createWorld(3);
    const shaft = buildShaft(world, { cars: [{ serves: 'hotel', y: 5 }] });
    const car = carAt(shaft, 0);
    car.passengers.push(allocId(world)); // a hotel guest already riding, no hall call needed
    const worker = addWaiter(world, shaft, 'worker', 5, 8);

    expect(isLeftoverCar(shaft, car)).toBe(false);
    run(world, 2);
    expect(worker.inCarId).toBeNull();
    expect(worker.state).toBe('waiting');
  });
});

describe('a car with a range', () => {
  it('never targets a floor outside it', () => {
    const world = createWorld(4);
    const shaft = buildShaft(world, { cars: [{ range: { lo: 1, hi: 5 } }] });
    const car = carAt(shaft, 0);
    addWaiter(world, shaft, 'worker', 8, 10); // a call it cannot answer
    requestHallCall(world, shaft.id, 3, 1, 'office');

    let highest = car.y;
    for (let i = 0; i < 30; i++) {
      tickElevators(world);
      world.time.minute += 1;
      highest = Math.max(highest, car.y);
    }
    expect(highest).toBeLessThanOrEqual(5);
  });

  it('moves into the range when the range changes under it', () => {
    const world = createWorld(4);
    const shaft = buildShaft(world, { cars: [{ y: 1 }] });
    const car = carAt(shaft, 0);
    expect(
      applyCommand(world, {
        kind: 'shaft.setCarRange',
        shaftId: shaft.id,
        carId: car.id,
        range: { lo: 7, hi: 10 },
      }),
    ).toEqual({ ok: true });

    run(world, 30);
    expect(car.y).toBeGreaterThanOrEqual(7);
  });
});

describe('boarding', () => {
  it('refuses a sim whose floor the car does not work, and keeps the call lit', () => {
    const world = createWorld(5);
    const shaft = buildShaft(world, { cars: [{ range: { lo: 1, hi: 5 }, y: 1 }] });
    const car = carAt(shaft, 0);
    const worker = addWaiter(world, shaft, 'worker', 3, 9);

    run(world, 12);
    expect(worker.state).toBe('waiting');
    expect(worker.inCarId).toBeNull();
    expect(car.passengers).toEqual([]);
    expect(shaft.hallCalls.get(3)?.up.has('office')).toBe(true);
  });

  it('refuses a rider of the wrong class while the car has its own call pending', () => {
    const world = createWorld(5);
    const shaft = buildShaft(world, { cars: [{ serves: 'hotel', y: 1 }] });
    const guest = addWaiter(world, shaft, 'guest', 1, 6);
    const worker = addWaiter(world, shaft, 'worker', 1, 6);

    run(world, 1);
    expect(guest.inCarId).not.toBeNull();
    expect(worker.inCarId).toBeNull();
    expect(shaft.hallCalls.get(1)?.up.has('office')).toBe(true);
  });
});

describe('routing', () => {
  function shaftWorld(cars: CarOpts[]): { world: World; shaft: Shaft } {
    const world = createWorld(6);
    const shaft = buildShaft(world, { x: 150, floorMin: 1, floorMax: 10, cars });
    world.routingDirty = true;
    return { world, shaft };
  }

  it('is no route for an office worker when every car is dedicated to hotel guests', () => {
    const { world } = shaftWorld([{ serves: 'hotel' }]);
    expect(findRoute(world, { floor: 1, x: 150 }, { floor: 6, x: 150 }, { riderClass: 'office' })).toBeNull();
    expect(findRoute(world, { floor: 1, x: 150 }, { floor: 6, x: 150 }, { riderClass: 'hotel' })).not.toBeNull();
  });

  it('becomes a route once one car carries everyone', () => {
    const { world, shaft } = shaftWorld([{ serves: 'hotel' }]);
    expect(findRoute(world, { floor: 1, x: 150 }, { floor: 6, x: 150 }, { riderClass: 'office' })).toBeNull();
    const added = applyCommand(world, { kind: 'shaft.addCar', shaftId: shaft.id });
    expect(added).toEqual({ ok: true });
    expect(findRoute(world, { floor: 1, x: 150 }, { floor: 6, x: 150 }, { riderClass: 'office' })).not.toBeNull();
  });

  it('only joins two floors that one car works', () => {
    const { world } = shaftWorld([
      { range: { lo: 1, hi: 5 } },
      { range: { lo: 5, hi: 10 } },
    ]);
    const near = findRoute(world, { floor: 1, x: 150 }, { floor: 4, x: 150 }, { riderClass: 'office' });
    expect(near).not.toBeNull();
    // No car works both ends, and nobody transfers between two cars of one shaft.
    expect(findRoute(world, { floor: 1, x: 150 }, { floor: 10, x: 150 }, { riderClass: 'office' })).toBeNull();
  });

  it('never plans a trip on the leftover rule', () => {
    const { world } = shaftWorld([{ serves: 'office' }]);
    // The car would pick a shopper up at the door when it is idle, but a route may
    // not be planned on that, so routing says no.
    expect(findRoute(world, { floor: 1, x: 150 }, { floor: 6, x: 150 }, { riderClass: 'other' })).toBeNull();
  });
});

describe('commands', () => {
  function shaftWith(world: World): Shaft {
    return buildShaft(world, { floorMin: 1, floorMax: 10, cars: [{}] });
  }

  it('cycles what a car carries and costs nothing', () => {
    const world = createWorld(7);
    const shaft = shaftWith(world);
    const cash = world.cash;
    const car = carAt(shaft, 0);
    expect(
      applyCommand(world, { kind: 'shaft.setCarServes', shaftId: shaft.id, carId: car.id, serves: 'hotel' }),
    ).toEqual({ ok: true });
    expect(car.serves).toBe('hotel');
    expect(world.cash).toBe(cash);
  });

  it('refuses a range that leaves the shaft or turns upside down', () => {
    const world = createWorld(7);
    const shaft = shaftWith(world);
    const car = carAt(shaft, 0);
    const over = applyCommand(world, {
      kind: 'shaft.setCarRange',
      shaftId: shaft.id,
      carId: car.id,
      range: { lo: 1, hi: 12 },
    });
    expect(over).toEqual({ ok: false, reason: 'That floor is not on this elevator.' });
    const upsideDown = applyCommand(world, {
      kind: 'shaft.setCarRange',
      shaftId: shaft.id,
      carId: car.id,
      range: { lo: 8, hi: 4 },
    });
    expect(upsideDown).toEqual({ ok: false, reason: 'The bottom floor cannot be above the top floor.' });
    expect(car.range).toBeNull();
  });

  it('refuses a range that leaves the car with only one floor', () => {
    const world = createWorld(7);
    const shaft = shaftWith(world);
    const car = carAt(shaft, 0);
    const single = applyCommand(world, {
      kind: 'shaft.setCarRange',
      shaftId: shaft.id,
      carId: car.id,
      range: { lo: 4, hi: 4 },
    });
    expect(single).toEqual({ ok: false, reason: 'A car must serve at least two floors.' });
    expect(car.range).toBeNull();
  });

  it('accepts a range of exactly two floors', () => {
    const world = createWorld(7);
    const shaft = shaftWith(world);
    const car = carAt(shaft, 0);
    expect(
      applyCommand(world, {
        kind: 'shaft.setCarRange',
        shaftId: shaft.id,
        carId: car.id,
        range: { lo: 4, hi: 5 },
      }),
    ).toEqual({ ok: true });
    expect(car.range).toEqual({ lo: 4, hi: 5 });
  });

  it('refuses an unknown car and takes the whole shaft back', () => {
    const world = createWorld(7);
    const shaft = shaftWith(world);
    const car = carAt(shaft, 0);
    expect(
      applyCommand(world, { kind: 'shaft.setCarRange', shaftId: shaft.id, carId: 9999, range: null }),
    ).toEqual({ ok: false, reason: 'That car is gone.' });
    applyCommand(world, {
      kind: 'shaft.setCarRange',
      shaftId: shaft.id,
      carId: car.id,
      range: { lo: 2, hi: 6 },
    });
    expect(car.range).toEqual({ lo: 2, hi: 6 });
    applyCommand(world, { kind: 'shaft.setCarRange', shaftId: shaft.id, carId: car.id, range: null });
    expect(car.range).toBeNull();
  });

  it('still removes a car with settings on it', () => {
    const world = createWorld(7);
    world.cash = 1_000_000;
    const shaft = shaftWith(world);
    expect(applyCommand(world, { kind: 'shaft.addCar', shaftId: shaft.id })).toEqual({ ok: true });
    const second = carAt(shaft, 1);
    applyCommand(world, { kind: 'shaft.setCarServes', shaftId: shaft.id, carId: second.id, serves: 'office' });
    expect(applyCommand(world, { kind: 'shaft.removeCar', shaftId: shaft.id })).toEqual({ ok: true });
    expect(shaft.cars).toHaveLength(1);
  });

  // Audit 2026-09-25 I S2: a refused command leaves the world as it was; the car limit
  // refusal was never checked for cash or hash.
  it('I S2: refuses a car past the limit and changes neither cash nor hash', () => {
    const world = createWorld(7);
    world.cash = 10_000_000;
    const shaft = shaftWith(world);
    const maxCars = SHAFTS.standard.maxCars;
    while (shaft.cars.length < maxCars) {
      expect(applyCommand(world, { kind: 'shaft.addCar', shaftId: shaft.id })).toEqual({ ok: true });
    }
    const cash = world.cash;
    const hash = hashWorld(world);
    expect(applyCommand(world, { kind: 'shaft.addCar', shaftId: shaft.id })).toEqual({
      ok: false,
      reason: `This elevator already has ${maxCars} cars.`,
    });
    expect(shaft.cars).toHaveLength(maxCars);
    expect(world.cash).toBe(cash);
    expect(hashWorld(world)).toBe(hash);
  });

  // Audit 2026-09-25 I S9: the Verification table's "a car with people inside refuses a
  // range change" had no test.
  it('I S9a: refuses a range change while a rider is aboard and keeps the old range', () => {
    const world = createWorld(7);
    const shaft = buildShaft(world, { floorMax: 6 });
    const car = carAt(shaft, 0);
    const rider = addWaiter(world, shaft, 'diner', 1, 2);
    run(world, 2);
    expect(rider.state).toBe('riding');
    expect(car.passengers).toContain(rider.id);
    expect(
      applyCommand(world, { kind: 'shaft.setCarRange', shaftId: shaft.id, carId: car.id, range: { lo: 1, hi: 3 } }),
    ).toEqual({ ok: false, reason: 'People are inside.' });
    expect(car.range).toBeNull();
  });
});

// Audit 2026-09-25 B S2: turning a stop off under a rider bound for it would strand them.
// The refusal lives in elevators.ts; build.ts's shaft.setStop handler returns it.
describe('turning off a stop someone is riding to', () => {
  it('is refused in plain words while a rider aboard is bound for that floor', () => {
    const world = createWorld(7);
    const shaft = buildShaft(world, { floorMax: 6 });
    const rider = addWaiter(world, shaft, 'diner', 1, 4);
    run(world, 2);
    expect(rider.state).toBe('riding');
    expect(stopOffRefusal(world, shaft, 4)).toBe('Someone is riding to that floor.');
  });

  it('is allowed for a floor no rider aboard is bound for', () => {
    const world = createWorld(7);
    const shaft = buildShaft(world, { floorMax: 6 });
    const rider = addWaiter(world, shaft, 'diner', 1, 4);
    run(world, 2);
    expect(rider.state).toBe('riding');
    expect(stopOffRefusal(world, shaft, 5)).toBeNull();
  });

  it('refuses the setStop off command and keeps the stop', () => {
    const world = createWorld(7);
    const shaft = buildShaft(world, { floorMax: 6 });
    const rider = addWaiter(world, shaft, 'diner', 1, 4);
    run(world, 2);
    expect(rider.state).toBe('riding');
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 4, stops: false })).toEqual({
      ok: false,
      reason: 'Someone is riding to that floor.',
    });
    expect(shaft.stops.has(4)).toBe(true);
  });

  it('still takes the setStop off command for a floor no rider is bound for', () => {
    const world = createWorld(7);
    const shaft = buildShaft(world, { floorMax: 6 });
    const rider = addWaiter(world, shaft, 'diner', 1, 4);
    run(world, 2);
    expect(rider.state).toBe('riding');
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 5, stops: false })).toEqual({ ok: true });
    expect(shaft.stops.has(5)).toBe(false);
  });
});

describe('saves', () => {
  function worldWithSettings(): { world: World; shaftId: Id; carId: Id } {
    const world = createWorld(8);
    const shaft = buildShaft(world, {
      cars: [{ serves: 'hotel', range: { lo: 2, hi: 6 } }, { serves: 'any' }],
    });
    requestHallCall(world, shaft.id, 3, 1, 'hotel');
    requestHallCall(world, shaft.id, 3, 1, 'other');
    requestHallCall(world, shaft.id, 4, -1, 'office');
    return { world, shaftId: shaft.id, carId: carAt(shaft, 0).id };
  }

  it('keeps serves, range and the hall call classes through a round trip', () => {
    const { world, shaftId } = worldWithSettings();
    const text = serialize(world);
    expect(JSON.parse(text).version).toBe(5);
    expect(SAVE_VERSION).toBe(5);

    const result = deserialize(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shaft = result.world.shafts.get(shaftId) as Shaft;
    expect(shaft.cars[0]?.serves).toBe('hotel');
    expect(shaft.cars[0]?.range).toEqual({ lo: 2, hi: 6 });
    expect(shaft.cars[1]?.serves).toBe('any');
    expect(shaft.cars[1]?.range).toBeNull();
    expect(shaft.hallCalls.get(3)?.up).toEqual(new Set(['hotel', 'other']));
    expect(shaft.hallCalls.get(4)?.down).toEqual(new Set(['office']));
    expect(hashWorld(result.world)).toBe(hashWorld(world));
  });

  it('loads a version 1 save with the old defaults', () => {
    const { world, shaftId } = worldWithSettings();
    // Roll the save back to what version 1 wrote: no car settings, one bit per direction.
    const data = JSON.parse(serialize(world));
    data.version = 1;
    for (const shaft of data.shafts) {
      for (const car of shaft.cars) {
        delete car.serves;
        delete car.range;
      }
      shaft.hallCalls = shaft.hallCalls.map(([floor, call]: [number, { up: string[]; down: string[] }]) => [
        floor,
        { up: call.up.length > 0, down: call.down.length > 0 },
      ]);
    }

    const result = deserialize(JSON.stringify(data));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shaft = result.world.shafts.get(shaftId) as Shaft;
    for (const car of shaft.cars) {
      expect(car.serves).toBe('any');
      expect(car.range).toBeNull();
    }
    // A v1 light said somebody was waiting, without saying who: everybody, then.
    expect(shaft.hallCalls.get(3)?.up).toEqual(new Set(['hotel', 'office', 'other']));
    expect(shaft.hallCalls.get(3)?.down.size).toBe(0);
  });

  it('refuses a version it does not know and a bad car setting', () => {
    const { world } = worldWithSettings();
    const future = JSON.parse(serialize(world));
    future.version = 99;
    expect(deserialize(JSON.stringify(future))).toEqual({
      ok: false,
      reason: 'This save is from a different version of the game.',
    });

    const bad = JSON.parse(serialize(world));
    bad.shafts[0].cars[0].serves = 'penthouse';
    const result = deserialize(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('shafts[0].cars[0].serves');

    const badRange = JSON.parse(serialize(world));
    badRange.shafts[0].cars[0].range = { lo: 4, hi: 99 };
    const ranged = deserialize(JSON.stringify(badRange));
    expect(ranged.ok).toBe(false);
    if (ranged.ok) return;
    expect(ranged.reason).toContain('shafts[0].cars[0].range');
  });

  it('moves the world hash when a car changes who it carries', () => {
    const { world, shaftId, carId } = worldWithSettings();
    const before = hashWorld(world);
    applyCommand(world, { kind: 'shaft.setCarServes', shaftId, carId, serves: 'office' });
    expect(hashWorld(world)).not.toBe(before);
  });
});
