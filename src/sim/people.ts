/**
 * People: who arrives, where they go, how long they wait, and when they give up.
 *
 * Reads top to bottom in six parts: intake, schedules, movement, stress, leaving,
 * housekeeping. Every number comes from rules.ts and every random draw comes from
 * world.rng, so a seed plus a command list always replays the same day.
 */

import { requestHallCall } from './elevators';
import { recordCondoSale, recordHotelNight, recordVisit } from './economy';
import { ensureRouting, entrances, findRoute, isReachableFromLobby } from './routing';
import { ECONOMY, ROOMS, SCHEDULES, STRESS } from './rules';
import { clockOf } from './types';
import type {
  Clock,
  Id,
  Leg,
  Room,
  Shaft,
  RoomKind,
  ScheduleEntry,
  Sim,
  SimKind,
  StressBand,
  World,
} from './types';
import { addSim, allocId, log, removeSim, roomsOfKind } from './world';

/** Tiles a sim covers in one minute on foot. */
export const WALK_TILES_PER_MINUTE = 5;

// Local rules: rules.ts has no entry for these, so they live here and are marked as our call.
/** A waiting sim re-registers its hall call this often if the call is no longer pending. */
const HALL_CALL_RETRY_MINUTES = 6;
/** After this many silent retries the sim stops trusting the shaft and asks routing again. */
const RETRIES_BEFORE_REROUTE = 3;
/** Housekeepers stop taking new rooms after this minute of day. */
const HOUSEKEEPING_END_MINUTE = 20 * 60;
/** Share of a commerce room's seats that the crowd aims to fill, tuned to ROOMS[kind].incomePerQuarter. */
const VISITOR_FILL: Partial<Record<RoomKind, number>> = { shop: 0.2, fastFood: 0.8, restaurant: 0.45 };
/** A show pulls between this share of the seats and a full house. */
const SHOW_FILL_MIN = 0.5;
/** Preference weight only, not a duration: one floor away counts as this many tiles when picking the nearest room or door. */
const FLOOR_PREFERENCE_TILES = 10;

const COMMERCE_KINDS = new Set<RoomKind>(['shop', 'fastFood', 'restaurant', 'cinema', 'partyHall']);
const HOTEL_KINDS = new Set<RoomKind>(['hotelSingle', 'hotelTwin', 'hotelSuite']);
const DINING_KINDS = new Set<RoomKind>(['fastFood', 'restaurant']);
/** Sims that go home to somewhere else: they are removed from the world when they reach an entrance. */
const TRANSIENT_KINDS = new Set<SimKind>(['shopper', 'diner', 'visitor', 'guest', 'vip']);

export function stressBand(stress: number): StressBand {
  if (stress >= STRESS.red) return 'red';
  if (stress >= STRESS.pink) return 'pink';
  return 'calm';
}

export function tickPeople(world: World): void {
  if (world.gameOver) return;
  const clock = clockOf(world.time.minute);
  ensureRouting(world);
  runIntake(world, clock);
  runSchedules(world, clock);
  runHousekeeping(world, clock);
  runLeaving(world);
  moveSims(world);
  retireOutsideSims(world);
  updateStress(world);
}

// ---------------------------------------------------------------------------
// 1. Intake: who joins the tower today
// ---------------------------------------------------------------------------

function runIntake(world: World, clock: Clock): void {
  fillVacantOffices(world, clock);
  sellVacantCondos(world, clock);
  spawnHotelGuests(world, clock);
  spawnCommerceVisitors(world, clock);
  spawnShowAudiences(world, clock);
}

/** A reachable vacant office takes a full staff on a weekday morning. */
function fillVacantOffices(world: World, clock: Clock): void {
  const rule = SCHEDULES.worker;
  if (clock.isWeekend) return;
  if (clock.minuteOfDay < rule.arriveStart || clock.minuteOfDay > rule.arriveEnd) return;
  for (const room of roomsOfKind(world, 'office')) {
    if (!room.vacant || room.tenants.length > 0 || room.onFire) continue;
    if (!isReachableFromLobby(world, room.floor, room.x)) continue;
    room.vacant = false;
    for (let i = 0; i < ROOMS.office.capacity; i++) {
      const sim = spawnWorker(world, room, clock);
      room.tenants.push(sim.id);
    }
    log(world, `An office on ${floorLabel(room.floor)} leased to a new tenant.`, 'info', { roomId: room.id });
  }
}

/** A reachable vacant condo sells once the room evaluates well enough. */
function sellVacantCondos(world: World, clock: Clock): void {
  const rule = SCHEDULES.resident;
  if (clock.isWeekend) return;
  if (clock.minuteOfDay < rule.leaveStart || clock.minuteOfDay > rule.leaveEnd) return;
  for (const room of roomsOfKind(world, 'condo')) {
    if (!room.vacant || room.tenants.length > 0 || room.onFire) continue;
    if (room.eval < ECONOMY.condoSaleEvalMin) continue;
    if (!isReachableFromLobby(world, room.floor, room.x)) continue;
    recordCondoSale(world, room);
    room.vacant = false;
    for (let i = 0; i < ROOMS.condo.capacity; i++) {
      const sim = spawnResident(world, room);
      room.tenants.push(sim.id);
    }
    log(world, `A condo on ${floorLabel(room.floor)} sold to a new owner.`, 'info', { roomId: room.id });
  }
}

/** Once an evening, each clean and empty hotel room books itself with the night's chance. */
function spawnHotelGuests(world: World, clock: Clock): void {
  const rule = SCHEDULES.guest;
  if (clock.minuteOfDay !== rule.checkInStart) return;
  const chance = clock.isWeekend ? rule.occupancyWeekend : rule.occupancyWeekday;
  for (const room of world.rooms.values()) {
    if (!HOTEL_KINDS.has(room.kind)) continue;
    if (room.dirty || room.infested || room.onFire || room.tenants.length > 0) continue;
    if (!isReachableFromLobby(world, room.floor, room.x)) continue;
    if (world.rng.next() >= chance) continue;
    const checkIn = world.rng.int(rule.checkInStart, rule.checkInEnd);
    const checkOut = world.rng.int(rule.checkOutStart, rule.checkOutEnd);
    for (let i = 0; i < ROOMS[room.kind].capacity; i++) {
      const sim = spawnGuest(world, room, checkIn, checkOut);
      room.tenants.push(sim.id);
    }
  }
}

/** Shops and places to eat pull a crowd sized to their seats while they are open. */
function spawnCommerceVisitors(world: World, clock: Clock): void {
  for (const room of world.rooms.values()) {
    const rate = visitorRatePerMinute(room, clock);
    if (rate <= 0) continue;
    const rule = ROOMS[room.kind];
    if (room.onFire || room.occupancy >= rule.capacity) continue;
    if (!isReachableFromLobby(world, room.floor, room.x)) continue;
    let count = Math.floor(rate);
    if (world.rng.next() < rate - count) count += 1;
    const stay = DINING_KINDS.has(room.kind) ? SCHEDULES.diner.visitMinutes : SCHEDULES.shopper.visitMinutes;
    const kind: SimKind = DINING_KINDS.has(room.kind) ? 'diner' : 'shopper';
    for (let i = 0; i < count && room.occupancy + i < rule.capacity; i++) {
      spawnVisitor(world, room, kind, stay, clock);
    }
  }
}

/** Cinemas fill at show time; the party hall fills once on the weekend. */
function spawnShowAudiences(world: World, clock: Clock): void {
  for (const room of world.rooms.values()) {
    let stay = 0;
    if (room.kind === 'cinema' && SCHEDULES.cinema.showTimes.includes(clock.minuteOfDay)) {
      stay = SCHEDULES.cinema.showMinutes;
    } else if (room.kind === 'partyHall' && clock.isWeekend && clock.minuteOfDay === SCHEDULES.partyHall.weekendStart) {
      stay = SCHEDULES.partyHall.durationMinutes;
    }
    if (stay === 0) continue;
    if (room.onFire || !isReachableFromLobby(world, room.floor, room.x)) continue;
    const seats = ROOMS[room.kind].capacity;
    const weekend = clock.isWeekend ? SCHEDULES.shopper.weekendMultiplier : 1;
    const fill = Math.min(1, (SHOW_FILL_MIN + world.rng.next() * (1 - SHOW_FILL_MIN)) * weekend);
    const audience = Math.max(0, Math.min(seats - room.occupancy, Math.round(seats * fill)));
    for (let i = 0; i < audience; i++) spawnVisitor(world, room, 'visitor', stay, clock);
  }
}

/** Expected arrivals per minute for a shop or a place to eat, zero when it is closed. */
function visitorRatePerMinute(room: Room, clock: Clock): number {
  const fill = VISITOR_FILL[room.kind];
  if (fill === undefined) return 0;
  const weekend = clock.isWeekend ? SCHEDULES.shopper.weekendMultiplier : 1;
  if (DINING_KINDS.has(room.kind)) {
    const rule = SCHEDULES.diner;
    const open =
      (clock.minuteOfDay >= rule.lunchStart && clock.minuteOfDay < rule.lunchEnd) ||
      (clock.minuteOfDay >= rule.dinnerStart && clock.minuteOfDay < rule.dinnerEnd);
    if (!open) return 0;
    return (ROOMS[room.kind].capacity / rule.visitMinutes) * fill * weekend;
  }
  const rule = SCHEDULES.shopper;
  if (clock.minuteOfDay < rule.open || clock.minuteOfDay >= rule.close) return 0;
  return (ROOMS[room.kind].capacity / rule.visitMinutes) * fill * weekend;
}

// ---------------------------------------------------------------------------
// 2. Schedules: turning the day plan into routes
// ---------------------------------------------------------------------------

function runSchedules(world: World, clock: Clock): void {
  for (const sim of [...world.sims.values()]) {
    if (sim.state === 'gone' || sim.state === 'leaving') continue;
    if (clock.minuteOfDay === 0 && sim.homeRoomId !== null) {
      sim.nextScheduleIndex = 0;
      sim.leaveReason = null; // a new day, and stress starts fading again
    }
    if (sim.state === 'inRoom' && sim.stayUntil !== null && world.time.minute >= sim.stayUntil) {
      onStayEnded(world, sim, clock);
      continue;
    }
    if (sim.state !== 'inRoom' && sim.state !== 'outside') continue;
    dispatchDueEntries(world, sim, clock);
  }
}

function dispatchDueEntries(world: World, sim: Sim, clock: Clock): void {
  while (sim.nextScheduleIndex < sim.schedule.length) {
    const entry = sim.schedule[sim.nextScheduleIndex];
    if (!entry || entry.minuteOfDay > clock.minuteOfDay) break;
    sim.nextScheduleIndex += 1;
    if (!entry.days.includes(clock.isWeekend ? 'weekend' : 'weekday')) continue;
    if (startTrip(world, sim, entry.goal)) break;
  }
}

/** A stay ran out: take the next plan if there is one, otherwise head out of the tower. */
function onStayEnded(world: World, sim: Sim, clock: Clock): void {
  if (sim.kind === 'staff') {
    finishCleaning(world, sim);
    return;
  }
  departRoom(world, sim);
  const next = sim.schedule[sim.nextScheduleIndex];
  if (next && next.days.includes(clock.isWeekend ? 'weekend' : 'weekday')) {
    sim.nextScheduleIndex += 1;
    if (startTrip(world, sim, next.goal)) return;
  }
  leaveTower(world, sim);
}

/** Resolve a goal to a destination, route to it, and append the enter leg. */
function startTrip(world: World, sim: Sim, goal: ScheduleEntry['goal']): boolean {
  if (goal.kind === 'exit') {
    leaveTower(world, sim);
    return true;
  }
  const room = goal.kind === 'room' ? world.rooms.get(goal.roomId) : pickRoomOfKind(world, sim, goal.roomKind);
  if (!room) return false;
  if (sim.inRoomId === room.id) return true;
  const target = { floor: room.floor, x: roomCenter(room) };
  const legs = findRoute(world, sim.pos, target, sim.kind === 'staff' ? { staff: true } : undefined);
  if (!legs) return false;
  if (sim.inRoomId !== null) departRoom(world, sim);
  sim.route = [...withoutStandingRides(legs), { kind: 'enter', roomId: room.id }];
  sim.state = 'walking';
  sim.waitStart = null;
  return true;
}

function pickRoomOfKind(world: World, sim: Sim, kind: RoomKind): Room | undefined {
  const wanted = DINING_KINDS.has(kind) ? DINING_KINDS : new Set<RoomKind>([kind]);
  let best: Room | undefined;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const room of world.rooms.values()) {
    if (!wanted.has(room.kind) || room.onFire) continue;
    if (room.occupancy >= ROOMS[room.kind].capacity) continue;
    if (!isReachableFromLobby(world, room.floor, room.x)) continue;
    const cost = Math.abs(room.floor - sim.pos.floor) * FLOOR_PREFERENCE_TILES + Math.abs(room.x - sim.pos.x);
    if (cost < bestCost) {
      bestCost = cost;
      best = room;
    }
  }
  return best;
}

/** Head for the nearest entrance: visitors are removed there, tenants wait outside. */
function leaveTower(world: World, sim: Sim): void {
  // Visitors and tenants who are moving out never come back, and the intent has to
  // outlive the transit state: boarding rewrites state to waiting, riding, then walking,
  // so only this flag survives the trip. Tenants heading home for the night keep it
  // clear, because they wait outside and return on tomorrow's schedule.
  if (TRANSIENT_KINDS.has(sim.kind) || sim.state === 'leaving') sim.exiting = true;
  if (sim.inRoomId !== null) departRoom(world, sim);
  if (TRANSIENT_KINDS.has(sim.kind)) {
    sim.state = 'leaving';
    sim.route = [];
    return;
  }
  const exit = nearestEntrance(world, sim.pos);
  if (!exit) {
    sim.state = 'outside';
    sim.route = [];
    return;
  }
  const legs = findRoute(world, sim.pos, exit);
  if (!legs || legs.length === 0) {
    sim.state = 'outside';
    sim.pos = { floor: exit.floor, x: exit.x };
    sim.route = [];
    return;
  }
  sim.route = withoutStandingRides(legs);
  sim.state = 'walking';
}

// ---------------------------------------------------------------------------
// 3. Movement: walking, waiting for a car, climbing stairs, entering a room
// ---------------------------------------------------------------------------

function moveSims(world: World): void {
  for (const sim of [...world.sims.values()]) {
    if (sim.state !== 'walking' && sim.state !== 'leaving') continue;
    stepAlongRoute(world, sim);
  }
}

function stepAlongRoute(world: World, sim: Sim): void {
  let budget = WALK_TILES_PER_MINUTE;
  while (sim.route.length > 0) {
    const leg = sim.route[0] as Leg;
    if (leg.kind === 'walk') {
      const dx = leg.toX - sim.pos.x;
      const step = Math.min(budget, Math.abs(dx));
      sim.pos.x += Math.sign(dx) * step;
      budget -= step;
      if (sim.pos.x === leg.toX) sim.route.shift();
      else break;
    } else if (leg.kind === 'ride') {
      const shaft = world.shafts.get(leg.shaftId);
      if (!shaft) {
        leaveTower(world, sim);
        return;
      }
      if (leg.toFloor === sim.pos.floor) {
        sim.route.shift(); // a ride that goes nowhere: the car would open and close on the spot
        continue;
      }
      if (!withinReach(sim, shaft)) {
        // Walk to the doors before calling anything: a car answering a call nobody can
        // board opens, finds no one, and closes again every couple of ticks.
        sim.route.unshift({ kind: 'walk', toX: shaft.x });
        continue;
      }
      beginWait(world, sim, leg, shaft);
      return;
    } else if (leg.kind === 'stairs') {
      climbStairs(world, sim, leg);
      budget = 0;
    } else {
      sim.route.shift();
      const room = world.rooms.get(leg.roomId);
      if (room) enterRoom(world, sim, room);
      else leaveTower(world, sim);
      return;
    }
    if (budget <= 0) {
      const next = sim.route[0];
      // Calling a car or stepping through a door costs no walking, so take it now
      // rather than standing at the door for a minute. Walks and stairs wait.
      if (!next || next.kind === 'walk' || next.kind === 'stairs') break;
    }
  }
  if (sim.route.length === 0) arriveWithoutRoom(world, sim);
}

function beginWait(world: World, sim: Sim, leg: Extract<Leg, { kind: 'ride' }>, shaft: Shaft): void {
  sim.state = 'waiting';
  if (sim.waitStart === null) {
    sim.waitStart = world.time.minute;
    requestHallCall(world, shaft.id, sim.pos.floor, leg.toFloor > sim.pos.floor ? 1 : -1);
  }
}

/** Close enough to the doors to board, the same test elevators.ts uses. */
function withinReach(sim: Sim, shaft: Shaft): boolean {
  return Math.abs(sim.pos.x - shaft.x) <= shaft.width + 1;
}

/** Routing can hand back a ride between the same two floors; nobody should call a car for it. */
function withoutStandingRides(legs: Leg[]): Leg[] {
  return legs.filter((leg) => leg.kind !== 'ride' || leg.fromFloor !== leg.toFloor);
}

function climbStairs(world: World, sim: Sim, leg: Extract<Leg, { kind: 'stairs' }>): void {
  const floors = Math.abs(leg.toFloor - sim.pos.floor);
  sim.stress = Math.min(STRESS.giveUp, sim.stress + STRESS.perStairFloor * floors);
  const stairs = world.rooms.get(leg.roomId);
  sim.pos = { floor: leg.toFloor, x: stairs ? roomCenter(stairs) : sim.pos.x };
  sim.route.shift();
}

function enterRoom(world: World, sim: Sim, room: Room): void {
  if (sim.exiting) {
    leaveTower(world, sim);
    return;
  }
  if (COMMERCE_KINDS.has(room.kind) && room.occupancy >= ROOMS[room.kind].capacity) {
    leaveTower(world, sim);
    return;
  }
  sim.inRoomId = room.id;
  sim.inCarId = null;
  sim.state = 'inRoom';
  sim.pos = { floor: room.floor, x: roomCenter(room) };
  sim.waitStart = null;
  room.occupancy += 1;
  const stay = stayMinutesFor(sim, room);
  sim.stayUntil = stay > 0 ? world.time.minute + stay : null;
  if (COMMERCE_KINDS.has(room.kind)) recordVisit(world, room);
}

/** How long this sim stays: a cleaning shift, the plan it is running, or no set time. */
function stayMinutesFor(sim: Sim, room: Room): number {
  if (sim.kind === 'staff') return HOTEL_KINDS.has(room.kind) && room.dirty ? SCHEDULES.housekeeping.minutesPerRoom : 0;
  const entry = sim.schedule[sim.nextScheduleIndex - 1];
  return entry ? entry.stayMinutes : 0;
}

/** A route that ended without an enter leg finished at an entrance. */
function arriveWithoutRoom(world: World, sim: Sim): void {
  if (sim.exiting || sim.state === 'leaving') {
    finishLeave(world, sim);
    return;
  }
  if (sim.state !== 'walking') return;
  // The route already carried this sim to the door, so leave it standing where it stopped.
  sim.state = 'outside';
  sim.waitStart = null;
}

function departRoom(world: World, sim: Sim): void {
  const room = sim.inRoomId !== null ? world.rooms.get(sim.inRoomId) : undefined;
  if (room) {
    room.occupancy = Math.max(0, room.occupancy - 1);
    if (sim.kind === 'guest' && HOTEL_KINDS.has(room.kind) && room.tenants.includes(sim.id)) {
      checkOutOfHotel(world, sim, room);
    }
  }
  sim.inRoomId = null;
  sim.stayUntil = null;
}

function checkOutOfHotel(world: World, sim: Sim, room: Room): void {
  room.tenants = room.tenants.filter((id) => id !== sim.id);
  if (room.tenants.length > 0) return;
  room.dirty = true;
  room.dirtySinceMinute = world.time.minute;
  recordHotelNight(world, room);
  log(world, `A hotel room on ${floorLabel(room.floor)} checked out and needs cleaning.`, 'info', { roomId: room.id });
}

// ---------------------------------------------------------------------------
// 4. Stress: it builds at the elevator and fades once people are settled
// ---------------------------------------------------------------------------

function updateStress(world: World): void {
  for (const sim of [...world.sims.values()]) {
    if (sim.state === 'waiting') {
      sim.stress = Math.min(STRESS.giveUp, sim.stress + STRESS.perWaitingMinute);
      // A sim can abandon a trip once a day. On the way out, or on the way home after
      // giving up, there is nothing left to abandon: giving up again would clear the
      // route every minute and ask routing for a new one on the next, so a sim already
      // headed for the door waits for its car however cross it is.
      if (sim.stress >= STRESS.giveUp && !sim.exiting && sim.leaveReason === null) {
        giveUp(world, sim);
        continue;
      }
      retryHallCall(world, sim);
    } else if (sim.state === 'inRoom' || (sim.state === 'outside' && sim.leaveReason === null)) {
      // Outside with a reason means it went home cross today: the stress stands until
      // midnight so evaluation.ts sees the day it had.
      sim.stress = Math.max(0, sim.stress - STRESS.decayPerMinuteInRoom);
    }
  }
}

/** Keep the call alive if a full car cleared it and left this sim on the floor. */
function retryHallCall(world: World, sim: Sim): void {
  const leg = sim.route[0];
  if (!leg || leg.kind !== 'ride' || sim.waitStart === null) return;
  const waited = world.time.minute - sim.waitStart;
  if (waited <= 0 || waited % HALL_CALL_RETRY_MINUTES !== 0) return;
  const shaft = world.shafts.get(leg.shaftId);
  if (!shaft) return;
  if (waited >= HALL_CALL_RETRY_MINUTES * RETRIES_BEFORE_REROUTE) {
    rerouteWaitingSim(world, sim);
    return;
  }
  if (!withinReach(sim, shaft)) return;
  const dir: 1 | -1 = leg.toFloor > sim.pos.floor ? 1 : -1;
  const pending = shaft.hallCalls.get(sim.pos.floor);
  if (pending && (dir === 1 ? pending.up : pending.down)) return;
  requestHallCall(world, shaft.id, sim.pos.floor, dir);
}

/** Three silent retries: the shaft is not serving this floor, so ask routing for another way. */
function rerouteWaitingSim(world: World, sim: Sim): void {
  const dest = routeDestination(world, sim);
  const legs = findRoute(world, sim.pos, dest.at, sim.kind === 'staff' ? { staff: true } : undefined);
  if (!legs) return; // nothing better on offer: keep waiting and let stress decide
  const enter: Leg[] = dest.roomId !== null ? [{ kind: 'enter', roomId: dest.roomId }] : [];
  sim.route = [...withoutStandingRides(legs), ...enter];
  sim.state = 'walking';
  sim.waitStart = null;
}

/** Where the legs still in hand were taking this sim. */
function routeDestination(world: World, sim: Sim): { at: { floor: number; x: number }; roomId: Id | null } {
  let floor = sim.pos.floor;
  let x = sim.pos.x;
  let roomId: Id | null = null;
  for (const leg of sim.route) {
    if (leg.kind === 'walk') x = leg.toX;
    else if (leg.kind === 'ride' || leg.kind === 'stairs') floor = leg.toFloor;
    else {
      roomId = leg.roomId;
      const room = world.rooms.get(leg.roomId);
      if (room) {
        floor = room.floor;
        x = roomCenter(room);
      }
    }
  }
  return { at: { floor, x }, roomId };
}

function giveUp(world: World, sim: Sim): void {
  sim.stress = STRESS.giveUp;
  sim.route = [];
  sim.waitStart = null;
  if (isTenant(sim)) {
    // A fed up tenant abandons today's trip, not the lease. It sulks outside with its
    // stress intact, which is what the room's evaluation averages, so a tower that keeps
    // people waiting empties the office through evaluation.ts over a full day instead.
    sim.leaveReason = `Gave up waiting for an elevator on ${floorLabel(sim.pos.floor)} and went home.`;
    log(world, sim.leaveReason, 'warn', { simId: sim.id });
    leaveTower(world, sim);
    return;
  }
  sim.exiting = true;
  sim.state = 'leaving';
  sim.leaveReason = `Gave up waiting for an elevator on ${floorLabel(sim.pos.floor)}.`;
  log(world, sim.leaveReason, 'warn', { simId: sim.id });
}

/** Workers and residents hold a lease. Guests, shoppers, diners, staff and VIPs do not. */
function isTenant(sim: Sim): boolean {
  return sim.homeRoomId !== null && (sim.kind === 'worker' || sim.kind === 'resident');
}

// ---------------------------------------------------------------------------
// 5. Leaving: everyone finds the nearest entrance on the way out
// ---------------------------------------------------------------------------

function runLeaving(world: World): void {
  for (const sim of [...world.sims.values()]) {
    if (sim.state !== 'leaving') continue;
    sim.exiting = true; // evaluation.ts sets the state only
    if (sim.route.length > 0) continue;
    if (sim.inRoomId !== null) departRoom(world, sim);
    const exit = nearestEntrance(world, sim.pos);
    if (!exit) {
      finishLeave(world, sim);
      continue;
    }
    if (sim.pos.floor === exit.floor && sim.pos.x === exit.x) {
      finishLeave(world, sim);
      continue;
    }
    const legs = findRoute(world, sim.pos, exit);
    if (!legs || legs.length === 0) {
      finishLeave(world, sim);
      continue;
    }
    sim.route = withoutStandingRides(legs);
  }
}

function finishLeave(world: World, sim: Sim): void {
  if (sim.inRoomId !== null) departRoom(world, sim);
  const home = sim.homeRoomId !== null ? world.rooms.get(sim.homeRoomId) : undefined;
  if (home && home.tenants.includes(sim.id)) {
    home.tenants = home.tenants.filter((id) => id !== sim.id);
    if (home.tenants.length === 0 && (home.kind === 'office' || home.kind === 'condo')) home.vacant = true;
  }
  const car = sim.inCarId !== null ? carById(world, sim.inCarId) : undefined;
  if (car) car.passengers = car.passengers.filter((id) => id !== sim.id);
  sim.inCarId = null;
  sim.state = 'gone';
  delete sim.exiting;
  removeSim(world, sim.id);
}

function carById(world: World, carId: Id) {
  for (const shaft of world.shafts.values()) {
    for (const car of shaft.cars) if (car.id === carId) return car;
  }
  return undefined;
}

/** Nobody idles outside the tower: a sim out there is either a tenant waiting for tomorrow or finished. */
function retireOutsideSims(world: World): void {
  for (const sim of [...world.sims.values()]) {
    if (sim.state !== 'outside') continue;
    const homeGone = sim.homeRoomId !== null && !world.rooms.get(sim.homeRoomId);
    const noPlanLeft = sim.homeRoomId === null && sim.nextScheduleIndex >= sim.schedule.length;
    if (sim.exiting || homeGone || noPlanLeft) finishLeave(world, sim);
  }
}

// ---------------------------------------------------------------------------
// 6. Housekeeping: staff walk the service elevators and clean dirty rooms
// ---------------------------------------------------------------------------

function runHousekeeping(world: World, clock: Clock): void {
  const offices = roomsOfKind(world, 'housekeeping');
  if (offices.length === 0) return;
  for (const office of offices) staffUpOffice(world, office);
  if (clock.minuteOfDay < SCHEDULES.housekeeping.start || clock.minuteOfDay > HOUSEKEEPING_END_MINUTE) return;
  const dirty = dirtyHotelRooms(world);
  if (dirty.length === 0) return;
  const claimed = claimedRoomIds(world);
  const wanted = Math.ceil(dirty.length / SCHEDULES.housekeeping.roomsPerKeeper);
  let sent = 0;
  for (const office of offices) {
    for (const id of office.tenants) {
      if (sent >= wanted) return;
      const keeper = world.sims.get(id);
      if (!keeper || keeper.kind !== 'staff') continue;
      if (keeper.state !== 'inRoom' || keeper.inRoomId !== office.id) continue;
      const room = dirty.find((r) => !claimed.has(r.id));
      if (!room) return;
      if (!assignCleaning(world, keeper, room)) continue;
      claimed.add(room.id);
      sent += 1;
    }
  }
}

function staffUpOffice(world: World, office: Room): void {
  while (office.tenants.length < ROOMS.housekeeping.capacity) {
    const keeper = newSim(world, 'staff', { floor: office.floor, x: roomCenter(office) }, office.id, []);
    keeper.state = 'inRoom';
    keeper.inRoomId = office.id;
    office.occupancy += 1;
    office.tenants.push(keeper.id);
  }
}

function dirtyHotelRooms(world: World): Room[] {
  const out: Room[] = [];
  for (const room of world.rooms.values()) {
    if (HOTEL_KINDS.has(room.kind) && room.dirty && !room.onFire) out.push(room);
  }
  return out;
}

/** Rooms a keeper is already walking to or standing in. */
function claimedRoomIds(world: World): Set<Id> {
  const claimed = new Set<Id>();
  for (const sim of world.sims.values()) {
    if (sim.kind !== 'staff') continue;
    if (sim.inRoomId !== null) claimed.add(sim.inRoomId);
    for (const leg of sim.route) if (leg.kind === 'enter') claimed.add(leg.roomId);
  }
  return claimed;
}

function assignCleaning(world: World, keeper: Sim, room: Room): boolean {
  const legs = findRoute(world, keeper.pos, { floor: room.floor, x: roomCenter(room) }, { staff: true });
  if (!legs) return false;
  departRoom(world, keeper);
  keeper.route = [...withoutStandingRides(legs), { kind: 'enter', roomId: room.id }];
  keeper.state = 'walking';
  return true;
}

function finishCleaning(world: World, keeper: Sim): void {
  const room = keeper.inRoomId !== null ? world.rooms.get(keeper.inRoomId) : undefined;
  if (room && HOTEL_KINDS.has(room.kind)) {
    room.dirty = false;
    room.dirtySinceMinute = null;
    log(world, `Housekeeping cleaned a hotel room on ${floorLabel(room.floor)}.`, 'info', { roomId: room.id });
  }
  const office = keeper.homeRoomId !== null ? world.rooms.get(keeper.homeRoomId) : undefined;
  if (!office) {
    keeper.stayUntil = null;
    return;
  }
  const legs = findRoute(world, keeper.pos, { floor: office.floor, x: roomCenter(office) }, { staff: true });
  if (!legs) {
    keeper.stayUntil = null;
    return;
  }
  departRoom(world, keeper);
  keeper.route = [...withoutStandingRides(legs), { kind: 'enter', roomId: office.id }];
  keeper.state = 'walking';
}

// ---------------------------------------------------------------------------
// Spawning and small shared helpers
// ---------------------------------------------------------------------------

function newSim(world: World, kind: SimKind, pos: { floor: number; x: number }, homeRoomId: Id | null, schedule: ScheduleEntry[]): Sim {
  const sim: Sim = {
    id: allocId(world),
    kind,
    homeRoomId,
    pos: { floor: pos.floor, x: pos.x },
    inCarId: null,
    inRoomId: null,
    route: [],
    state: 'outside',
    stress: 0,
    waitStart: null,
    schedule,
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
  };
  addSim(world, sim);
  return sim;
}

function spawnWorker(world: World, office: Room, clock: Clock): Sim {
  const rule = SCHEDULES.worker;
  const arriveFrom = Math.max(rule.arriveStart, clock.minuteOfDay);
  const arrive = world.rng.int(arriveFrom, rule.arriveEnd);
  const leave = world.rng.int(rule.leaveStart, rule.leaveEnd);
  const days: ScheduleEntry['days'] = world.rng.next() < rule.weekendChance ? ['weekday', 'weekend'] : ['weekday'];
  const schedule: ScheduleEntry[] = [
    { minuteOfDay: arrive, days, goal: { kind: 'room', roomId: office.id }, stayMinutes: 0 },
  ];
  if (world.rng.next() < rule.lunchChance) {
    const lunchOut = world.rng.int(rule.lunchStart, rule.lunchEnd - SCHEDULES.diner.visitMinutes / 2);
    schedule.push({ minuteOfDay: lunchOut, days: ['weekday'], goal: { kind: 'roomKind', roomKind: 'fastFood' }, stayMinutes: 30 });
    schedule.push({ minuteOfDay: rule.lunchEnd, days: ['weekday'], goal: { kind: 'room', roomId: office.id }, stayMinutes: 0 });
  }
  schedule.push({ minuteOfDay: leave, days, goal: { kind: 'exit' }, stayMinutes: 0 });
  schedule.sort((a, b) => a.minuteOfDay - b.minuteOfDay);
  const sim = newSim(world, 'worker', entranceFor(world, office.x), office.id, schedule);
  return sim;
}

function spawnResident(world: World, condo: Room): Sim {
  const rule = SCHEDULES.resident;
  const out = world.rng.int(rule.leaveStart, rule.leaveEnd);
  const back = world.rng.int(rule.returnStart, rule.returnEnd);
  const days: ScheduleEntry['days'] = ['weekday', 'weekend'];
  const schedule: ScheduleEntry[] = [
    { minuteOfDay: out, days: ['weekday'], goal: { kind: 'exit' }, stayMinutes: 0 },
    { minuteOfDay: back, days, goal: { kind: 'room', roomId: condo.id }, stayMinutes: 0 },
  ];
  if (world.rng.next() < rule.eveningOutChance) {
    schedule.push({
      minuteOfDay: world.rng.int(SCHEDULES.diner.dinnerStart, SCHEDULES.diner.dinnerEnd),
      days,
      goal: { kind: 'roomKind', roomKind: 'restaurant' },
      stayMinutes: SCHEDULES.diner.visitMinutes,
    });
    schedule.push({ minuteOfDay: SCHEDULES.nightStart, days, goal: { kind: 'room', roomId: condo.id }, stayMinutes: 0 });
  }
  schedule.sort((a, b) => a.minuteOfDay - b.minuteOfDay);
  const sim = newSim(world, 'resident', { floor: condo.floor, x: roomCenter(condo) }, condo.id, schedule);
  sim.state = 'inRoom';
  sim.inRoomId = condo.id;
  sim.nextScheduleIndex = schedule.length;
  condo.occupancy += 1;
  return sim;
}

function spawnGuest(world: World, room: Room, checkIn: number, checkOut: number): Sim {
  const schedule: ScheduleEntry[] = [
    { minuteOfDay: checkOut, days: ['weekday', 'weekend'], goal: { kind: 'exit' }, stayMinutes: 0 },
    { minuteOfDay: checkIn, days: ['weekday', 'weekend'], goal: { kind: 'room', roomId: room.id }, stayMinutes: 0 },
  ];
  const sim = newSim(world, 'guest', entranceFor(world, room.x), room.id, schedule);
  sim.nextScheduleIndex = 1; // tonight starts with the check in, not this morning's check out
  return sim;
}

function spawnVisitor(world: World, room: Room, kind: SimKind, stayMinutes: number, clock: Clock): Sim {
  const schedule: ScheduleEntry[] = [
    {
      minuteOfDay: clock.minuteOfDay,
      days: ['weekday', 'weekend'],
      goal: { kind: 'room', roomId: room.id },
      stayMinutes,
    },
  ];
  const sim = newSim(world, kind, entranceFor(world, room.x), null, schedule);
  sim.wallet = world.rng.int(500, 8000);
  return sim;
}

function entranceFor(world: World, x: number): { floor: number; x: number } {
  const exit = nearestEntrance(world, { floor: 1, x });
  return exit ? { floor: exit.floor, x: exit.x } : { floor: 1, x };
}

function nearestEntrance(world: World, from: { floor: number; x: number }): { floor: number; x: number } | null {
  const doors = entrances(world);
  let best: { floor: number; x: number } | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const door of doors) {
    const cost = Math.abs(door.floor - from.floor) * FLOOR_PREFERENCE_TILES + Math.abs(door.x - from.x);
    if (cost < bestCost) {
      bestCost = cost;
      best = door;
    }
  }
  return best;
}

function roomCenter(room: Room): number {
  return room.x + Math.floor(room.width / 2);
}

function floorLabel(floor: number): string {
  return floor < 0 ? `floor B${-floor}` : `floor ${floor}`;
}
