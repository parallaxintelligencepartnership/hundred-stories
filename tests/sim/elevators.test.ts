import { describe, expect, it } from 'vitest';

import { IDLE_RETURN_MINUTES, requestHallCall, tickElevators } from '../../src/sim/elevators';
import { riderClassOf } from '../../src/sim/types';
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
  serves?: Car['serves'];
  range?: { lo: number; hi: number } | null;
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
      serves: opts.serves ?? 'any',
      range: opts.range ?? null,
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
  requestHallCall(world, shaft.id, fromFloor, toFloor > fromFloor ? 1 : -1, riderClassOf(sim.kind));
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

/** Ticks a car needs to cross that many floors and open up, with a little slack. */
function travelTicks(shaft: Shaft, from: number, to: number): number {
  const rule = SHAFTS[shaft.kind];
  return Math.ceil(Math.abs(to - from) / rule.floorsPerMinute) + rule.doorOpenMinutes + 2;
}

/** A sim already aboard, so the car carries a call to toFloor. */
function addRider(world: World, shaft: Shaft, car: Car, fromFloor: number, toFloor: number): Sim {
  const sim = addWaiter(world, shaft, fromFloor, toFloor);
  sim.state = 'riding';
  sim.inCarId = car.id;
  car.passengers.push(sim.id);
  car.calls.add(toFloor);
  shaft.hallCalls.delete(fromFloor);
  return sim;
}

describe('requestHallCall', () => {
  it('registers a call in one direction at a time', () => {
    const world = createWorld(1);
    const shaft = buildShaft(world);
    requestHallCall(world, shaft.id, 4, 1, 'office');
    expect(shaft.hallCalls.get(4)).toEqual({ up: new Set(['office']), down: new Set() });
    requestHallCall(world, shaft.id, 4, -1, 'office');
    expect(shaft.hallCalls.get(4)).toEqual({ up: new Set(['office']), down: new Set(['office']) });
  });

  it('ignores floors the shaft does not stop at', () => {
    const world = createWorld(1);
    const shaft = buildShaft(world, {
      kind: 'express',
      floorMin: 1,
      floorMax: 30,
      stops: [1, 15, 30],
    });
    requestHallCall(world, shaft.id, 7, 1, 'office');
    expect(shaft.hallCalls.has(7)).toBe(false);
    requestHallCall(world, shaft.id, 15, 1, 'office');
    expect(shaft.hallCalls.has(15)).toBe(true);
  });

  it('ignores an unknown shaft and a floor outside the span', () => {
    const world = createWorld(1);
    const shaft = buildShaft(world, { floorMin: 1, floorMax: 10 });
    expect(() => requestHallCall(world, 9999, 3, 1, 'office')).not.toThrow();
    requestHallCall(world, shaft.id, 44, 1, 'office');
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

    run(world, travelTicks(shaft, 1, 5));
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
    expect(shaft.hallCalls.get(1)).toEqual({ up: new Set(['office']), down: new Set() });
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
    run(world, travelTicks(shaft, 10, 1) + travelTicks(shaft, 1, 5));
    expect(sim.state).toBe('walking');
    expect(sim.stress).toBe(0);
  });

  it('does not stop at floors that have no call', () => {
    const world = createWorld(2);
    const shaft = buildShaft(world);
    const car = carAt(shaft, 0);
    addWaiter(world, shaft, 1, 10);
    expect(recordStops(world, car, travelTicks(shaft, 1, 10) + 2)).toEqual([1, 10]);
  });

  it('does not board a sim standing away from the shaft door', () => {
    const world = createWorld(2);
    const shaft = buildShaft(world);
    const sim = addWaiter(world, shaft, 1, 5, shaft.x + shaft.width + 2);
    run(world, travelTicks(shaft, 1, 5));
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
    run(world, travelTicks(shaft, 1, 10) * 4);
    expect(sims.every((s) => s.state === 'walking')).toBe(true);
    expect(sims.every((s) => s.pos.floor === 10)).toBe(true);
  });

  it('passes a hall call without opening while it is full', () => {
    const world = createWorld(3);
    const shaft = buildShaft(world);
    const car = carAt(shaft, 0);
    range(1, 21).forEach(() => addWaiter(world, shaft, 1, 10));
    const stranded = addWaiter(world, shaft, 5, 10);
    // exactly long enough to open at 1, run to 10 and open there, no time to come back
    const window = 2 + Math.ceil(9 / SHAFTS.standard.floorsPerMinute);
    expect(recordStops(world, car, window)).toEqual([1, 10]);
    expect(stranded.state).toBe('waiting');
    expect(shaft.hallCalls.get(5)).toEqual({ up: new Set(['office']), down: new Set() });
  });

  it('alights before boarding, so a freed seat can be filled at the same floor', () => {
    const world = createWorld(3);
    const shaft = buildShaft(world);
    const car = carAt(shaft, 0);
    const riders = range(1, 21).map(() => addWaiter(world, shaft, 1, 5));
    const boarder = addWaiter(world, shaft, 5, 10);
    run(world, travelTicks(shaft, 1, 5));
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
    for (let i = 0; i < travelTicks(shaft, 1, 10) * 3; i++) {
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
    requestHallCall(world, shaft.id, 5, 1, 'office');
    requestHallCall(world, shaft.id, 5, -1, 'office');
    run(world, Math.ceil(4 / SHAFTS.standard.floorsPerMinute) + 1);
    expect(car.state).toBe('doorsOpen');
    expect(Math.round(car.y)).toBe(5);
    expect(car.dir).toBe(1);
    expect(shaft.hallCalls.get(5)).toEqual({ up: new Set(), down: new Set(['office']) });
  });

  it('clears a stale hall call when nobody is there to board', () => {
    const world = createWorld(4);
    const shaft = buildShaft(world);
    requestHallCall(world, shaft.id, 6, 1, 'office');
    run(world, travelTicks(shaft, 1, 6));
    expect(shaft.hallCalls.size).toBe(0);
  });

  it('keeps the doors open for doorOpenMinutes', () => {
    const world = createWorld(4);
    const shaft = buildShaft(world);
    const car = carAt(shaft, 0);
    addWaiter(world, shaft, 1, 5);
    const states: string[] = [];
    const window = travelTicks(shaft, 1, 5);
    run(world, window, () => {
      states.push(car.state);
    });
    const seen: string[] = [];
    for (let i = 0; i < window; i++) seen.push(states[i] ?? '');
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
    expect(car.y).toBeLessThan(5);
    expect(car.state).toBe('moving');
    run(world, travelTicks(shaft, 5, 1));
    expect(car.y).toBe(1);
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
    expect(recordStops(world, car, travelTicks(shaft, 1, 15))).toEqual([1, 15]);
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
    run(world, travelTicks(shaft, 1, 30));
    expect(shaft.hallCalls.size).toBe(0);
    expect(stuck.state).toBe('waiting');
    expect(stuck.inCarId).toBeNull();
  });
});

describe('tickElevators: no bouncing', () => {
  it('changes direction at most once per served stop', () => {
    const world = createWorld(12);
    const shaft = buildShaft(world, { floorMin: 1, floorMax: 8, cars: [5], homeFloor: 5 });
    const car = carAt(shaft, 0);
    addRider(world, shaft, car, 5, 2); // a car call below
    addWaiter(world, shaft, 7, 8); // a standing hall call above

    let lastY = car.y;
    let lastSign = 0;
    let flipsSinceStop = 0;
    let stops = 0;
    let wasOpen = false;
    for (let t = 0; t < 200; t++) {
      tickElevators(world);
      world.time.minute += 1;
      const sign = Math.sign(car.y - lastY);
      if (sign !== 0) {
        if (lastSign !== 0 && sign !== lastSign) flipsSinceStop += 1;
        lastSign = sign;
      }
      lastY = car.y;
      const open = car.state === 'doorsOpen';
      if (open && !wasOpen) {
        stops += 1;
        expect(flipsSinceStop).toBeLessThanOrEqual(1);
        flipsSinceStop = 0;
      }
      wasOpen = open;
    }
    expect(flipsSinceStop).toBeLessThanOrEqual(1);
    expect(stops).toBeGreaterThanOrEqual(3);
  });

  it('lands exactly on the stop when a full step would overshoot it', () => {
    const world = createWorld(13);
    const step = SHAFTS.express.floorsPerMinute;
    const target = 1 + Math.ceil(step * 2.5); // not a whole number of steps away
    const shaft = buildShaft(world, {
      kind: 'express',
      floorMin: 1,
      floorMax: 30,
      stops: [1, target],
      homeFloor: 1,
    });
    const car = carAt(shaft, 0);
    const sim = addWaiter(world, shaft, 1, target);

    const seen: number[] = [];
    for (let t = 0; t < travelTicks(shaft, 1, target); t++) {
      tickElevators(world);
      world.time.minute += 1;
      seen.push(car.y);
      expect(car.y).toBeLessThanOrEqual(target); // never overshoots the stop
      if (car.state === 'doorsOpen') {
        expect(Number.isInteger(car.y)).toBe(true);
        expect(shaft.stops.has(car.y)).toBe(true);
      }
    }
    expect(seen).toContain(target);
    expect(sim.pos).toEqual({ floor: target, x: shaft.x });
    // the car holds the floor for the whole door cycle, it does not drift off and back
    const settled = seen.slice(seen.indexOf(target));
    expect(settled.every((y) => y === target)).toBe(true);
  });
});

describe('tickElevators: a parked car holds still', () => {
  it('sits on the home floor for 300 ticks without a door cycle', () => {
    const world = createWorld(14);
    const shaft = buildShaft(world, { floorMin: 1, floorMax: 8, cars: [1], homeFloor: 1 });
    const car = carAt(shaft, 0);
    for (let t = 0; t < 300; t++) {
      tickElevators(world);
      world.time.minute += 1;
      expect(car.y).toBe(1);
      expect(car.state).toBe('idle');
      expect(car.dir).toBe(0);
      expect(car.doorTimer).toBe(0);
    }
  });

  it('re-arms the door timer once for a stale call at home, then stays idle', () => {
    const world = createWorld(14);
    const shaft = buildShaft(world, { floorMin: 1, floorMax: 8, cars: [1], homeFloor: 1 });
    const car = carAt(shaft, 0);
    requestHallCall(world, shaft.id, 1, 1, 'office');

    let cycles = 0;
    let wasOpen = false;
    for (let t = 0; t < 300; t++) {
      tickElevators(world);
      world.time.minute += 1;
      const open = car.state === 'doorsOpen';
      if (open && !wasOpen) cycles += 1;
      wasOpen = open;
      expect(car.y).toBe(1);
      expect(car.doorTimer).toBeLessThanOrEqual(SHAFTS.standard.doorOpenMinutes);
      expect(car.doorTimer).toBeGreaterThanOrEqual(0);
    }
    expect(cycles).toBe(1);
    expect(car.state).toBe('idle');
    expect(car.dir).toBe(0);
    expect(car.doorTimer).toBe(0);
    expect(shaft.hallCalls.size).toBe(0);
  });

  it('never moves while the doors are open and goes idle in place afterwards', () => {
    const world = createWorld(15);
    const shaft = buildShaft(world, { floorMin: 1, floorMax: 8, cars: [1], homeFloor: 1 });
    const car = carAt(shaft, 0);
    for (const floor of [3, 5]) addWaiter(world, shaft, floor, 8);
    addWaiter(world, shaft, 1, 6);

    let lastY = car.y;
    let lastState = car.state;
    for (let t = 0; t < travelTicks(shaft, 1, 8) * 3; t++) {
      tickElevators(world);
      world.time.minute += 1;
      if (lastState === 'doorsOpen' && car.state === 'doorsOpen') expect(car.y).toBe(lastY);
      if (lastState === 'doorsOpen' && car.state !== 'doorsOpen') expect(car.doorTimer).toBe(0);
      lastY = car.y;
      lastState = car.state;
    }
    // last delivery done, nothing left to do: parked where it finished, doors shut
    expect(car.state).toBe('idle');
    expect(car.passengers).toEqual([]);
    expect(car.calls.size).toBe(0);
    expect(car.doorTimer).toBe(0);
    const parked = car.y;
    run(world, IDLE_RETURN_MINUTES - 1);
    expect(car.y).toBe(parked);
    expect(car.state).toBe('idle');
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

