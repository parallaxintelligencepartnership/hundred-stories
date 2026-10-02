/**
 * People: who arrives, where they go, how long they wait, and when they give up.
 *
 * Reads top to bottom in six parts: intake, schedules, movement, stress, leaving,
 * housekeeping. Every number comes from rules.ts and every random draw comes from
 * world.rng, so a seed plus a command list always replays the same day.
 */

import { callClassFor, hallCallPending, letOffAtNextStop, requestHallCallFor } from './elevators';
import { recordCondoSale, recordHotelNight, recordPartyEvent, recordVisit } from './economy';
import { ensureRouting, entrances, findRoute, isReachableFromLobby, routingStamp } from './routing';
import { ECONOMY, ROOMS, SCHEDULES, STORY, STRESS } from './rules';
import { collectorLostRoute, inWasteBacklog, runCollectors } from './recycling';
import { guardLostRoute, runGuards } from './security';
import { isFollowed, recordBeat, recordSimBeat, type StoryBeat, type StoryState } from './story';
import { clockOf, floorDistance, riderClassOf } from './types';
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
import { addSim, allocId, LONG_WAIT_MINUTES, log, recordLongWait, removeSim, roomsOfKind, setOccupancy } from './world';

/** Tiles a sim covers in one minute on foot. */
export const WALK_TILES_PER_MINUTE = 5;

/**
 * How this sim asks routing for a way: service shafts for staff, and the rider class, so a
 * trip prefers the cars that carry this rider as their own and plans on a car kept for
 * somebody else only when that is the best or only way (routing.ts LEFTOVER_RIDE_COST).
 */
function routeOpts(sim: Sim): { staff: boolean; riderClass: ReturnType<typeof riderClassOf> } {
  return routeOptsFor(sim.kind);
}

function routeOptsFor(kind: SimKind): { staff: boolean; riderClass: ReturnType<typeof riderClassOf> } {
  // A housekeeper works in hotel rooms, so it plans on the cars hotel guests may use
  // (routing.ts graphKeyOf); guards and collectors stay `other`, which routing reads as every car.
  if (kind === 'staff') return { staff: true, riderClass: 'hotel' };
  return { staff: kind === 'guard' || kind === 'collector', riderClass: riderClassOf(kind) };
}

// Local rules: rules.ts has no entry for these, so they live here and are marked as our call.
/** A waiting sim re-registers its hall call this often if the call is no longer pending. */
export const HALL_CALL_RETRY_MINUTES = 6;
/** After this many silent retries the sim stops trusting the shaft and asks routing again. */
export const RETRIES_BEFORE_REROUTE = 3;
/** Housekeepers stop taking new rooms after this minute of day. */
export const HOUSEKEEPING_END_MINUTE = 20 * 60;
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
const TRANSIENT_KINDS = new Set<SimKind>(['shopper', 'diner', 'visitor', 'guest', 'vip', 'thief']);

/**
 * Guards, collectors and the thief are moved by their own plans (security.ts, recycling.ts,
 * events.ts): a route that ends leaves them standing where it ended, and waiting never makes
 * them give up.
 */
function directedKind(sim: Sim): boolean {
  return sim.kind === 'guard' || sim.kind === 'collector' || sim.kind === 'thief';
}

/**
 * The people a fire keeps out of the tower and moves out of a burning room. Guards, staff,
 * collectors, the VIP and the thief run on their own plans and are left to them (events.ts
 * holds the VIP's and the thief's way in until the fire is out).
 */
const FIRE_HELD_KINDS = new Set<SimKind>(['worker', 'resident', 'guest', 'shopper', 'diner', 'visitor']);

/** While any fire burns, nobody new comes in from the street. */
export function fireBurning(world: World): boolean {
  return world.events.some((e) => e.kind === 'fire');
}

/**
 * Once an hour every room's occupancy is set to the people really inside it (guards and
 * collectors never count). Nothing should ever leave the two apart; this heals a tower that
 * already carries a phantom from an older build or from a room removed elsewhere.
 */
export function recountOccupancy(world: World): void {
  const inside = new Map<Id, number>();
  for (const sim of world.sims.values()) {
    if (sim.inRoomId === null || sim.kind === 'guard' || sim.kind === 'collector') continue;
    inside.set(sim.inRoomId, (inside.get(sim.inRoomId) ?? 0) + 1);
  }
  for (const room of world.rooms.values()) {
    const count = inside.get(room.id) ?? 0;
    if (room.occupancy !== count) setOccupancy(world, room, count);
  }
}

export function stressBand(stress: number): StressBand {
  if (stress >= STRESS.red) return 'red';
  if (stress >= STRESS.pink) return 'pink';
  return 'calm';
}

export function tickPeople(world: World): void {
  if (world.gameOver) return;
  const clock = clockOf(world.time.minute);
  ensureRouting(world);
  if (clock.minuteOfDay % 60 === 0) recountOccupancy(world);
  runIntake(world, clock);
  runSchedules(world, clock);
  runHousekeeping(world, clock);
  runGuards(world);
  runCollectors(world);
  runLeaving(world);
  moveSims(world);
  retireOutsideSims(world);
  updateStress(world);
}

// ---------------------------------------------------------------------------
// 1. Intake: who joins the tower today
// ---------------------------------------------------------------------------

function runIntake(world: World, clock: Clock): void {
  // Workers and hotel guests are created outside and wait there (runSchedules holds them), so
  // their leases and bookings still happen. Owners who would move straight in and walk-in
  // crowds are simply not created while a fire burns.
  const burning = fireBurning(world);
  fillVacantOffices(world, clock);
  if (!burning) sellVacantCondos(world, clock);
  spawnHotelGuests(world, clock);
  if (burning) return;
  spawnCommerceVisitors(world, clock);
  spawnShowAudiences(world, clock);
}

/** A reachable vacant office takes a full staff on a weekday morning. */
function fillVacantOffices(world: World, clock: Clock): void {
  const rule = SCHEDULES.worker;
  if (clock.isWeekend) return;
  if (clock.minuteOfDay < rule.arriveStart || clock.minuteOfDay > rule.arriveEnd) return;
  // By id, so the draws below never depend on the order the rooms map was filled in.
  const offices = roomsOfKind(world, 'office').sort((a, b) => a.id - b.id);
  for (const room of offices) {
    if (!room.vacant || room.tenants.length > 0 || room.onFire) continue;
    if (!reachableFor(world, room)) continue;
    room.vacant = false;
    // The company's quitting time, drawn once at the lease. It lives on in its workers'
    // saved schedules, so a loaded tower needs no field for it.
    const quit = world.rng.int(rule.leaveStart + rule.quitJitterMinutes, rule.leaveEnd - rule.quitJitterMinutes);
    for (let i = 0; i < ROOMS.office.capacity; i++) {
      const sim = spawnWorker(world, room, clock, quit);
      room.tenants.push(sim.id);
    }
    log(world, `An office on ${floorLabel(room.floor)} was rented to a new tenant.`, 'info', { roomId: room.id });
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
    if (!reachableFor(world, room)) continue;
    recordCondoSale(world, room);
    room.vacant = false;
    for (let i = 0; i < ROOMS.condo.capacity; i++) {
      const sim = spawnResident(world, room);
      room.tenants.push(sim.id);
    }
    log(world, `A condo on ${floorLabel(room.floor)} was sold to a new owner.`, 'info', { roomId: room.id });
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
    if (!reachableFor(world, room)) continue;
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
    if (!reachableFor(world, room)) continue;
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
    if (room.onFire || !reachableFor(world, room)) continue;
    const seats = ROOMS[room.kind].capacity;
    const weekend = clock.isWeekend ? SCHEDULES.shopper.weekendMultiplier : 1;
    const fill = Math.min(1, (SHOW_FILL_MIN + world.rng.next() * (1 - SHOW_FILL_MIN)) * weekend);
    const audience = Math.max(0, Math.min(seats - room.occupancy, Math.round(seats * fill)));
    for (let i = 0; i < audience; i++) spawnVisitor(world, room, 'visitor', stay, clock);
    // The party is paid here, once, with its crowd booked; the guests' visits pay nothing more.
    if (room.kind === 'partyHall' && audience > 0) recordPartyEvent(world);
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

/**
 * Can the people this room is for get to it from the ground lobby. A car's rider setting
 * gives its own riders priority but still carries everyone else when it is free, so every
 * car joins the same floors for every rider class and the class blind answer is the answer.
 */
function reachableFor(world: World, room: Room): boolean {
  return isReachableFromLobby(world, room.floor, room.x);
}

// ---------------------------------------------------------------------------
// 2. Schedules: turning the day plan into routes
// ---------------------------------------------------------------------------

function runSchedules(world: World, clock: Clock): void {
  const burning = fireBurning(world);
  for (const sim of [...world.sims.values()]) {
    if (sim.state === 'gone' || sim.state === 'leaving') continue;
    if (clock.minuteOfDay === 0 && sim.homeRoomId !== null) {
      sim.nextScheduleIndex = 0;
      sim.leaveReason = null; // a new day, and stress starts fading again
    }
    if (burning && FIRE_HELD_KINDS.has(sim.kind)) {
      // Out of a burning room, toward the street; and nobody out there comes in until it is out.
      if (sim.state === 'inRoom' && sim.inRoomId !== null && world.rooms.get(sim.inRoomId)?.onFire) {
        leaveTower(world, sim);
        continue;
      }
      if (sim.state === 'outside') continue;
    }
    // A keeper in a hotel room with no end time is one an older save parked there: due now.
    if (sim.state === 'inRoom' && (sim.stayUntil !== null ? world.time.minute >= sim.stayUntil : parkedKeeper(world, sim))) {
      onStayEnded(world, sim, clock);
      continue;
    }
    if (sim.state !== 'inRoom' && sim.state !== 'outside') continue;
    dispatchDueEntries(world, sim, clock);
  }
}

function parkedKeeper(world: World, sim: Sim): boolean {
  if (sim.kind !== 'staff' || sim.inRoomId === null) return false;
  const room = world.rooms.get(sim.inRoomId);
  return room !== undefined && HOTEL_KINDS.has(room.kind);
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
  if (!room || room.onFire) return false;
  if (sim.inRoomId === room.id) return true;
  const target = { floor: room.floor, x: roomCenter(room) };
  const legs = findRoute(world, sim.pos, target, routeOpts(sim));
  if (!legs) {
    // A tenant with no way at all to its own office or condo cannot keep the lease: the
    // cars that reach it carry somebody else, or the floor lost its last way up.
    if (isTenant(sim) && room.id === sim.homeRoomId) {
      endLeaseWithNoWayIn(world, room);
      return true;
    }
    return false;
  }
  if (sim.inRoomId !== null) departRoom(world, sim);
  sim.route = [...withoutStandingRides(legs), { kind: 'enter', roomId: room.id }];
  sim.state = 'walking';
  sim.waitStart = null;
  delete sim.firstWaitStart;
  markTripStart(world, sim);
  return true;
}

/**
 * The VIP walks in from the ground lobby and heads for the suite by the normal routing and
 * elevator rules. False when no route exists; the caller (events.ts) ends the visit then.
 */
export function sendVipToSuite(world: World, sim: Sim, suite: Room): boolean {
  ensureRouting(world);
  const door = entrances(world).find((p) => p.floor === 1);
  if (door) sim.pos = { floor: door.floor, x: door.x };
  const legs = findRoute(world, sim.pos, { floor: suite.floor, x: roomCenter(suite) }, routeOpts(sim));
  if (!legs) return false;
  sim.route = [...withoutStandingRides(legs), { kind: 'enter', roomId: suite.id }];
  sim.state = 'walking';
  sim.waitStart = null;
  delete sim.firstWaitStart;
  markTripStart(world, sim);
  return true;
}

/**
 * The thief walks in from the ground lobby to the middle of the target room by the normal
 * routing and elevator rules. No enter leg: the thief never becomes a customer. False when
 * there is no way there.
 */
export function sendThiefTo(world: World, sim: Sim, target: Room): boolean {
  ensureRouting(world);
  const legs = findRoute(world, sim.pos, { floor: target.floor, x: roomCenter(target) }, routeOpts(sim));
  if (!legs) return false;
  sim.route = withoutStandingRides(legs);
  sim.state = 'walking';
  sim.waitStart = null;
  delete sim.firstWaitStart;
  return true;
}

/** The thief heads out through the ground lobby and is gone on reaching it. */
export function sendThiefOut(world: World, sim: Sim): void {
  ensureRouting(world);
  sim.exiting = true;
  sim.waitStart = null;
  delete sim.firstWaitStart;
  const door = entrances(world).find((p) => p.floor === 1);
  const legs = door ? findRoute(world, sim.pos, door, routeOpts(sim)) : null;
  sim.state = 'leaving';
  sim.route = legs ? withoutStandingRides(legs) : [];
}

/** The tile a trip to this room aims for: its middle. */
export function roomMiddle(room: Room): number {
  return roomCenter(room);
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
  // The nearest door first, then the others: a metro no car reaches yet is not the way out.
  const way = routeToAnEntrance(world, sim);
  if (!way || way.legs.length === 0) {
    sim.state = 'outside';
    sim.pos = { floor: exit.floor, x: exit.x };
    sim.route = [];
    return;
  }
  sim.route = withoutStandingRides(way.legs);
  sim.state = 'walking';
  markTripStart(world, sim);
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
        routeLost(world, sim);
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
      if (!world.rooms.has(leg.roomId)) {
        // The stairs were demolished on the way: nobody climbs what is gone (as a lost shaft).
        routeLost(world, sim);
        return;
      }
      climbStairs(world, sim, leg);
      budget = 0;
    } else {
      sim.route.shift();
      const room = world.rooms.get(leg.roomId);
      if (room) enterRoom(world, sim, room);
      else if (sim.kind === 'staff' && !sim.exiting) keeperLostWay(world, sim); // the room it was to clean is gone
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

/**
 * The shaft or stairs the next leg needs is gone: guards and collectors on duty ask their
 * own planners again, a housekeeper heads back to work or out (keeperLostWay); anyone else
 * heads for the street. A wait on the lost shaft ends here.
 */
function routeLost(world: World, sim: Sim): void {
  sim.waitStart = null;
  delete sim.firstWaitStart;
  if (sim.kind === 'guard' && !sim.exiting) guardLostRoute(sim);
  else if (sim.kind === 'collector' && !sim.exiting) collectorLostRoute(sim);
  else if (sim.kind === 'staff' && !sim.exiting) keeperLostWay(world, sim);
  else leaveTower(world, sim);
}

/**
 * A housekeeper whose way was demolished under it never waits outside for good: the street
 * is no place to work from and the office would count it forever. It walks back to the
 * housekeeping office when a way there exists (runHousekeeping sends it out again, and the
 * room it was heading for is free for any keeper), else it leaves the tower by the normal
 * leaving path, which takes it off the office roll so the office hires a replacement.
 */
function keeperLostWay(world: World, keeper: Sim): void {
  const office = keeper.homeRoomId !== null ? world.rooms.get(keeper.homeRoomId) : undefined;
  const legs = office ? findRoute(world, keeper.pos, { floor: office.floor, x: roomCenter(office) }, routeOpts(keeper)) : null;
  if (office && legs) {
    keeper.route = [...withoutStandingRides(legs), { kind: 'enter', roomId: office.id }];
    keeper.state = 'walking';
    return;
  }
  keeperLeaves(world, keeper);
}

/** A housekeeper with no way back to work leaves by the normal leaving path (runLeaving). */
function keeperLeaves(world: World, keeper: Sim): void {
  log(world, `A housekeeper on ${floorLabel(keeper.pos.floor)} had no way back to housekeeping and left the tower.`, 'warn', {
    simId: keeper.id,
  });
  keeper.exiting = true;
  keeper.state = 'leaving';
  keeper.route = [];
}

function beginWait(world: World, sim: Sim, leg: Extract<Leg, { kind: 'ride' }>, shaft: Shaft): void {
  sim.state = 'waiting';
  if (sim.waitStart === null) {
    sim.waitStart = world.time.minute;
    requestHallCallFor(world, shaft, sim.pos.floor, leg.toFloor, sim.kind);
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
  const floors = floorDistance(leg.toFloor, sim.pos.floor);
  sim.stress = Math.min(STRESS.giveUp, sim.stress + STRESS.perStairFloor * floors);
  const stairs = world.rooms.get(leg.roomId);
  sim.pos = { floor: leg.toFloor, x: stairs ? roomCenter(stairs) : sim.pos.x };
  sim.route.shift();
  delete sim.firstWaitStart; // a rerouted wait that took the stairs never boarded
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
  // The room caught fire while they were on the way: turn round for the street.
  if (room.onFire && FIRE_HELD_KINDS.has(sim.kind)) {
    leaveTower(world, sim);
    return;
  }
  finishTrip(world, sim, room.id);
  sim.inRoomId = room.id;
  sim.inCarId = null;
  sim.state = 'inRoom';
  sim.pos = { floor: room.floor, x: roomCenter(room) };
  sim.waitStart = null;
  setOccupancy(world, room, room.occupancy + 1);
  const stay = stayMinutesFor(sim, room);
  sim.stayUntil = stay > 0 ? world.time.minute + stay : null;
  if (COMMERCE_KINDS.has(room.kind)) recordVisit(world, room);
}

/** How long this sim stays: a cleaning shift, the plan it is running, or no set time. */
function stayMinutesFor(sim: Sim, room: Room): number {
  if (sim.kind === 'staff') return HOTEL_KINDS.has(room.kind) && needsCleaning(room) ? SCHEDULES.housekeeping.minutesPerRoom : 0;
  const entry = sim.schedule[sim.nextScheduleIndex - 1];
  return entry ? entry.stayMinutes : 0;
}

/** A route that ended without an enter leg finished at an entrance. */
function arriveWithoutRoom(world: World, sim: Sim): void {
  if (sim.exiting || sim.state === 'leaving') {
    // Let off mid tower (sendAway): runLeaving walks it to the street from here.
    if (sim.state !== 'leaving' && !atEntrance(world, sim.pos)) {
      sim.state = 'leaving';
      return;
    }
    finishLeave(world, sim);
    return;
  }
  if (sim.state !== 'walking') return;
  if (directedKind(sim)) return; // standing where the plan put them; the plan picks the next move
  finishTrip(world, sim, undefined);
  // The route already carried this sim to the door, so leave it standing where it stopped.
  sim.state = 'outside';
  sim.waitStart = null;
}

function departRoom(world: World, sim: Sim): void {
  const room = sim.inRoomId !== null ? world.rooms.get(sim.inRoomId) : undefined;
  // A guard in the office or a collector in the center never counted toward its occupancy.
  if (room && sim.kind !== 'guard' && sim.kind !== 'collector') {
    setOccupancy(world, room, Math.max(0, room.occupancy - 1));
    if (sim.kind === 'guest' && HOTEL_KINDS.has(room.kind) && room.tenants.includes(sim.id)) {
      checkOutOfHotel(world, sim, room);
    }
  }
  sim.inRoomId = null;
  sim.stayUntil = null;
}

function checkOutOfHotel(world: World, sim: Sim, room: Room): void {
  room.tenants = room.tenants.filter((id) => id !== sim.id);
  recordSimBeat(
    world.story,
    { code: 'room.vacated', minute: world.time.minute, simId: sim.id, roomId: room.id, value: sim.leaveReason !== null ? 1 : 0 },
    STORY.unfollowedBeatGapMinutes,
  );
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
  followOpenWaits(world);
  for (const sim of [...world.sims.values()]) {
    // A rerouted wait carries its first minute only on the walk to the next hall.
    if (sim.firstWaitStart !== undefined && sim.state !== 'waiting' && sim.state !== 'walking') delete sim.firstWaitStart;
    if (sim.state === 'waiting') {
      // The goals card's count of waits over five minutes: each counts once, the minute it passes.
      if (sim.waitStart !== null) {
        const waited = world.time.minute - sim.waitStart;
        if (waited === LONG_WAIT_MINUTES + 1) recordLongWait(world);
        if (waited === STORY.longWaitMinutes + 1) recordLongWaitBeat(world, sim, sim.waitStart);
      }
      sim.stress = Math.min(STRESS.giveUp, sim.stress + STRESS.perWaitingMinute);
      // A sim can abandon a trip once a day. On the way out, or on the way home after
      // giving up, there is nothing left to abandon: giving up again would clear the
      // route every minute and ask routing for a new one on the next, so a sim already
      // headed for the door waits for its car however cross it is.
      if (sim.stress >= STRESS.giveUp && !sim.exiting && sim.leaveReason === null && !directedKind(sim)) {
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
  const shaft = world.shafts.get(leg.shaftId);
  if (!shaft) {
    // Demolished while this sim stood at its doors: no car will ever come, and a sim on
    // the way out never gives up, so take the same path a walker who finds it gone takes.
    routeLost(world, sim);
    return;
  }
  const waited = world.time.minute - sim.waitStart;
  if (waited <= 0 || waited % HALL_CALL_RETRY_MINUTES !== 0) return;
  if (waited >= HALL_CALL_RETRY_MINUTES * RETRIES_BEFORE_REROUTE) {
    rerouteWaitingSim(world, sim);
    return;
  }
  if (!withinReach(sim, shaft)) return;
  const dir: 1 | -1 = leg.toFloor > sim.pos.floor ? 1 : -1;
  if (hallCallPending(shaft, sim.pos.floor, dir, callClassFor(shaft, sim.kind, sim.pos.floor, leg.toFloor))) return;
  requestHallCallFor(world, shaft, sim.pos.floor, leg.toFloor, sim.kind);
}

/** Three silent retries: the shaft is not serving this floor, so ask routing for another way. */
function rerouteWaitingSim(world: World, sim: Sim): void {
  const dest = routeDestination(world, sim);
  const legs = findRoute(world, sim.pos, dest.at, routeOpts(sim));
  if (!legs) {
    // On the way out there is no trip left to give up, so stress never ends this wait:
    // with no car or stairs out of this floor any more, the person goes (as runLeaving does).
    if (sim.exiting) {
      log(world, `Someone on ${floorLabel(sim.pos.floor)} found no way out and left the tower.`, 'warn', { simId: sim.id });
      finishLeave(world, sim);
    }
    return; // otherwise nothing better on offer: keep waiting and let stress decide
  }
  const enter: Leg[] = dest.roomId !== null ? [{ kind: 'enter', roomId: dest.roomId }] : [];
  sim.route = [...withoutStandingRides(legs), ...enter];
  sim.state = 'walking';
  // The next hall wait restarts the retry clock, but the wait itself goes on: keep its
  // first minute for stats.avgWaitMinutes (elevators.ts reads it at boarding).
  sim.firstWaitStart ??= sim.waitStart ?? world.time.minute;
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
  const dest = routeDestination(world, sim).roomId;
  const beat: StoryBeat & { simId: number } = {
    code: 'trip.gaveUp',
    minute: world.time.minute,
    simId: sim.id,
    value: sim.waitStart !== null ? world.time.minute - sim.waitStart : 0,
  };
  if (dest !== null) beat.roomId = dest;
  recordSimBeat(world.story, beat, STORY.unfollowedBeatGapMinutes);
  sim.stress = STRESS.giveUp;
  sim.route = [];
  sim.waitStart = null;
  delete sim.firstWaitStart; // a give-up never boarded, so it is not averaged
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

/** Every tenant of an office or condo nobody can get to moves out, and the room is back on offer. */
function endLeaseWithNoWayIn(world: World, room: Room): void {
  const who = room.kind === 'condo' ? 'its owners' : 'its tenants';
  const reason = `The ${ROOMS[room.kind].label.toLowerCase()} on ${floorLabel(room.floor)} had no way in, so ${who} moved out.`;
  let roomBeat = false;
  for (const id of room.tenants) {
    const sim = world.sims.get(id);
    if (!sim) continue;
    const followed = isFollowed(world.story, id);
    if (followed || !roomBeat) {
      recordBeat(world.story, { code: 'room.vacated', minute: world.time.minute, simId: id, roomId: room.id, value: 1 });
      if (!followed) roomBeat = true;
    }
    sim.homeRoomId = null;
    sendAway(world, sim, reason);
    world.stats.tenantsLeftReasons[reason] = (world.stats.tenantsLeftReasons[reason] ?? 0) + 1;
  }
  room.tenants = [];
  room.vacant = true;
  room.lowEvalSinceMinute = null;
  log(world, reason, 'warn', { roomId: room.id });
}

/**
 * Send a sim out of the tower for good because of something that happened to it (its home
 * burned, was bombed or can no longer be reached, or a visit ended). It leaves whatever room
 * it sits in, which gives that room its seat back. A rider stays aboard to the car's next
 * stop and walks out from there; anyone else heads for the street now.
 */
export function sendAway(world: World, sim: Sim, reason: string): void {
  sim.leaveReason = reason;
  if (sim.inRoomId !== null) {
    const room = world.rooms.get(sim.inRoomId);
    // A guard in the office or a collector in the center never counted toward its occupancy.
    if (room && sim.kind !== 'guard' && sim.kind !== 'collector') setOccupancy(world, room, Math.max(0, room.occupancy - 1));
    sim.inRoomId = null;
  }
  if (sim.inCarId !== null && letOffAtNextStop(world, sim)) {
    sim.exiting = true;
    return;
  }
  sim.inCarId = null;
  sim.state = 'leaving';
  sim.route = [];
  // A wait it was in is over; the walk out calls its own car when it reaches one.
  sim.waitStart = null;
  delete sim.firstWaitStart;
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
    const way = routeToAnEntrance(world, sim);
    if (!way || way.legs.length === 0) {
      finishLeave(world, sim);
      continue;
    }
    sim.route = withoutStandingRides(way.legs);
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
  if (clock.minuteOfDay === SCHEDULES.housekeeping.start) noteRoomsOutOfReach(world);
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
      const noRoute = roomsWithNoRouteFrom(world, keeper.pos.floor);
      // The first unclaimed room this keeper can get to: one it cannot reach never holds up the rest.
      let took = false;
      for (const room of dirty) {
        if (claimed.has(room.id) || noRoute.has(room.id)) continue;
        if (!assignCleaning(world, keeper, room)) {
          noRoute.add(room.id);
          continue;
        }
        claimed.add(room.id);
        sent += 1;
        took = true;
        break;
      }
      if (!took) break; // nothing left this office can reach; another office may
    }
  }
}

/**
 * The rooms a keeper starting on a floor has no route to, kept for as long as the routing graph
 * stands (routingStamp): whether a route exists turns on the graph and the two floors alone, so
 * a room asked once is not asked again every minute of the shift. Only a cache: no answer changes.
 */
const noRouteMemo = new WeakMap<World, { stamp: object; byFloor: Map<number, Set<Id>> }>();
function roomsWithNoRouteFrom(world: World, floor: number): Set<Id> {
  const stamp = routingStamp(world);
  let memo = noRouteMemo.get(world);
  if (!memo || memo.stamp !== stamp) {
    memo = { stamp, byFloor: new Map() };
    noRouteMemo.set(world, memo);
  }
  let rooms = memo.byFloor.get(floor);
  if (!rooms) memo.byFloor.set(floor, (rooms = new Set()));
  return rooms;
}

/**
 * The hotel rooms waiting for a clean that no housekeeping office has a route to, by id. Empty
 * when the tower has no housekeeping office: then no room is housekeeping's to reach. Reads the
 * world only (routing builds its cache on demand), for the UI and the shift's warn line.
 */
export function hotelRoomsHousekeepingCannotReach(world: World): Room[] {
  const offices = roomsOfKind(world, 'housekeeping');
  if (offices.length === 0) return [];
  const opts = routeOptsFor('staff');
  return dirtyHotelRooms(world)
    .filter((room) => !offices.some((office) => findRoute(world, { floor: office.floor, x: roomCenter(office) }, { floor: room.floor, x: roomCenter(room) }, opts)))
    .sort((a, b) => a.id - b.id);
}

/** At the start of the shift, one warn line naming the floors whose rooms housekeeping cannot reach. Stateless: only while there are some. */
function noteRoomsOutOfReach(world: World): void {
  const rooms = hotelRoomsHousekeepingCannotReach(world);
  const first = rooms[0];
  if (!first) return;
  const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b).map(floorLabel);
  const named = floors.length === 1 ? floors[0] : `${floors.slice(0, -1).join(', ')} and ${floors[floors.length - 1]}`;
  log(world, `Housekeeping could not reach the hotel rooms on ${named}.`, 'warn', { roomId: first.id });
}

function staffUpOffice(world: World, office: Room): void {
  while (office.tenants.length < ROOMS.housekeeping.capacity) {
    const keeper = newSim(world, 'staff', { floor: office.floor, x: roomCenter(office) }, office.id, []);
    keeper.state = 'inRoom';
    keeper.inRoomId = office.id;
    setOccupancy(world, office, office.occupancy + 1);
    office.tenants.push(keeper.id);
  }
}

export function dirtyHotelRooms(world: World): Room[] {
  const out: Room[] = [];
  for (const room of world.rooms.values()) {
    // A room held dirty by uncollected waste waits for the collectors, not housekeeping.
    if (HOTEL_KINDS.has(room.kind) && needsCleaning(room) && !room.onFire && !inWasteBacklog(room)) out.push(room);
  }
  return out;
}

/**
 * Dirty after a stay, or empty and crawling with cockroaches that spread in: an infested
 * room is never booked, so nobody would ever dirty it again, and only a clean clears it.
 */
function needsCleaning(room: Room): boolean {
  return room.dirty || (room.infested && room.tenants.length === 0);
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
  const legs = findRoute(world, keeper.pos, { floor: room.floor, x: roomCenter(room) }, routeOpts(keeper));
  if (!legs) return false;
  departRoom(world, keeper);
  keeper.route = [...withoutStandingRides(legs), { kind: 'enter', roomId: room.id }];
  keeper.state = 'walking';
  markTripStart(world, keeper);
  return true;
}

function finishCleaning(world: World, keeper: Sim): void {
  const room = keeper.inRoomId !== null ? world.rooms.get(keeper.inRoomId) : undefined;
  // Nothing left to clean on a keeper's retry for a way home (returnToHousekeeping).
  if (room && HOTEL_KINDS.has(room.kind) && (room.dirty || room.infested)) {
    room.dirty = false;
    room.dirtySinceMinute = null;
    log(world, `Housekeeping cleaned a hotel room on ${floorLabel(room.floor)}.`, 'info', { roomId: room.id });
    if (room.infested) {
      // The clean takes the cockroaches with it; the daily roll never sees this room dirty.
      room.infested = false;
      log(world, `The ${ROOMS[room.kind].label.toLowerCase()} on ${floorLabel(room.floor)} is clean again and the cockroaches are gone.`, 'info', {
        roomId: room.id,
      });
    }
  }
  returnToHousekeeping(world, keeper);
}

/**
 * A keeper done in a hotel room heads back to the office. With no way there (a car's rider
 * setting or a demolition took it) the keeper is never parked in the room: it asks again
 * every HALL_CALL_RETRY_MINUTES while housekeeping hours last, and goes back as soon as a
 * route exists again. Outside those hours, or with the office gone, it leaves the tower by
 * the path every leaver takes (runLeaving: the street if it can get there, else straight
 * out), and the office hires a replacement (staffUpOffice). No new state: the clock decides.
 */
function returnToHousekeeping(world: World, keeper: Sim): void {
  const office = keeper.homeRoomId !== null ? world.rooms.get(keeper.homeRoomId) : undefined;
  const legs = office ? findRoute(world, keeper.pos, { floor: office.floor, x: roomCenter(office) }, routeOpts(keeper)) : null;
  if (!office || !legs) {
    const minuteOfDay = clockOf(world.time.minute).minuteOfDay;
    const onShift = minuteOfDay >= SCHEDULES.housekeeping.start && minuteOfDay < HOUSEKEEPING_END_MINUTE;
    if (office && onShift) {
      keeper.stayUntil = world.time.minute + HALL_CALL_RETRY_MINUTES;
      return;
    }
    keeperLeaves(world, keeper);
    return;
  }
  departRoom(world, keeper);
  keeper.route = [...withoutStandingRides(legs), { kind: 'enter', roomId: office.id }];
  keeper.state = 'walking';
  markTripStart(world, keeper);
}

// ---------------------------------------------------------------------------
// 7. Story: beats written beside the moves above, never read back by the tick
// ---------------------------------------------------------------------------

/**
 * A long wait's beat keeps counting while the same wait goes on, so the chapter shows the
 * whole wait, not the minute it crossed the line. Keyed by the story, so a load starts empty;
 * holds only waits that were recorded, which the spacing in recordSimBeat keeps to a few.
 */
const openWaits = new WeakMap<StoryState, Map<Id, { beat: StoryBeat; waitStart: number }>>();

function recordLongWaitBeat(world: World, sim: Sim, waitStart: number): void {
  const beat: StoryBeat & { simId: number } = {
    code: 'wait.long',
    minute: world.time.minute,
    simId: sim.id,
    value: world.time.minute - waitStart,
  };
  const dest = routeDestination(world, sim).roomId;
  if (dest !== null) beat.roomId = dest;
  if (!recordSimBeat(world.story, beat, STORY.unfollowedBeatGapMinutes)) return;
  let open = openWaits.get(world.story);
  if (!open) openWaits.set(world.story, (open = new Map()));
  open.set(sim.id, { beat, waitStart });
}

/** Bring each recorded wait up to date, and let go of the ones that ended. */
function followOpenWaits(world: World): void {
  const open = openWaits.get(world.story);
  if (!open || open.size === 0) return;
  for (const [simId, entry] of open) {
    const sim = world.sims.get(simId);
    if (!sim || sim.state !== 'waiting' || sim.waitStart !== entry.waitStart) {
      open.delete(simId);
      continue;
    }
    entry.beat.value = world.time.minute - entry.waitStart;
  }
}

/** A followed sim starting a trip notes the minute, for the arrival beat. */
function markTripStart(world: World, sim: Sim): void {
  if (isFollowed(world.story, sim.id)) sim.storyTripStart = world.time.minute;
  else if (sim.storyTripStart !== undefined) delete sim.storyTripStart;
}

/** A trip ended where it was going: a followed sim records how long it took. */
function finishTrip(world: World, sim: Sim, roomId: Id | undefined): void {
  const start = sim.storyTripStart;
  if (start === undefined) return;
  delete sim.storyTripStart;
  if (!isFollowed(world.story, sim.id)) return;
  const beat: StoryBeat = { code: 'trip.arrived', minute: world.time.minute, simId: sim.id, value: world.time.minute - start };
  if (roomId !== undefined) beat.roomId = roomId;
  recordBeat(world.story, beat);
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

function spawnWorker(world: World, office: Room, clock: Clock, quit: number): Sim {
  const rule = SCHEDULES.worker;
  const arriveFrom = Math.max(rule.arriveStart, clock.minuteOfDay);
  const arrive = world.rng.int(arriveFrom, rule.arriveEnd);
  const leave = world.rng.int(quit - rule.quitJitterMinutes, quit + rule.quitJitterMinutes);
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
  const sim = newSim(world, 'worker', entranceFor(world, office, 'worker'), office.id, schedule);
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
  setOccupancy(world, condo, condo.occupancy + 1);
  return sim;
}

function spawnGuest(world: World, room: Room, checkIn: number, checkOut: number): Sim {
  const schedule: ScheduleEntry[] = [
    { minuteOfDay: checkOut, days: ['weekday', 'weekend'], goal: { kind: 'exit' }, stayMinutes: 0 },
    { minuteOfDay: checkIn, days: ['weekday', 'weekend'], goal: { kind: 'room', roomId: room.id }, stayMinutes: 0 },
  ];
  const sim = newSim(world, 'guest', entranceFor(world, room, 'guest'), room.id, schedule);
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
  const sim = newSim(world, kind, entranceFor(world, room, kind), null, schedule);
  sim.wallet = world.rng.int(500, 8000);
  return sim;
}

/**
 * Where someone headed for this room comes in: the nearest entrance they can ride from.
 * The ground doors are the ones the room was found reachable from, so they are taken on
 * trust; a metro counts only once a route for this person's class joins it to the room,
 * so a metro no car reaches yet is neither a way in nor, below, a way out.
 */
function entranceFor(world: World, room: Room, kind: SimKind): { floor: number; x: number } {
  const target = { floor: room.floor, x: roomCenter(room) };
  const doors = entrancesByCost(world, { floor: 1, x: room.x });
  for (const door of doors) {
    if (door.floor === 1 || findRoute(world, door, target, routeOptsFor(kind)) !== null) return door;
  }
  return doors[0] ?? { floor: 1, x: room.x };
}

function nearestEntrance(world: World, from: { floor: number; x: number }): { floor: number; x: number } | null {
  return entrancesByCost(world, from)[0] ?? null;
}

/** The entrances nearest first; equal costs keep the order entrances() gives them. */
function entrancesByCost(world: World, from: { floor: number; x: number }): { floor: number; x: number }[] {
  const cost = (door: { floor: number; x: number }) => Math.abs(door.floor - from.floor) * FLOOR_PREFERENCE_TILES + Math.abs(door.x - from.x);
  return entrances(world)
    .map((door, i) => ({ door, i, c: cost(door) }))
    .sort((a, b) => a.c - b.c || a.i - b.i)
    .map((e) => e.door);
}

/** A route from here to the nearest entrance this sim can reach, trying the others in turn. */
function routeToAnEntrance(world: World, sim: Sim): { door: { floor: number; x: number }; legs: Leg[] } | null {
  for (const door of entrancesByCost(world, sim.pos)) {
    const legs = findRoute(world, sim.pos, door, routeOpts(sim));
    if (legs) return { door, legs };
  }
  return null;
}

function atEntrance(world: World, pos: { floor: number; x: number }): boolean {
  return entrances(world).some((door) => door.floor === pos.floor && door.x === pos.x);
}

function roomCenter(room: Room): number {
  return room.x + Math.floor(room.width / 2);
}

function floorLabel(floor: number): string {
  return floor < 0 ? `floor B${-floor}` : `floor ${floor}`;
}
