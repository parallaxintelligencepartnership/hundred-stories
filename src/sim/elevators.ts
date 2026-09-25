// Elevator dispatch: SCAN per car, door cycle, boarding and alighting, hall calls.
// Pure sim: no DOM, no Date, no Math.random. Every number comes from rules.ts.
// See docs/DESIGN.md section 6 and docs/BRIEF-AGENTS.md.

import { SHAFTS } from './rules';
import type { ShaftRule } from './rules';
import { carCovers, carRangeOf, riderClassOf } from './types';
import type { Car, Id, RiderClass, Shaft, Sim, World } from './types';

/** Minutes a car may stand idle away from its home floor before it goes back. */
export const IDLE_RETURN_MINUTES = 10;

/** Every rider class, in a fixed order so dispatch never depends on Set insertion. */
export const RIDER_CLASSES: readonly RiderClass[] = ['hotel', 'office', 'other'];

/** A hall call at a floor in one direction for one class of rider, as handed to a car. */
interface HallEntry {
  floor: number;
  dir: 1 | -1;
  cls: RiderClass;
}

/** shaft id -> floor -> waiting sims that want a ride on that shaft, in queue order. */
type WaitIndex = Map<Id, Map<number, Sim[]>>;

/**
 * Register a hall call. Floors the shaft does not stop at are ignored, so an
 * express shaft never picks up a call from a floor it cannot serve.
 */
export function requestHallCall(
  world: World,
  shaftId: Id,
  floor: number,
  dir: 1 | -1,
  cls: RiderClass,
): void {
  const shaft = world.shafts.get(shaftId);
  if (!shaft) return;
  if (floor < shaft.floorMin || floor > shaft.floorMax) return;
  if (!shaft.stops.has(floor)) return;
  let call = shaft.hallCalls.get(floor);
  if (!call) {
    call = { up: new Set(), down: new Set() };
    shaft.hallCalls.set(floor, call);
  }
  (dir === 1 ? call.up : call.down).add(cls);
}

/** Is anyone of this class still waiting here in this direction? */
export function hallCallPending(shaft: Shaft, floor: number, dir: 1 | -1, cls: RiderClass): boolean {
  const call = shaft.hallCalls.get(floor);
  if (!call) return false;
  return (dir === 1 ? call.up : call.down).has(cls);
}

/** Put out the light for one class; the floor drops off the list once nobody is left. */
function clearHallCall(shaft: Shaft, floor: number, dir: 1 | -1, cls: RiderClass): void {
  const call = shaft.hallCalls.get(floor);
  if (!call) return;
  (dir === 1 ? call.up : call.down).delete(cls);
  if (call.up.size === 0 && call.down.size === 0) shaft.hallCalls.delete(floor);
}

/**
 * A dedicated car with nothing of its own to do takes anyone: no passengers aboard and
 * no call from its own class anywhere inside its range. This is the leftover rule, and
 * it is re-read every tick, so the moment its own people call, the car is theirs again.
 */
export function isLeftoverCar(shaft: Shaft, car: Car): boolean {
  if (car.serves === 'any') return false; // a general car is never a leftover
  if (car.passengers.length > 0) return false;
  for (const [floor, call] of shaft.hallCalls) {
    if (!shaft.stops.has(floor) || !carCovers(shaft, car, floor)) continue;
    if (call.up.has(car.serves) || call.down.has(car.serves)) return false;
  }
  return true;
}

/** May this car answer a call from this class, given what else it has on. */
function carServesClass(car: Car, cls: RiderClass, leftover: boolean): boolean {
  return car.serves === 'any' || car.serves === cls || leftover;
}

/**
 * Why this shaft may not stop serving `floor` right now, or null when it may. A rider aboard
 * bound for that floor would never get off (cars stop only at stops), so the change waits
 * until they are off. The shaft.setStop command returns this reason to the player.
 */
export function stopOffRefusal(world: World, shaft: Shaft, floor: number): string | null {
  for (const car of shaft.cars) {
    for (const id of car.passengers) {
      const leg = world.sims.get(id)?.route[0];
      if (leg && leg.kind === 'ride' && leg.toFloor === floor) return 'Someone is riding to that floor.';
    }
  }
  return null;
}

/**
 * A rider whose trip no longer has a point (its room burned or was bombed) gets off at the
 * car's next door opening: the floor the doors are open on, else the nearest stop this car
 * works ahead of it, else the nearest one behind. The ride leg is cut to that floor and the
 * car is asked to stop there, so the rider stays `riding` until alighting takes it off.
 * False when the car is gone; the caller then puts the sim back on its feet.
 */
export function letOffAtNextStop(world: World, sim: Sim): boolean {
  if (sim.inCarId === null) return false;
  for (const shaft of world.shafts.values()) {
    const car = shaft.cars.find((c) => c.id === sim.inCarId);
    if (!car) continue;
    const floor = nextStopOf(shaft, car);
    if (floor === null) return false;
    const leg = sim.route[0];
    const fromFloor = leg && leg.kind === 'ride' ? leg.fromFloor : Math.round(car.y);
    sim.route = [{ kind: 'ride', shaftId: shaft.id, fromFloor, toFloor: floor }];
    sim.state = 'riding';
    sim.waitStart = null;
    car.calls.add(floor);
    return true;
  }
  return false;
}

function nextStopOf(shaft: Shaft, car: Car): number | null {
  const floors = [...shaft.stops].filter((f) => carCovers(shaft, car, f)).sort((a, b) => a - b);
  if (car.state === 'doorsOpen' && floors.includes(car.y)) return car.y;
  const dir = car.dir === 0 ? 1 : car.dir;
  let best: number | null = null;
  for (const f of floors) {
    if (dir === 1 ? f < car.y : f > car.y) continue;
    if (best === null || Math.abs(f - car.y) < Math.abs(best - car.y)) best = f;
  }
  if (best !== null) return best;
  for (const f of floors) if (best === null || Math.abs(f - car.y) < Math.abs(best - car.y)) best = f;
  return best;
}

/** Advance every car by one game minute. */
export function tickElevators(world: World): void {
  const waiting = indexWaitingSims(world);
  const shafts = [...world.shafts.values()].sort((a, b) => a.id - b.id);
  for (const shaft of shafts) {
    if (shaft.cars.length === 0) continue;
    const assignment = assignHallCalls(shaft);
    const desired: number[] = [];
    for (const car of shaft.cars) {
      desired.push(stepCar(world, shaft, car, assignment.get(car.id) ?? [], waiting));
    }
    applyMovement(shaft, desired);
  }
}

function indexWaitingSims(world: World): WaitIndex {
  const index: WaitIndex = new Map();
  for (const sim of world.sims.values()) {
    if (sim.state !== 'waiting' || sim.inCarId !== null) continue;
    const leg = sim.route[0];
    if (!leg || leg.kind !== 'ride') continue;
    let byFloor = index.get(leg.shaftId);
    if (!byFloor) index.set(leg.shaftId, (byFloor = new Map()));
    const list = byFloor.get(sim.pos.floor);
    if (list) list.push(sim);
    else byFloor.set(sim.pos.floor, [sim]);
  }
  // Longest wait boards first; id breaks ties so the order never depends on Map insertion.
  const far = Number.MAX_SAFE_INTEGER;
  for (const byFloor of index.values()) {
    for (const list of byFloor.values()) {
      list.sort((a, b) => (a.waitStart ?? far) - (b.waitStart ?? far) || a.id - b.id);
    }
  }
  return index;
}

/**
 * Give every live hall call to one car: the nearest car already heading that way,
 * else the nearest idle car, else the nearest car at all. Recomputed every tick from
 * world state alone, so nothing extra has to be saved or restored.
 */
function assignHallCalls(shaft: Shaft): Map<Id, HallEntry[]> {
  const out = new Map<Id, HallEntry[]>();
  const capacity = SHAFTS[shaft.kind].capacity;
  const floors = [...shaft.hallCalls.keys()].sort((a, b) => a - b);
  for (const floor of floors) {
    const call = shaft.hallCalls.get(floor);
    if (!call || !shaft.stops.has(floor)) continue;
    for (const dir of [1, -1] as const) {
      const classes = dir === 1 ? call.up : call.down;
      for (const cls of RIDER_CLASSES) {
        if (!classes.has(cls)) continue;
        const car = bestCarFor(shaft, capacity, floor, dir, cls);
        if (!car) continue;
        const list = out.get(car.id);
        if (list) list.push({ floor, dir, cls });
        else out.set(car.id, [{ floor, dir, cls }]);
      }
    }
  }
  return out;
}

/** Leftover cars rank below every car that is meant for this rider, however placed. */
const LEFTOVER_TIER = 3;

function bestCarFor(
  shaft: Shaft,
  capacity: number,
  floor: number,
  dir: 1 | -1,
  cls: RiderClass,
): Car | null {
  let best: Car | null = null;
  let bestTier = Number.MAX_SAFE_INTEGER;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const car of shaft.cars) {
    if (!carCovers(shaft, car, floor)) continue; // that floor is not this car's work
    const dedicated = car.serves === 'any' || car.serves === cls;
    if (!dedicated && !isLeftoverCar(shaft, car)) continue;
    const room = car.passengers.length < capacity;
    const ahead = dir === 1 ? floor >= car.y : floor <= car.y;
    let tier = LEFTOVER_TIER;
    if (dedicated) {
      tier = 2;
      if (room && car.dir === dir && ahead) tier = 0;
      else if (room && car.dir === 0) tier = 1;
    }
    const dist = Math.abs(floor - car.y);
    const better =
      best === null ||
      tier < bestTier ||
      (tier === bestTier && (dist < bestDist || (dist === bestDist && car.id < best.id)));
    if (better) {
      best = car;
      bestTier = tier;
      bestDist = dist;
    }
  }
  return best;
}

/** Run one car for one minute. Returns where it would like to be, before car spacing. */
function stepCar(
  world: World,
  shaft: Shaft,
  car: Car,
  assigned: HallEntry[],
  waiting: WaitIndex,
): number {
  const rule = SHAFTS[shaft.kind];
  const span = carRangeOf(shaft, car);

  if (car.state === 'doorsOpen') {
    if (car.y < span.lo || car.y > span.hi) {
      // Its floors changed while the doors stood open: shut them, nobody boards out here.
      car.state = 'idle';
      car.doorTimer = 0;
    } else {
      // Keep serving the floor for the whole door cycle, so a sim that starts waiting
      // while the doors are open still gets on.
      serveFloor(world, shaft, car, waiting);
      car.doorTimer -= 1;
      if (car.doorTimer > 0) return car.y;
      car.state = 'idle';
    }
  }

  // A car whose range moved out from under it walks back into it before doing anything else.
  if (car.y < span.lo) return driveTo(car, 1, span.lo, rule);
  if (car.y > span.hi) return driveTo(car, -1, span.hi, rule);

  const y = car.y;
  const atFloor = Number.isInteger(y) ? y : null;
  const hasRoom = car.passengers.length < rule.capacity;
  // A full car skips hall calls entirely; the sims on that floor keep waiting.
  const halls = hasRoom ? assigned.filter((e) => stillCalled(shaft, e)) : [];
  const carFloors = [...car.calls].filter((f) => shaft.stops.has(f) && carCovers(shaft, car, f));

  let dir: 1 | -1;
  if (car.dir === 0) {
    const target = nearestTarget(y, carFloors, halls);
    if (target === null) return idleStep(world, shaft, car, rule);
    if (target === y) dir = halls.find((e) => e.floor === y)?.dir ?? 1;
    else dir = target > y ? 1 : -1;
  } else {
    dir = car.dir;
  }

  if (atFloor !== null && shouldStop(shaft, car, atFloor, dir, hasRoom, halls)) {
    return openDoors(world, shaft, car, dir, rule, waiting);
  }

  const ahead = nearestAhead(y, dir, carFloors, halls);
  if (ahead !== null) return driveTo(car, dir, ahead, rule);

  // Nothing left this way: reverse.
  const back: 1 | -1 = dir === 1 ? -1 : 1;
  if (atFloor !== null && shouldStop(shaft, car, atFloor, back, hasRoom, halls)) {
    return openDoors(world, shaft, car, back, rule, waiting);
  }
  const behind = nearestAhead(y, back, carFloors, halls);
  if (behind !== null) return driveTo(car, back, behind, rule);

  return idleStep(world, shaft, car, rule);
}

function driveTo(car: Car, dir: 1 | -1, target: number, rule: ShaftRule): number {
  car.dir = dir;
  car.state = 'moving';
  car.idleSince = null;
  return stepToward(car.y, target, rule.floorsPerMinute);
}

function shouldStop(
  shaft: Shaft,
  car: Car,
  floor: number,
  dir: 1 | -1,
  hasRoom: boolean,
  halls: HallEntry[],
): boolean {
  if (!shaft.stops.has(floor)) return false;
  if (car.calls.has(floor)) return true;
  if (!hasRoom) return false;
  return halls.some((e) => e.floor === floor && e.dir === dir);
}

function openDoors(
  world: World,
  shaft: Shaft,
  car: Car,
  dir: 1 | -1,
  rule: ShaftRule,
  waiting: WaitIndex,
): number {
  car.dir = dir;
  car.state = 'doorsOpen';
  car.doorTimer = rule.doorOpenMinutes;
  car.idleSince = null;
  serveFloor(world, shaft, car, waiting);
  return car.y;
}

/** Alight, then board, then clear the hall call in the direction this car is serving. */
function serveFloor(world: World, shaft: Shaft, car: Car, waiting: WaitIndex): void {
  const floor = Math.round(car.y);
  const rule = SHAFTS[shaft.kind];
  const dir: 1 | -1 = car.dir === 0 ? 1 : car.dir;

  const staying: Id[] = [];
  for (const simId of car.passengers) {
    const sim = world.sims.get(simId);
    if (!sim) continue; // the sim left the world; drop the seat
    const leg = sim.route[0];
    if (leg && leg.kind === 'ride' && leg.toFloor === floor) {
      sim.pos = { floor, x: shaft.x };
      sim.inCarId = null;
      sim.state = 'walking';
      sim.route.shift();
    } else {
      staying.push(simId);
    }
  }
  car.passengers = staying;
  car.calls.delete(floor);

  const hadRoom = car.passengers.length < rule.capacity;
  // Read the leftover state once, after alighting and before anyone gets on: boarding
  // would otherwise change the answer halfway down the queue.
  const leftover = isLeftoverCar(shaft, car);
  const queue = waiting.get(shaft.id)?.get(floor) ?? [];
  for (const sim of queue) {
    if (car.passengers.length >= rule.capacity) break;
    if (!boardable(sim, shaft, floor, dir)) continue;
    if (!carTakes(shaft, car, sim, leftover)) continue; // wrong car for this rider
    sim.inCarId = car.id;
    sim.state = 'riding';
    car.passengers.push(sim.id);
    const leg = sim.route[0];
    if (leg && leg.kind === 'ride') car.calls.add(leg.toFloor);
  }

  // The light goes out only for the classes this car just served in this direction.
  if (hadRoom && carCovers(shaft, car, floor)) {
    for (const cls of RIDER_CLASSES) {
      if (carServesClass(car, cls, leftover)) clearHallCall(shaft, floor, dir, cls);
    }
  }
  // Anyone this car could not take keeps the floor lit, so another trip comes back.
  for (const sim of queue) {
    if (!boardable(sim, shaft, floor, dir)) continue; // boarded sims are riding now
    requestHallCall(world, shaft.id, floor, dir, riderClassOf(sim.kind));
  }
}

/** Would this car carry this sim: the right class, and the destination inside its range. */
function carTakes(shaft: Shaft, car: Car, sim: Sim, leftover: boolean): boolean {
  const leg = sim.route[0];
  if (!leg || leg.kind !== 'ride') return false;
  if (!carCovers(shaft, car, leg.toFloor)) return false;
  return carServesClass(car, riderClassOf(sim.kind), leftover);
}

function boardable(sim: Sim, shaft: Shaft, floor: number, dir: 1 | -1): boolean {
  if (sim.state !== 'waiting' || sim.inCarId !== null) return false;
  if (sim.pos.floor !== floor) return false;
  if (Math.abs(sim.pos.x - shaft.x) > shaft.width + 1) return false;
  const leg = sim.route[0];
  if (!leg || leg.kind !== 'ride' || leg.shaftId !== shaft.id) return false;
  if (leg.toFloor === floor || !shaft.stops.has(leg.toFloor)) return false;
  return (leg.toFloor > floor ? 1 : -1) === dir;
}

function idleStep(world: World, shaft: Shaft, car: Car, rule: ShaftRule): number {
  if (car.idleSince === null) car.idleSince = world.time.minute;
  const homeReachable =
    shaft.homeFloor >= shaft.floorMin &&
    shaft.homeFloor <= shaft.floorMax &&
    carCovers(shaft, car, shaft.homeFloor);
  const waited = world.time.minute - car.idleSince;
  if (waited >= IDLE_RETURN_MINUTES && homeReachable && car.y !== shaft.homeFloor) {
    car.dir = shaft.homeFloor > car.y ? 1 : -1;
    car.state = 'moving';
    return stepToward(car.y, shaft.homeFloor, rule.floorsPerMinute);
  }
  car.dir = 0;
  car.state = 'idle';
  return car.y;
}

function stepToward(y: number, target: number, floorsPerMinute: number): number {
  const delta = target - y;
  if (Math.abs(delta) <= floorsPerMinute) return target;
  return y + Math.sign(delta) * floorsPerMinute;
}

function stillCalled(shaft: Shaft, entry: HallEntry): boolean {
  return hallCallPending(shaft, entry.floor, entry.dir, entry.cls);
}

function nearestAhead(
  y: number,
  dir: 1 | -1,
  carFloors: number[],
  halls: HallEntry[],
): number | null {
  let best: number | null = null;
  const consider = (f: number): void => {
    if (dir === 1 ? f <= y : f >= y) return;
    if (best === null || Math.abs(f - y) < Math.abs(best - y)) best = f;
  };
  for (const f of carFloors) consider(f);
  for (const e of halls) consider(e.floor);
  return best;
}

/** Nearest target in either direction; a tie goes up, the way a parked car starts. */
function nearestTarget(y: number, carFloors: number[], halls: HallEntry[]): number | null {
  let best: number | null = null;
  const consider = (f: number): void => {
    if (best === null) {
      best = f;
      return;
    }
    const d = Math.abs(f - y);
    const bd = Math.abs(best - y);
    if (d < bd || (d === bd && f > best)) best = f;
  };
  for (const f of carFloors) consider(f);
  for (const e of halls) consider(e.floor);
  return best;
}

/**
 * Move every car to where it asked to go, clamped to the shaft span. Cars sharing a
 * shaft may pass through each other: the original drew them overlapping, and a strict
 * no-pass rule wedges the shaft for good whenever two riders want to cross.
 */
function applyMovement(shaft: Shaft, desired: number[]): void {
  for (let i = 0; i < shaft.cars.length; i++) {
    const car = shaft.cars[i];
    if (!car) continue;
    const want = desired[i] ?? car.y;
    car.y = Math.min(Math.max(want, shaft.floorMin), shaft.floorMax);
  }
}
