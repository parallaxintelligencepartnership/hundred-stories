// Elevator dispatch: SCAN per car, door cycle, boarding and alighting, hall calls.
// Pure sim: no DOM, no Date, no Math.random. Every number comes from rules.ts.
// See docs/DESIGN.md section 6 and docs/BRIEF-AGENTS.md.

import { SHAFTS } from './rules';
import type { ShaftRule } from './rules';
import { carCovers, carRangeOf, riderClassOf, serviceGroupsOf } from './types';
import type { Car, Id, RiderClass, Shaft, Sim, SimKind, World } from './types';
import { recordBoardedWait } from './world';

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

/**
 * The one class a rider of this kind lights at this shaft for a ride from `from` to `to`: its
 * rider class, as a rule. Staff who serve groups (housekeepers, guards, collectors) take an
 * Everyone car wherever one on this shaft works both floors, the preference leftover riders have
 * in routing (a car of their own first), so they call as plain riders and a kept car's own riders
 * keep it (PM decision 2026-09-29, on Matt's delegation). Only where no Everyone car covers the
 * trip do they call as the first of their groups with a car that does, so that group's car answers
 * them as its own. One class, never two: a guard at a shaft with a hotel car and an office car
 * calls one of them (P5-A1), not both.
 */
export function callClassFor(shaft: Shaft, kind: SimKind, from: number, to: number): RiderClass {
  const plain = riderClassOf(kind);
  const groups = serviceGroupsOf(kind);
  if (groups.length === 0) return plain;
  const covers = (car: Car): boolean => carCovers(shaft, car, from) && carCovers(shaft, car, to);
  if (shaft.cars.some((car) => car.serves === 'any' && covers(car))) return plain;
  for (const group of groups) if (shaft.cars.some((car) => car.serves === group && covers(car))) return group;
  return plain;
}

/** The class this waiting sim calls with for the ride leg it is on (callClassFor). */
function callClassOfSim(shaft: Shaft, sim: Sim): RiderClass {
  const leg = sim.route[0];
  const to = leg && leg.kind === 'ride' ? leg.toFloor : sim.pos.floor;
  return callClassFor(shaft, sim.kind, sim.pos.floor, to);
}

/** Light this rider's call class (callClassFor) for a ride from `floor` to `to`, unless it is lit. */
export function requestHallCallFor(world: World, shaft: Shaft, floor: number, to: number, kind: SimKind): void {
  requestHallCall(world, shaft.id, floor, to > floor ? 1 : -1, callClassFor(shaft, kind, floor, to));
}

/**
 * Does this car carry this sim as one of its own riders (not as a leftover or a passing pickup)?
 * An Everyone car carries everyone; a kept car carries its own class, and staff exactly when they
 * call as its group (callClassFor), so a housekeeper with an Everyone car on the trip is somebody
 * else's rider to a hotel car, the way a worker is.
 */
function ridesAsOwn(shaft: Shaft, car: Car, sim: Sim): boolean {
  if (car.serves === 'any' || car.serves === riderClassOf(sim.kind)) return true;
  if (!serviceGroupsOf(sim.kind).includes(car.serves)) return false;
  return callClassOfSim(shaft, sim) === car.serves;
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
 * no call from its own riders anywhere inside its range that it could answer. This is the
 * leftover rule, and it is re-read every tick, so the moment its own people call, the car
 * is theirs again. A call holds the car only while one of its own riders waits there
 * whom this car would carry (carTakes): a guest bound for a floor only another car works,
 * or a light nobody stands under any more, never keeps the car from everyone else.
 */
export function isLeftoverCar(world: World, shaft: Shaft, car: Car): boolean {
  return leftoverFor(shaft, car, indexWaitingSims(world));
}

function leftoverFor(shaft: Shaft, car: Car, waiting: WaitIndex): boolean {
  if (car.serves === 'any') return false; // a general car is never a leftover
  if (car.passengers.length > 0) return false;
  const byFloor = waiting.get(shaft.id);
  for (const [floor, call] of shaft.hallCalls) {
    if (!shaft.stops.has(floor) || !carCovers(shaft, car, floor)) continue;
    for (const dir of [1, -1] as const) {
      if (!(dir === 1 ? call.up : call.down).has(car.serves)) continue;
      for (const sim of byFloor?.get(floor) ?? []) {
        if (!waitsFor(sim, shaft, floor, dir)) continue;
        if (ridesAsOwn(shaft, car, sim) && carTakes(shaft, car, sim, false)) return false;
      }
    }
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
    const assignment = assignHallCalls(shaft, waiting);
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
 * Is each car a leftover (leftoverFor), asked once per car per dispatch pass. Nothing it reads
 * (passengers, hall calls, the waiting sims) changes while the calls are handed out, so one
 * answer per car holds for the whole pass; before this it was asked again for every call, class
 * and car, which a tall tower with many kept cars and a crowd waiting paid for every tick (P7-A1).
 */
type LeftoverOf = (car: Car) => boolean;

function leftoverCache(shaft: Shaft, waiting: WaitIndex): LeftoverOf {
  const known = new Map<Id, boolean>();
  return (car) => {
    let answer = known.get(car.id);
    if (answer === undefined) known.set(car.id, (answer = leftoverFor(shaft, car, waiting)));
    return answer;
  };
}

/**
 * Give every live hall call to one car: the nearest car already heading that way,
 * else the nearest idle car, else the nearest car at all. Recomputed every tick from
 * world state alone, so nothing extra has to be saved or restored.
 */
function assignHallCalls(shaft: Shaft, waiting: WaitIndex): Map<Id, HallEntry[]> {
  const out = new Map<Id, HallEntry[]>();
  const capacity = SHAFTS[shaft.kind].capacity;
  const isLeftover = leftoverCache(shaft, waiting);
  const floors = [...shaft.hallCalls.keys()].sort((a, b) => a - b);
  for (const floor of floors) {
    const call = shaft.hallCalls.get(floor);
    if (!call || !shaft.stops.has(floor)) continue;
    for (const dir of [1, -1] as const) {
      const classes = dir === 1 ? call.up : call.down;
      for (const cls of RIDER_CLASSES) {
        if (!classes.has(cls)) continue;
        const car = bestCarFor(shaft, capacity, floor, dir, cls, waiting, isLeftover);
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
  waiting: WaitIndex,
  isLeftover: LeftoverOf,
): Car | null {
  let best: Car | null = null;
  let bestTier = Number.MAX_SAFE_INTEGER;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const car of shaft.cars) {
    if (!carCovers(shaft, car, floor)) continue; // that floor is not this car's work
    const dedicated = car.serves === 'any' || car.serves === cls;
    if (!dedicated && !isLeftover(car)) continue;
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
  // The rider's own car cannot take them now (full, or not going where they are going), and
  // a kept car that is free works this floor: the kept car gets the call. Without a kept car
  // in the shaft nothing here runs, so plain towers dispatch exactly as before.
  if (
    best !== null &&
    bestTier < LEFTOVER_TIER &&
    shaft.cars.some((car) => car.serves !== 'any') &&
    !ownCarCanTakeNow(shaft, best, capacity, floor, dir, cls, waiting)
  ) {
    const free = nearestFreeKeptCar(shaft, floor, dir, cls, waiting, isLeftover);
    if (free) return free;
  }
  return best;
}

/** Could this car of the class's own carry at least one of the riders under this light now? */
function ownCarCanTakeNow(
  shaft: Shaft,
  car: Car,
  capacity: number,
  floor: number,
  dir: 1 | -1,
  cls: RiderClass,
  waiting: WaitIndex,
): boolean {
  if (car.passengers.length >= capacity) return false;
  const under = callersOf(shaft, floor, dir, cls, waiting);
  // A light nobody stands under keeps the old pick.
  if (under.length === 0) return true;
  return under.some((sim) => carTakes(shaft, car, sim, false));
}

/** The nearest kept car of another group that is free (a leftover) and would carry one of these riders. */
function nearestFreeKeptCar(
  shaft: Shaft,
  floor: number,
  dir: 1 | -1,
  cls: RiderClass,
  waiting: WaitIndex,
  isLeftover: LeftoverOf,
): Car | null {
  const under = callersOf(shaft, floor, dir, cls, waiting);
  let free: Car | null = null;
  let freeDist = Number.POSITIVE_INFINITY;
  for (const car of shaft.cars) {
    if (car.serves === 'any' || car.serves === cls || !carCovers(shaft, car, floor)) continue;
    if (!under.some((sim) => carTakes(shaft, car, sim, true))) continue;
    if (!isLeftover(car)) continue; // a leftover car is empty, so it has room
    const dist = Math.abs(floor - car.y);
    if (free === null || dist < freeDist || (dist === freeDist && car.id < free.id)) {
      free = car;
      freeDist = dist;
    }
  }
  return free;
}

/** Riders whose light of this class is on this floor for this shaft in this direction. */
function callersOf(shaft: Shaft, floor: number, dir: 1 | -1, cls: RiderClass, waiting: WaitIndex): Sim[] {
  const list = waiting.get(shaft.id)?.get(floor) ?? [];
  return list.filter((sim) => waitsFor(sim, shaft, floor, dir) && callClassOfSim(shaft, sim) === cls);
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
    if (car.y < span.lo || car.y > span.hi || !shaft.stops.has(Math.round(car.y))) {
      // Its floors changed while the doors stood open (out of its range, or this stop
      // turned off): shut them, nobody boards out here.
      car.state = 'idle';
      car.doorTimer = 0;
    } else {
      // Keep serving the floor for the whole door cycle, so a sim that starts waiting
      // while the doors are open still gets on.
      serveFloor(world, shaft, car, waiting, assigned);
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

  if (atFloor !== null && shouldStop(shaft, car, atFloor, dir, hasRoom, halls, waiting)) {
    return openDoors(world, shaft, car, dir, rule, waiting, halls);
  }

  const ahead = nearestAhead(y, dir, carFloors, halls);
  if (ahead !== null) return driveTo(car, dir, ahead, rule);

  // Nothing left this way: reverse.
  const back: 1 | -1 = dir === 1 ? -1 : 1;
  if (atFloor !== null && shouldStop(shaft, car, atFloor, back, hasRoom, halls, waiting)) {
    return openDoors(world, shaft, car, back, rule, waiting, halls);
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
  waiting: WaitIndex,
): boolean {
  if (!shaft.stops.has(floor)) return false;
  if (car.calls.has(floor)) return true;
  if (!hasRoom) return false;
  if (halls.some((e) => e.floor === floor && e.dir === dir)) return true;
  return passingPickup(shaft, car, floor, dir, halls, waiting);
}

/**
 * A kept car with room that is going past this floor this way anyway stops for someone else
 * waiting here to go the same way, to any floor that way it works, including past the last
 * floor its own riders need: going on straight is not a detour (PM decision 2026-09-29, on Matt's
 * delegation). Its own riders are still dispatched first (it gets no call for the others), and it
 * never turns round or leaves its path for them: a car with nothing further this way (it would
 * turn here) takes nobody on. An Everyone car never needs this.
 */
function passingPickup(
  shaft: Shaft,
  car: Car,
  floor: number,
  dir: 1 | -1,
  halls: HallEntry[],
  waiting: WaitIndex,
): boolean {
  if (car.serves === 'any') return false;
  if (!sweepGoesOn(shaft, car, floor, dir, halls)) return false;
  const queue = waiting.get(shaft.id)?.get(floor) ?? [];
  return queue.some((sim) => boardable(sim, shaft, floor, dir) && ridesPassing(shaft, car, sim));
}

/** Does this car have to go on past `floor` in `dir` anyway: a rider's floor or a call it has that way? */
function sweepGoesOn(shaft: Shaft, car: Car, floor: number, dir: 1 | -1, halls: HallEntry[]): boolean {
  const beyond = (f: number): boolean => (dir === 1 ? f > floor : f < floor);
  for (const f of car.calls) if (shaft.stops.has(f) && carCovers(shaft, car, f) && beyond(f)) return true;
  return halls.some((e) => beyond(e.floor));
}

/** Someone else's rider this kept car takes on its way: bound for a floor it works (the way it goes: boardable). */
function ridesPassing(shaft: Shaft, car: Car, sim: Sim): boolean {
  if (ridesAsOwn(shaft, car, sim)) return false;
  const leg = sim.route[0];
  return !!leg && leg.kind === 'ride' && carCovers(shaft, car, leg.toFloor);
}

function openDoors(
  world: World,
  shaft: Shaft,
  car: Car,
  dir: 1 | -1,
  rule: ShaftRule,
  waiting: WaitIndex,
  halls: HallEntry[],
): number {
  car.dir = dir;
  car.state = 'doorsOpen';
  car.doorTimer = rule.doorOpenMinutes;
  car.idleSince = null;
  serveFloor(world, shaft, car, waiting, halls);
  return car.y;
}

/** Alight, then board, then clear the hall call in the direction this car is serving. */
function serveFloor(world: World, shaft: Shaft, car: Car, waiting: WaitIndex, assigned: HallEntry[]): void {
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
  const leftover = leftoverFor(shaft, car, waiting);
  const queue = waiting.get(shaft.id)?.get(floor) ?? [];
  for (const sim of queue) {
    if (car.passengers.length >= rule.capacity) break;
    if (!boardable(sim, shaft, floor, dir)) continue;
    if (!carTakes(shaft, car, sim, leftover)) continue; // wrong car for this rider
    board(world, car, sim);
  }
  // A kept car that is not free still takes others going its way, after its own riders, while
  // this sweep goes on that way (passingPickup).
  const passing = new Set<RiderClass>();
  if (!leftover && car.serves !== 'any' && sweepGoesOn(shaft, car, floor, dir, assigned.filter((e) => stillCalled(shaft, e)))) {
    for (const sim of queue) {
      if (car.passengers.length >= rule.capacity) break;
      if (!boardable(sim, shaft, floor, dir) || !ridesPassing(shaft, car, sim)) continue;
      passing.add(callClassOfSim(shaft, sim)); // read before boarding moves the sim into the car
      board(world, car, sim);
    }
  }

  // The light goes out only for the classes this car just served in this direction.
  if (hadRoom && carCovers(shaft, car, floor)) {
    for (const cls of RIDER_CLASSES) {
      if (carServesClass(car, cls, leftover) || passing.has(cls)) clearHallCall(shaft, floor, dir, cls);
    }
  }
  // Anyone this car could not take keeps the floor lit, so another trip comes back.
  for (const sim of queue) {
    if (!boardable(sim, shaft, floor, dir)) continue; // boarded sims are riding now
    const leg = sim.route[0];
    if (leg && leg.kind === 'ride') requestHallCallFor(world, shaft, floor, leg.toFloor, sim.kind);
  }
}

function board(world: World, car: Car, sim: Sim): void {
  sim.inCarId = car.id;
  sim.state = 'riding';
  // Boarding ends the wait: the next wait (a transfer, the ride out) starts its own
  // clock and places its own hall call. The average takes the whole wait, from the
  // first call, across any reroute (people.ts keeps firstWaitStart for that).
  const since = sim.firstWaitStart ?? sim.waitStart;
  if (since !== null) recordBoardedWait(world, world.time.minute - since);
  sim.waitStart = null;
  delete sim.firstWaitStart;
  car.passengers.push(sim.id);
  const leg = sim.route[0];
  if (leg && leg.kind === 'ride') car.calls.add(leg.toFloor);
}

/** Would this car carry this sim: its own rider (class or service group) or a leftover, and the destination inside its range. */
function carTakes(shaft: Shaft, car: Car, sim: Sim, leftover: boolean): boolean {
  const leg = sim.route[0];
  if (!leg || leg.kind !== 'ride') return false;
  if (!carCovers(shaft, car, leg.toFloor)) return false;
  return leftover || ridesAsOwn(shaft, car, sim);
}

function boardable(sim: Sim, shaft: Shaft, floor: number, dir: 1 | -1): boolean {
  if (Math.abs(sim.pos.x - shaft.x) > shaft.width + 1) return false;
  return waitsFor(sim, shaft, floor, dir);
}

/** Waiting on this floor for a ride on this shaft in this direction, near the doors or not. */
function waitsFor(sim: Sim, shaft: Shaft, floor: number, dir: 1 | -1): boolean {
  if (sim.state !== 'waiting' || sim.inCarId !== null) return false;
  if (sim.pos.floor !== floor) return false;
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
