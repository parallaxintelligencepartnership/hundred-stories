import { describe, expect, it } from 'vitest';

import { IDLE_RETURN_MINUTES, requestHallCall, tickElevators } from '../../src/sim/elevators';
import { SHAFTS } from '../../src/sim/rules';
import type { Car, Shaft, ShaftKind, Sim, World } from '../../src/sim/types';
import { addShaft, addSim, allocId, createWorld } from '../../src/sim/world';

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let f = from; f <= to; f++) out.push(f);
  return out;
}

interface ShaftOpts {
  kind?: ShaftKind;
  x?: number;
  floorMin?: number;
  floorMax?: number;
  stops?: number[];
  cars?: number[]; // starting floor of each car
  homeFloor?: number;
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
  for (const y of opts.cars ?? [floorMin]) {
    shaft.cars.push({
      id: allocId(world),
      shaftId: shaft.id,
      y,
      dir: 0,
      state: 'idle',
      doorTimer: 0,
      idleSince: null,
      passengers: [],
      calls: new Set<number>(),
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

/** A sim standing at the shaft door on fromFloor, wanting a ride to toFloor. */
function addWaiter(world: World, shaft: Shaft, fromFloor: number, toFloor: number, x?: number): Sim {
  const sim: Sim = {
    id: allocId(world),
    kind: 'worker',
    homeRoomId: null,
    pos: { floor: fromFloor, x: x ?? shaft.x },
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
  requestHallCall(world, shaft.id, fromFloor, toFloor > fromFloor ? 1 : -1);
  return sim;
}

/** One game minute, the way tick.ts runs it: elevators, then the clock. */
function run(world: World, minutes: number, before?: (minute: number) => void): void {
  for (let i = 0; i < minutes; i++) {
    before?.(world.time.minute);
    tickElevators(world);
    world.time.minute += 1;
  }
}

/** Floors where the car opened its doors, in order. */
function recordStops(world: World, car: Car, minutes: number): number[] {
  const stops: number[] = [];
  let wasOpen = car.state === 'doorsOpen';
  for (let i = 0; i < minutes; i++) {
    tickElevators(world);
    world.time.minute += 1;
    const open = car.state === 'doorsOpen';
    if (open && !wasOpen) stops.push(Math.round(car.y));
    wasOpen = open;
  }
  return stops;
}

describe('requestHallCall', () => {
  it('registers a call in one direction at a time', () => {
    const world = createWorld(1);
    const shaft = buildShaft(world);
    requestHallCall(world, shaft.id, 4, 1);
    expect(shaft.hallCalls.get(4)).toEqual({ up: true, down: false });
    requestHallCall(world, shaft.id, 4, -1);
    expect(shaft.hallCalls.get(4)).toEqual({ up: true, down: true });
  });

  it('ignores floors the shaft does not stop at', () => {
    const world = createWorld(1);
    const shaft = buildShaft(world, {
      kind: 'express',
      floorMin: 1,
      floorMax: 30,
      stops: [1, 15, 30],
    });
    requestHallCall(world, shaft.id, 7, 1);
    expect(shaft.hallCalls.has(7)).toBe(false);
    requestHallCall(world, shaft.id, 15, 1);
    expect(shaft.hallCalls.has(15)).toBe(true);
  });

  it('ignores an unknown shaft and a floor outside the span', () => {
    const world = createWorld(1);
    const shaft = buildShaft(world, { floorMin: 1, floorMax: 10 });
    expect(() => requestHallCall(world, 9999, 3, 1)).not.toThrow();
    requestHallCall(world, shaft.id, 44, 1);
    expect(shaft.hallCalls.size).toBe(0);
  });
});

describe('tickElevators: a single ride', () => {
  it('picks up a waiting sim and delivers it to its floor', () => {
    const world = createWorld(2);
    const shaft = buildShaft(world);
    const car = carAt(shaft, 0);
    const sim = addWaiter(world, shaft, 1, 5);

    run(world, 1);
    expect(sim.state).toBe('riding');
    expect(sim.inCarId).toBe(car.id);
    expect(car.passengers).toEqual([sim.id]);
    expect([...car.calls]).toEqual([5]);
    expect(sim.route).toHaveLength(1);

    run(world, 5);
    expect(sim.state).toBe('walking');
    expect(sim.inCarId).toBeNull();
    expect(sim.pos).toEqual({ floor: 5, x: shaft.x });
    expect(sim.route).toEqual([]);
    expect(car.passengers).toEqual([]);
    expect(car.calls.size).toBe(0);
  });

  it('clears the hall call once the sim is aboard', () => {
    const world = createWorld(2);
    const shaft = buildShaft(world);
    addWaiter(world, shaft, 1, 5);
    expect(shaft.hallCalls.get(1)).toEqual({ up: true, down: false });
    run(world, 1);
    expect(shaft.hallCalls.size).toBe(0);
  });

  it('leaves the sim alone and adds no stress of its own', () => {
    const world = createWorld(2);
    const shaft = buildShaft(world, { cars: [10] });
    const sim = addWaiter(world, shaft, 1, 5);
    run(world, 2);
    expect(sim.stress).toBe(0);
    expect(sim.waitStart).toBe(6 * 60);
    run(world, 8);
    expect(sim.state).toBe('walking');
    expect(sim.stress).toBe(0);
  });

  it('does not stop at floors that have no call', () => {
    const world = createWorld(2);
    const shaft = buildShaft(world);
    const car = carAt(shaft, 0);
    addWaiter(world, shaft, 1, 10);
    expect(recordStops(world, car, 8)).toEqual([1, 10]);
  });

  it('does not board a sim standing away from the shaft door', () => {
    const world = createWorld(2);
    const shaft = buildShaft(world);
    const sim = addWaiter(world, shaft, 1, 5, shaft.x + shaft.width + 2);
    run(world, 3);
    expect(sim.state).toBe('waiting');
    expect(sim.inCarId).toBeNull();
  });
});

describe('tickElevators: capacity', () => {
  it('leaves the 22nd sim waiting when the car is full', () => {
    const world = createWorld(3);
    const shaft = buildShaft(world);
    const car = carAt(shaft, 0);
    const sims = range(1, 22).map(() => addWaiter(world, shaft, 1, 10));
    run(world, 1);
    expect(car.passengers).toHaveLength(SHAFTS.standard.capacity);
    expect(sims.filter((s) => s.state === 'riding')).toHaveLength(21);
    const last = sims[21];
    expect(last?.state).toBe('waiting');
    expect(last?.inCarId).toBeNull();
    expect(last?.route).toHaveLength(1);
  });

  it('comes back for the sim the full car left behind', () => {
    const world = createWorld(3);
    const shaft = buildShaft(world);
    const sims = range(1, 22).map(() => addWaiter(world, shaft, 1, 10));
    run(world, 30);
    expect(sims.every((s) => s.state === 'walking')).toBe(true);
    expect(sims.every((s) => s.pos.floor === 10)).toBe(true);
  });

  it('passes a hall call without opening while it is full', () => {
    const world = createWorld(3);
    const shaft = buildShaft(world);
    const car = carAt(shaft, 0);
    range(1, 21).forEach(() => addWaiter(world, shaft, 1, 10));
    const stranded = addWaiter(world, shaft, 5, 10);
    expect(recordStops(world, car, 5)).toEqual([1, 10]);
    expect(stranded.state).toBe('waiting');
    expect(shaft.hallCalls.get(5)).toEqual({ up: true, down: false });
  });

  it('alights before boarding, so a freed seat can be filled at the same floor', () => {
    const world = createWorld(3);
    const shaft = buildShaft(world);
    const car = carAt(shaft, 0);
    const riders = range(1, 21).map(() => addWaiter(world, shaft, 1, 5));
    const boarder = addWaiter(world, shaft, 5, 10);
    run(world, 3);
    expect(riders.every((s) => s.state === 'walking' && s.pos.floor === 5)).toBe(true);
    expect(boarder.state).toBe('riding');
    expect(car.passengers).toEqual([boarder.id]);
  });
});

describe('tickElevators: SCAN dispatch', () => {
  it('serves floors in order without reversing early', () => {
    const world = createWorld(4);
    const shaft = buildShaft(world);
    const car = carAt(shaft, 0);
    for (const floor of [3, 5, 7]) addWaiter(world, shaft, floor, 10);
    const dirs: number[] = [];
    const stops: number[] = [];
    let wasOpen = false;
    for (let i = 0; i < 12; i++) {
      tickElevators(world);
      world.time.minute += 1;
      dirs.push(car.dir);
      const open = car.state === 'doorsOpen';
      if (open && !wasOpen) stops.push(Math.round(car.y));
      wasOpen = open;
      if (stops.length === 4) break;
    }
    expect(stops).toEqual([3, 5, 7, 10]);
    expect(dirs.includes(-1)).toBe(false);
  });

  it('clears the hall call only in the direction it served', () => {
    const world = createWorld(4);
    const shaft = buildShaft(world);
    const car = carAt(shaft, 0);
    requestHallCall(world, shaft.id, 5, 1);
    requestHallCall(world, shaft.id, 5, -1);
    run(world, 2);
    expect(car.state).toBe('doorsOpen');
    expect(Math.round(car.y)).toBe(5);
    expect(car.dir).toBe(1);
    expect(shaft.hallCalls.get(5)).toEqual({ up: false, down: true });
  });

  it('clears a stale hall call when nobody is there to board', () => {
    const world = createWorld(4);
    const shaft = buildShaft(world);
    requestHallCall(world, shaft.id, 6, 1);
    run(world, 4);
    expect(shaft.hallCalls.size).toBe(0);
  });

  it('keeps the doors open for doorOpenMinutes', () => {
    const world = createWorld(4);
    const shaft = buildShaft(world);
    const car = carAt(shaft, 0);
    addWaiter(world, shaft, 1, 5);
    const states: string[] = [];
    run(world, 8, () => {
      states.push(car.state);
    });
    // states are sampled before each tick, so drop the opening sample
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) seen.push(states[i] ?? '');
    const first = seen.indexOf('doorsOpen');
    expect(first).toBeGreaterThan(-1);
    let open = 0;
    while (seen[first + open] === 'doorsOpen') open += 1;
    expect(open).toBe(SHAFTS.standard.doorOpenMinutes);
  });
});

describe('tickElevators: two cars', () => {
  it('splits an up call and a down call between the cars', () => {
    const world = createWorld(5);
    const shaft = buildShaft(world, { cars: [1, 8] });
    const low = carAt(shaft, 0);
    const high = carAt(shaft, 1);
    const goingUp = addWaiter(world, shaft, 2, 6);
    const goingDown = addWaiter(world, shaft, 8, 3);

    run(world, 1);
    expect(goingDown.inCarId).toBe(high.id);
    expect(low.dir).toBe(1);
    expect(low.y).toBe(2);

    run(world, 1);
    expect(goingUp.inCarId).toBe(low.id);
  });

  it('lets cars pass through each other so crossing riders both arrive', () => {
    const world = createWorld(6);
    const shaft = buildShaft(world, { cars: [5, 6] });
    const goingUp = addWaiter(world, shaft, 2, 9);
    const goingDown = addWaiter(world, shaft, 9, 2);
    run(world, 60);
    expect(goingUp.state).toBe('walking');
    expect(goingUp.pos).toEqual({ floor: 9, x: shaft.x });
    expect(goingDown.state).toBe('walking');
    expect(goingDown.pos).toEqual({ floor: 2, x: shaft.x });
  });
});

describe('tickElevators: idle behavior', () => {
  it('returns to the home floor after IDLE_RETURN_MINUTES', () => {
    const world = createWorld(7);
    const shaft = buildShaft(world, { cars: [5], homeFloor: 1 });
    const car = carAt(shaft, 0);
    run(world, IDLE_RETURN_MINUTES);
    expect(car.y).toBe(5);
    expect(car.state).toBe('idle');
    run(world, 1);
    expect(car.y).toBe(1);
    run(world, 1);
    expect(car.state).toBe('idle');
    expect(car.dir).toBe(0);
  });

  it('stays put when it is already home', () => {
    const world = createWorld(7);
    const shaft = buildShaft(world, { cars: [1], homeFloor: 1 });
    const car = carAt(shaft, 0);
    run(world, IDLE_RETURN_MINUTES * 3);
    expect(car.y).toBe(1);
    expect(car.state).toBe('idle');
  });
});

describe('tickElevators: express shafts', () => {
  it('skips floors that are not stops', () => {
    const world = createWorld(8);
    const shaft = buildShaft(world, {
      kind: 'express',
      floorMin: 1,
      floorMax: 30,
      stops: [1, 15, 30],
    });
    const car = carAt(shaft, 0);
    addWaiter(world, shaft, 1, 15);
    expect(recordStops(world, car, 8)).toEqual([1, 15]);
  });

  it('leaves a sim on a floor it does not serve', () => {
    const world = createWorld(8);
    const shaft = buildShaft(world, {
      kind: 'express',
      floorMin: 1,
      floorMax: 30,
      stops: [1, 15, 30],
    });
    const stuck = addWaiter(world, shaft, 7, 15);
    run(world, 12);
    expect(shaft.hallCalls.size).toBe(0);
    expect(stuck.state).toBe('waiting');
    expect(stuck.inCarId).toBeNull();
  });
});

describe('tickElevators: determinism', () => {
  function drive(seed: number): number[] {
    const world = createWorld(seed);
    const shaft = buildShaft(world, { cars: [1, 6] });
    const trace: number[] = [];
    for (let i = 0; i < 300; i++) {
      if (world.rng.next() < 0.25) {
        const from = world.rng.int(1, 10);
        const to = from === 10 ? world.rng.int(1, 9) : world.rng.int(from + 1, 10);
        addWaiter(world, shaft, from, to);
      }
      tickElevators(world);
      world.time.minute += 1;
      if (i % 10 === 0) for (const car of shaft.cars) trace.push(car.y);
    }
    return trace;
  }

  it('produces the same car positions for the same seed and calls', () => {
    const a = drive(1234);
    const b = drive(1234);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(1);
  });
});
