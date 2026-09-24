/**
 * Security guards: people, not a room flag.
 *
 * Every security office staffs SECURITY.guardsPerOffice guards, created the tick after the
 * office goes up (and again for an older save's offices on load, from the office ids, so a
 * replay stays equal) and removed with it. Half work the day shift and half the night. On
 * shift a guard walks a loop of the floors nearest the office by the normal routes and
 * elevators, pausing on each; off shift the guard waits in the office. An incident dispatches
 * the nearest guard on shift by route length, who travels there like anyone else.
 *
 * Guards never draw from world.rng: the loop runs in floor order and every tie breaks by id.
 * A guard in the office does not count toward its occupancy, so the office can still be
 * demolished (a room with people inside cannot be), and guards are not population.
 */

import { ensureRouting, findRoute } from './routing';
import { SECURITY, SHAFTS } from './rules';
import { clockOf, riderClassOf } from './types';
import type { GuardResponse, GuardState, Id, Leg, Room, Sim, World } from './types';
import { addSim, allocId, roomsOfKind } from './world';

/** Kept equal to people.ts WALK_TILES_PER_MINUTE (people imports this module, not the reverse). */
const WALK_TILES_PER_MINUTE = 5;

function roomCenter(room: Room): number {
  return room.x + Math.floor(room.width / 2);
}

function withoutStandingRides(legs: Leg[]): Leg[] {
  return legs.filter((leg) => leg.kind !== 'ride' || leg.fromFloor !== leg.toFloor);
}

function guardRouteOpts(sim: Sim): { staff: boolean; riderClass: ReturnType<typeof riderClassOf> } {
  return { staff: true, riderClass: riderClassOf(sim.kind) };
}

/** Security offices in id order, so staffing and dispatch never depend on map order. */
export function securityOffices(world: World): Room[] {
  return roomsOfKind(world, 'security').sort((a, b) => a.id - b.id);
}

/** Is this minute of day inside the shift? Shifts may wrap past midnight. */
export function onShiftAt(shift: number, minuteOfDay: number): boolean {
  const rule = SECURITY.shifts[shift] ?? SECURITY.shifts[0];
  if (!rule) return false;
  if (rule.start < rule.end) return minuteOfDay >= rule.start && minuteOfDay < rule.end;
  return minuteOfDay >= rule.start || minuteOfDay < rule.end;
}

export function isOnShift(world: World, sim: Sim): boolean {
  return sim.guard !== undefined && onShiftAt(sim.guard.shift, clockOf(world.time.minute).minuteOfDay);
}

function newGuardState(shift: number): GuardState {
  return { shift, task: 'office', floor: null, pauseUntil: null, respond: null, routed: false };
}

/** The guards of one office, in the order they were hired. */
export function guardsOf(world: World, office: Room): Sim[] {
  const out: Sim[] = [];
  for (const id of office.tenants) {
    const sim = world.sims.get(id);
    if (sim && sim.kind === 'guard') out.push(sim);
  }
  return out;
}

/** Hire up to the office's complement. The first half take the first shift. */
function staffOffice(world: World, office: Room): void {
  const half = Math.ceil(SECURITY.guardsPerOffice / 2);
  while (office.tenants.length < SECURITY.guardsPerOffice) {
    const shift = office.tenants.length < half ? 0 : 1;
    const guard: Sim = {
      id: allocId(world),
      kind: 'guard',
      homeRoomId: office.id,
      pos: { floor: office.floor, x: roomCenter(office) },
      inCarId: null,
      inRoomId: office.id,
      route: [],
      state: 'inRoom',
      stress: 0,
      waitStart: null,
      schedule: [],
      nextScheduleIndex: 0,
      stayUntil: null,
      wallet: 0,
      leaveReason: null,
      guard: newGuardState(shift),
    };
    addSim(world, guard);
    office.tenants.push(guard.id);
  }
}

// ---------------------------------------------------------------- the patrol loop

/**
 * The floors a guard of this office walks: the SECURITY.patrolFloors floors with rooms on
 * them nearest the office (a tie goes to the lower floor), in floor order.
 */
export function patrolFloors(world: World, office: Room): number[] {
  const floors: number[] = [];
  for (const [floor, rooms] of world.floorIndex.rooms) if (rooms.length > 0) floors.push(floor);
  floors.sort((a, b) => Math.abs(a - office.floor) - Math.abs(b - office.floor) || a - b);
  return floors.slice(0, SECURITY.patrolFloors).sort((a, b) => a - b);
}

/** Where on a floor the guard stops: the middle of the rooms on it. */
function patrolX(world: World, floor: number, fallback: number): number {
  const rooms = world.floorIndex.rooms.get(floor) ?? [];
  if (rooms.length === 0) return fallback;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const room of rooms) {
    lo = Math.min(lo, room.x);
    hi = Math.max(hi, room.x + room.width);
  }
  return Math.floor((lo + hi) / 2);
}

function sendAlong(sim: Sim, legs: Leg[]): void {
  sim.route = withoutStandingRides(legs);
  sim.state = 'walking';
  sim.waitStart = null;
  sim.inRoomId = null;
}

/** Where in the loop the guard goes next: the nearest loop floor at the start of a shift, else the one after. */
function firstCandidate(floors: readonly number[], g: GuardState, standingOn: number): number {
  if (g.floor === null) {
    let best = 0;
    for (let i = 1; i < floors.length; i++) {
      if (Math.abs((floors[i] as number) - standingOn) < Math.abs((floors[best] as number) - standingOn)) best = i;
    }
    return best;
  }
  const at = floors.indexOf(g.floor);
  if (at >= 0) return (at + 1) % floors.length;
  const above = floors.findIndex((f) => f > (g.floor as number));
  return above >= 0 ? above : 0;
}

/** The next floor of the loop, by the first from there that has a route. */
function walkToNextPatrolFloor(world: World, sim: Sim, office: Room, g: GuardState): void {
  const floors = patrolFloors(world, office);
  g.task = 'patrol';
  g.pauseUntil = null;
  const start = floors.length > 0 ? firstCandidate(floors, g, sim.pos.floor) : 0;
  for (let step = 0; step < floors.length; step++) {
    const floor = floors[(start + step) % floors.length] as number;
    const legs = findRoute(world, sim.pos, { floor, x: patrolX(world, floor, sim.pos.x) }, guardRouteOpts(sim));
    if (!legs) continue;
    g.floor = floor;
    sendAlong(sim, legs);
    return;
  }
  // Nowhere reachable: wait a pause where they stand and try again.
  g.pauseUntil = world.time.minute + SECURITY.patrolPauseMinutes;
}

function enterOffice(sim: Sim, office: Room, g: GuardState): void {
  sim.state = 'inRoom';
  sim.inRoomId = office.id;
  sim.pos = { floor: office.floor, x: roomCenter(office) };
  sim.route = [];
  sim.waitStart = null;
  g.task = 'office';
  g.floor = null;
  g.pauseUntil = null;
}

function headToOffice(world: World, sim: Sim, office: Room, g: GuardState): void {
  const legs = findRoute(world, sim.pos, { floor: office.floor, x: roomCenter(office) }, guardRouteOpts(sim));
  if (!legs) {
    // Stranded (the floor under them lost its last way out): the shift still ends.
    enterOffice(sim, office, g);
    return;
  }
  g.task = 'return';
  g.floor = null;
  g.pauseUntil = null;
  sendAlong(sim, legs);
}

/** Is the incident this guard was sent to still going? */
function responseLive(world: World, sim: Sim, respond: GuardResponse): boolean {
  for (const event of world.events) {
    if (respond.kind === 'fire' && event.kind === 'fire') return true;
    if (respond.kind === 'bomb' && event.kind === 'bomb') return event.roomId === respond.roomId;
    if (respond.kind === 'theft' && event.kind === 'theft') return event.guardId === sim.id;
  }
  return false;
}

/** One guard's minute: only when standing still does the guard choose what to do next. */
function tickGuard(world: World, sim: Sim, office: Room): void {
  if (!sim.guard) sim.guard = newGuardState(0);
  const g = sim.guard;
  if (sim.state === 'leaving' || sim.state === 'gone' || sim.exiting) return;
  if (sim.state === 'waiting' || sim.state === 'riding') return;
  if (g.task === 'respond' && g.respond) {
    if (responseLive(world, sim, g.respond)) {
      if (!g.routed) {
        const legs = findRoute(world, sim.pos, { floor: g.respond.floor, x: g.respond.x }, guardRouteOpts(sim));
        g.routed = true;
        if (legs) sendAlong(sim, legs);
      }
      return;
    }
    // Over: back to the loop, or to the office if the shift ended meanwhile.
    g.respond = null;
    g.routed = false;
    g.task = 'patrol';
    g.pauseUntil = null;
    if (sim.state === 'walking' && sim.route.length > 0) sim.route = [];
  }
  if (sim.route.length > 0) return; // still walking somewhere
  const minute = world.time.minute;
  if (!onShiftAt(g.shift, clockOf(minute).minuteOfDay)) {
    if (sim.state === 'inRoom' && sim.inRoomId === office.id) return;
    if (g.task === 'return' && sim.pos.floor === office.floor) {
      enterOffice(sim, office, g);
      return;
    }
    headToOffice(world, sim, office, g);
    return;
  }
  if (g.task === 'office' || g.task === 'return') {
    if (sim.state === 'inRoom') {
      sim.inRoomId = null;
      sim.state = 'walking';
    }
    g.floor = null;
    walkToNextPatrolFloor(world, sim, office, g);
    return;
  }
  // Patrolling and standing on a floor of the loop: pause, then move on.
  if (g.pauseUntil === null) {
    g.pauseUntil = minute + SECURITY.patrolPauseMinutes;
    return;
  }
  if (minute < g.pauseUntil) return;
  walkToNextPatrolFloor(world, sim, office, g);
}

/** Called by tickPeople each minute: staff every office, then move every guard. */
export function runGuards(world: World): void {
  const offices = securityOffices(world);
  if (offices.length === 0) return;
  for (const office of offices) staffOffice(world, office);
  for (const office of offices) {
    for (const sim of guardsOf(world, office)) tickGuard(world, sim, office);
  }
}

/** A guard lost the car it was waiting for (the shaft went): plan again from here. */
export function guardLostRoute(sim: Sim): void {
  sim.route = [];
  sim.state = 'walking';
  sim.waitStart = null;
  if (sim.guard) {
    sim.guard.routed = false;
    if (sim.guard.task === 'patrol') sim.guard.pauseUntil = null;
  }
}

// ---------------------------------------------------------------- dispatch

/** Minutes a route should take at walking pace and car speed, not counting waits. */
export function routeMinutes(world: World, from: { floor: number; x: number }, legs: readonly Leg[]): number {
  let x = from.x;
  let floor = from.floor;
  let minutes = 0;
  for (const leg of legs) {
    if (leg.kind === 'walk') {
      minutes += Math.abs(leg.toX - x) / WALK_TILES_PER_MINUTE;
      x = leg.toX;
    } else if (leg.kind === 'ride') {
      const shaft = world.shafts.get(leg.shaftId);
      const speed = shaft ? SHAFTS[shaft.kind].floorsPerMinute : 1;
      if (shaft) x = shaft.x;
      minutes += Math.abs(leg.toFloor - floor) / speed;
      floor = leg.toFloor;
    } else if (leg.kind === 'stairs') {
      minutes += Math.abs(leg.toFloor - floor);
      floor = leg.toFloor;
    }
  }
  return minutes;
}

export type DispatchResult = { ok: true; guard: Sim } | { ok: false; why: 'none' | 'busy' | 'noRoute' };

/**
 * Send the nearest guard on shift, by route length, to an incident. A guard already
 * responding to something is busy. The guard travels like any trip: a guard in a car plans
 * the rest once off it. The caller records the guard.dispatched beat.
 */
export function dispatchGuard(world: World, respond: GuardResponse): DispatchResult {
  const offices = securityOffices(world);
  if (offices.length === 0) return { ok: false, why: 'none' };
  ensureRouting(world);
  const minuteOfDay = clockOf(world.time.minute).minuteOfDay;
  let sawOnShift = false;
  let sawFree = false;
  let best: { sim: Sim; legs: Leg[]; cost: number } | null = null;
  for (const office of offices) {
    for (const sim of guardsOf(world, office)) {
      const g = sim.guard;
      if (!g || sim.state === 'leaving' || sim.state === 'gone' || sim.exiting) continue;
      if (!onShiftAt(g.shift, minuteOfDay)) continue;
      sawOnShift = true;
      if (g.task === 'respond') continue;
      sawFree = true;
      const legs = findRoute(world, sim.pos, { floor: respond.floor, x: respond.x }, guardRouteOpts(sim));
      if (!legs) continue;
      const cost = routeMinutes(world, sim.pos, legs);
      if (best === null || cost < best.cost) best = { sim, legs, cost };
    }
  }
  if (!best) return { ok: false, why: !sawOnShift ? 'none' : !sawFree ? 'busy' : 'noRoute' };
  const { sim, legs } = best;
  const g = sim.guard as GuardState;
  g.task = 'respond';
  g.respond = { ...respond };
  g.floor = respond.floor;
  g.pauseUntil = null;
  if (sim.state === 'riding') {
    g.routed = false; // plans the way from the floor the car lets them off at
  } else {
    g.routed = true;
    sendAlong(sim, legs);
  }
  return { ok: true, guard: sim };
}

/** The guard sent to an incident is released when it ends; the guard picks the loop up again. */
export function releaseGuard(world: World, guardId: Id | null): void {
  if (guardId === null) return;
  const sim = world.sims.get(guardId);
  const g = sim?.guard;
  if (!sim || !g || g.task !== 'respond') return;
  g.task = 'patrol';
  g.respond = null;
  g.routed = false;
  g.pauseUntil = null;
  if (sim.state === 'walking') sim.route = [];
}

// ---------------------------------------------------------------- words for the panels

function floorText(floor: number): string {
  return floor < 0 ? `floor B${-floor}` : `floor ${floor}`;
}

/** "In the office", "Patrolling floor 7", "Responding to floor 12", "Off shift". */
export function guardStatus(world: World, sim: Sim): string {
  const g = sim.guard;
  if (!g) return 'In the office';
  if (g.task === 'respond' && g.respond) return `Responding to ${floorText(g.respond.floor)}`;
  if (!onShiftAt(g.shift, clockOf(world.time.minute).minuteOfDay)) return 'Off shift';
  if (g.task === 'patrol' && g.floor !== null) return `Patrolling ${floorText(g.floor)}`;
  return 'In the office';
}

/** "Floors 3 to 7", "Floor 4", or the list when the loop skips floors. */
export function coverageText(world: World, office: Room): string {
  const floors = patrolFloors(world, office);
  if (floors.length === 0) return 'No floors yet';
  const words = floors.map((f) => (f < 0 ? `B${-f}` : String(f)));
  if (floors.length === 1) return `Floor ${words[0]}`;
  const contiguous = floors.every((f, i) => i === 0 || f === (floors[i - 1] as number) + 1 || (f === 1 && floors[i - 1] === -1));
  if (contiguous) return `Floors ${words[0]} to ${words[words.length - 1]}`;
  return `Floors ${words.join(', ')}`;
}
