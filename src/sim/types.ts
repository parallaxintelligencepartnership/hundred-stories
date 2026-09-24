// Hundred Stories: the simulation contract.
// Every sim module and the renderer build against these shapes. See docs/DESIGN.md.
// The sim is pure: nothing in src/sim may touch the DOM, Date, Math.random, or pixi.js.

import type { Rng } from './rng';
import type { StoryState } from './story';

export const TOWER_WIDTH = 375;
export const MAX_FLOOR = 100;
export const MIN_FLOOR = -10;

export type RoomKind =
  | 'lobby'
  | 'skyLobby'
  | 'stairs'
  | 'escalator'
  | 'office'
  | 'condo'
  | 'hotelSingle'
  | 'hotelTwin'
  | 'hotelSuite'
  | 'fastFood'
  | 'restaurant'
  | 'shop'
  | 'cinema'
  | 'partyHall'
  | 'medical'
  | 'security'
  | 'housekeeping'
  | 'parkingRamp'
  | 'parkingSpace'
  | 'recycling'
  | 'metro'
  | 'cathedral';

export type ShaftKind = 'standard' | 'express' | 'service';

export type SimKind =
  | 'worker'
  | 'resident'
  | 'guest'
  | 'shopper'
  | 'diner'
  | 'staff'
  | 'visitor'
  | 'vip'
  | 'guard' // a security guard: one of a security office's staff, on shift or off
  | 'collector' // a waste collector: one of a recycling center's two workers
  | 'thief'; // the shop thief: shown to the player as a visitor until the encounter is resolved

/** Who a car may carry when it is dedicated. Hotel guests, office staff, or anyone else. */
export type RiderClass = 'hotel' | 'office' | 'other';

/** Which class of rider a sim counts as. Pure: the kind is the whole answer. */
export function riderClassOf(kind: SimKind): RiderClass {
  if (kind === 'guest' || kind === 'vip') return 'hotel';
  if (kind === 'worker') return 'office';
  return 'other';
}

export type StressBand = 'calm' | 'pink' | 'red'; // calm sims draw black, like the original

export type Star = 1 | 2 | 3 | 4 | 5 | 6; // 6 is TOWER status

export type Id = number;

export interface Room {
  id: Id;
  kind: RoomKind;
  floor: number; // lowest floor the room occupies
  x: number; // leftmost tile
  width: number;
  height: number; // floors
  eval: number; // 0..1
  tenants: Id[]; // sims that live or work here
  occupancy: number; // people currently inside
  builtAtMinute: number;
  vacant: boolean; // office or condo with no tenant contract
  dirty: boolean; // hotel rooms only: needs housekeeping before it can be rented
  dirtySinceMinute?: number | null; // hotel rooms only: when it last became dirty, for the cockroach timer; survives saves
  infested: boolean; // hotel rooms only: cockroaches
  lowEvalSinceMinute: number | null; // when eval first dropped below the leave threshold
  onFire: boolean;
  rent: number; // percent of the standard rate; a discount lifts the tenants' evaluation, a premium lowers it
  /**
   * Waste (src/sim/recycling.ts). All optional and absent on a room that never held any, so a
   * tower without a recycling center saves and hashes as before. `waste`: units waiting, 0 to
   * WASTE.roomCap. `wasteDays`: consecutive 06:00 rolls at or above WASTE.backlogAt.
   * `wasteBacklogSince`: the minute the room entered backlog (its dirty flag is held set).
   * `wastePeak`: the most people inside since the last roll, which sizes the next load.
   * `wasteCollectedAt`: the minute a collector last emptied it.
   */
  waste?: number;
  wasteDays?: number;
  wasteBacklogSince?: number | null;
  wastePeak?: number;
  wasteCollectedAt?: number;
  /** Recycling centers only: units brought in since the last 06:00 roll, and floors a worker could not reach today. */
  wasteCollectedToday?: number;
  wasteUnreachable?: number[];
  /** Recycling centers only: how many collectors it staffs, set at each roll; absent means WASTE.workersPerCenter. */
  wasteWorkers?: number;
}

export interface Car {
  id: Id;
  shaftId: Id;
  y: number; // floor position, fractional while moving
  dir: -1 | 0 | 1;
  state: 'idle' | 'moving' | 'doorsOpen';
  doorTimer: number; // minutes left with doors open
  idleSince: number | null; // minute the car went idle
  passengers: Id[];
  calls: Set<number>; // destination floors requested by passengers
  serves: 'any' | 'hotel' | 'office'; // riders this car is dedicated to; 'any' carries everyone
  range: { lo: number; hi: number } | null; // floors this car works, null for the whole shaft
}

export interface Shaft {
  id: Id;
  kind: ShaftKind;
  x: number;
  width: number;
  floorMin: number;
  floorMax: number;
  stops: Set<number>; // floors this shaft serves; must be within [floorMin, floorMax]
  homeFloor: number;
  cars: Car[];
  hallCalls: Map<number, { up: Set<RiderClass>; down: Set<RiderClass> }>;
}

/**
 * The floors a car actually works, clamped into its shaft. A null range follows the
 * shaft, so a car with no range of its own grows with it.
 */
export function carRangeOf(shaft: Shaft, car: Car): { lo: number; hi: number } {
  if (!car.range) return { lo: shaft.floorMin, hi: shaft.floorMax };
  const lo = Math.min(Math.max(car.range.lo, shaft.floorMin), shaft.floorMax);
  const hi = Math.min(Math.max(car.range.hi, shaft.floorMin), shaft.floorMax);
  return { lo, hi: Math.max(lo, hi) };
}

/** Does this car work that floor? */
export function carCovers(shaft: Shaft, car: Car, floor: number): boolean {
  const { lo, hi } = carRangeOf(shaft, car);
  return floor >= lo && floor <= hi;
}

export type Leg =
  | { kind: 'walk'; toX: number }
  | { kind: 'ride'; shaftId: Id; fromFloor: number; toFloor: number }
  | { kind: 'stairs'; roomId: Id; toFloor: number }
  | { kind: 'enter'; roomId: Id };

export interface ScheduleEntry {
  minuteOfDay: number; // when to depart
  days: ('weekday' | 'weekend')[];
  goal: { kind: 'room'; roomId: Id } | { kind: 'roomKind'; roomKind: RoomKind } | { kind: 'exit' };
  stayMinutes: number; // how long to remain once arrived; 0 for exit
}

export interface Sim {
  id: Id;
  kind: SimKind;
  homeRoomId: Id | null; // the room this sim is a tenant of, if any
  pos: { floor: number; x: number };
  inCarId: Id | null;
  inRoomId: Id | null;
  route: Leg[];
  state: 'inRoom' | 'walking' | 'waiting' | 'riding' | 'leaving' | 'gone' | 'outside';
  stress: number; // 0..1
  waitStart: number | null;
  schedule: ScheduleEntry[];
  nextScheduleIndex: number;
  stayUntil: number | null; // minute to leave the current room
  wallet: number; // cents the sim will spend this visit
  leaveReason: string | null;
  exiting?: boolean; // durable flag: this sim is on its way out of the tower, whatever its transit state
  /**
   * Story only: the minute a followed sim's current trip began, for its trip.arrived beat.
   * Set for followed sims alone, never read by the tick, saved with the sim, left out of the hash.
   */
  storyTripStart?: number;
  /** Guards only: shift, patrol and response state (src/sim/security.ts). Saved and hashed with the sim. */
  guard?: GuardState;
  /** Collectors only: the round in hand (src/sim/recycling.ts). Saved and hashed with the sim. */
  collector?: CollectorState;
}

/**
 * What a collector is doing. `center`: in the recycling center. `toRoom`: walking to `roomId`
 * to collect. `collecting`: at `roomId` until `until`. `toCenter`: walking back with `load`.
 * `unloading`: in the center until `until`. `until` also paces a worker with nothing reachable.
 */
export interface CollectorState {
  task: 'center' | 'toRoom' | 'collecting' | 'toCenter' | 'unloading';
  roomId: Id | null;
  load: number;
  until: number | null;
}

/** A guard's response: the incident, the room it is in and where the guard is heading. */
export interface GuardResponse {
  kind: 'fire' | 'bomb' | 'theft';
  roomId: Id;
  floor: number;
  x: number;
}

/**
 * What a guard is doing. `office`: inside the security office. `return`: walking back to it.
 * `patrol`: walking to or pausing on `floor`, one of the patrol loop. `respond`: sent to an
 * incident, `routed` false until the guard has a route there (a guard dispatched mid ride
 * plans once off the car).
 */
export interface GuardState {
  shift: number; // index into SECURITY.shifts
  task: 'office' | 'return' | 'patrol' | 'respond';
  floor: number | null;
  pauseUntil: number | null;
  respond: GuardResponse | null;
  routed: boolean;
}

export type Command =
  | { kind: 'build'; room: RoomKind; floor: number; x: number }
  | { kind: 'demolish'; roomId: Id }
  | { kind: 'shaft.build'; shaft: ShaftKind; x: number; floorMin: number; floorMax: number }
  | { kind: 'shaft.demolish'; shaftId: Id }
  | { kind: 'shaft.extend'; shaftId: Id; floorMin: number; floorMax: number }
  | { kind: 'shaft.addCar'; shaftId: Id }
  | { kind: 'shaft.removeCar'; shaftId: Id }
  | { kind: 'shaft.setStop'; shaftId: Id; floor: number; stops: boolean }
  | { kind: 'shaft.setHome'; shaftId: Id; floor: number }
  | { kind: 'shaft.setCarServes'; shaftId: Id; carId: Id; serves: Car['serves'] }
  | { kind: 'shaft.setCarRange'; shaftId: Id; carId: Id; range: { lo: number; hi: number } | null }
  | { kind: 'room.setRent'; roomId: Id; rent: number }
  | { kind: 'bomb.pay' }
  | { kind: 'fire.callHelicopter' };

export type CommandKind = Command['kind'];

/** `code` tags a refusal the ui reacts to beyond showing the reason (today only the demo cap). */
export type CommandResult = { ok: true } | { ok: false; reason: string; code?: 'demoCap' };

export interface LogEntry {
  minute: number;
  text: string;
  level: 'info' | 'warn' | 'alert';
  roomId?: Id;
  simId?: Id;
}

/** The three things a VIP can care most about. Shown to the player; chosen from the identity hash. */
export type VipPreference = 'quick elevators' | 'a clean suite' | 'a quiet floor';

export type VipRating = 'poor' | 'fair' | 'good';

/**
 * Where a VIP visit stands: announced and waiting for tomorrow, on the way up from the
 * lobby, staying in the suite, or checked out and on the way out of the tower.
 */
export type VipPhase = 'notice' | 'route' | 'stay' | 'checkout';

export interface VipEvent {
  kind: 'vip';
  simId: Id;
  arrivesAt: number; // the minute the VIP walks into the ground lobby
  leavesAt: number; // the minute the stay ends; set again at check in
  score: number; // 0 poor, 0.5 fair, 1 good once rated
  suiteId: Id | null;
  phase: VipPhase;
  preference: VipPreference;
  longestWait: number; // minutes, the longest single elevator wait so far
  waitingSince: number | null; // the minute the current wait for a car began, null when not waiting
  checkInClean: boolean | null; // the suite's cleanliness at check in, null before it
  checkInEval: number | null; // the suite's rating at check in, null before it
  incident: boolean; // a fire or a bomb was active while the VIP was in the tower
}

/** The last VIP visit, kept after the event clears so the player can see why it rated as it did. */
export interface VipVisitRecord {
  simId: Id;
  minute: number;
  rating: VipRating;
  preference: VipPreference;
  longestWait: number;
  waitBand: VipRating;
  suiteClean: boolean | null; // null when the VIP never reached the suite
  suiteBand: VipRating;
  incident: boolean;
  reason: string | null; // why the visit ended early, null for a full stay
}

/**
 * A shop theft. `notice`: rolled at 06:00, the thief walks in at `enterAt`. `approach`: on the
 * way to the target. `acting`: at the target until `actUntil`, a guard (`guardId`) on the way or
 * `noGuard` naming why none is. `leaving`: done at the target and heading for the lobby; caught
 * while still on the target floor, escaped once off it.
 */
export type TheftPhase = 'notice' | 'approach' | 'acting' | 'leaving';

export interface TheftEvent {
  kind: 'theft';
  phase: TheftPhase;
  enterAt: number;
  simId: Id | null;
  targetId: Id | null;
  floor: number | null; // the target's floor, kept in case the room goes mid encounter
  actUntil: number | null;
  guardId: Id | null;
  noGuard: string | null;
}

export type ActiveEvent =
  | { kind: 'fire'; roomIds: Id[]; startedAt: number; spreadAt: number }
  | { kind: 'bomb'; roomId: Id; ransom: number; detonateAt: number; found: boolean }
  | VipEvent
  | TheftEvent
  | { kind: 'santa'; startedAt: number; x: number }
  | { kind: 'wedding'; startedAt: number };

export interface Stats {
  incomeByKind: Partial<Record<RoomKind, number>>;
  upkeepByKind: Partial<Record<RoomKind | ShaftKind, number>>;
  lastQuarter: { income: number; upkeep: number; net: number };
  vipRating: 'none' | 'poor' | 'fair' | 'good';
  weddingsHeld: number;
  avgWaitMinutes: number;
  tenantsLeftReasons: Record<string, number>;
  badQuarterStreak?: number; // consecutive quarters below the bankruptcy line; saved with the world
  lastVip?: VipVisitRecord; // absent until the first visit ends; saved with the world
  lastTheftAt?: number; // minute the last theft was rolled, for the cooldown; absent until the first
}

export interface FloorIndex {
  rooms: Map<number, Room[]>; // floor -> rooms sorted by x (multi-floor rooms appear on every floor they cover)
  shafts: Map<number, Shaft[]>; // floor -> shafts that stop on that floor, sorted by x
  builtFloors: Set<number>;
}

export interface World {
  seed: number;
  rng: Rng;
  time: { minute: number };
  cash: number; // dollars
  /**
   * Cash when the current quarter began (after its settlement), for the status bar's
   * quarter delta. null until the first quarter boundary on a save older than v3.
   * Saved, never hashed: a display baseline, not simulation state.
   */
  quarterStartCash: number | null;
  stars: Star;
  population: number;
  /**
   * Population at the last day boundary (00:00), for the status bar's daily change.
   * null until the first day boundary on a save older than v3. Saved, never hashed.
   */
  dayStartPopulation: number | null;
  rooms: Map<Id, Room>;
  shafts: Map<Id, Shaft>;
  sims: Map<Id, Sim>;
  nextId: Id;
  log: LogEntry[];
  logTotal: number; // entries ever logged, so the UI can tell new lines from old after the log is trimmed
  events: ActiveEvent[];
  stats: Stats;
  floorIndex: FloorIndex;
  routingDirty: boolean;
  /**
   * Bumped by every change to what the static tower looks like: a room or shaft built,
   * removed or resized, a car added or removed, a room catching or losing fire, a room's
   * occupancy crossing zero (the lit bit). The renderer reconciles rooms, slabs and shafts
   * only when it moves. A render cache counter: never saved, never hashed.
   */
  structureVersion: number;
  /**
   * Waits at a hall call that passed LONG_WAIT_MINUTES, per game hour: a ring of the last
   * 24 hours, slot `hour % 24`, with the absolute hour each slot counts so a stale slot reads
   * as zero. Bumped by the people pass where the wait is measured; read by the goals card.
   * A display counter like structureVersion: never saved, never hashed.
   */
  longWaits: { hour: number[]; count: number[] };
  /**
   * Story beats and the followed cast (src/sim/story.ts). Presentation only: the tick writes
   * beats beside what it already does and never reads them back. Saved from v4, never hashed.
   */
  story: StoryState;
  gameOver: null | { at: number; reason: string };
}

// Derived time helpers (pure functions over minute count)
export interface Clock {
  minute: number;
  minuteOfDay: number; // 0..1439
  hour: number;
  dayOfQuarter: 0 | 1 | 2; // 0 and 1 are weekdays, 2 is the weekend day
  isWeekend: boolean;
  quarter: 0 | 1 | 2 | 3;
  year: number; // 1-based
}

export function clockOf(minute: number): Clock {
  const minuteOfDay = minute % 1440;
  const dayOfQuarter = (Math.floor(minute / 1440) % 3) as 0 | 1 | 2;
  return {
    minute,
    minuteOfDay,
    hour: Math.floor(minuteOfDay / 60),
    dayOfQuarter,
    isWeekend: dayOfQuarter === 2,
    quarter: (Math.floor(minute / 4320) % 4) as 0 | 1 | 2 | 3,
    year: Math.floor(minute / 17280) + 1,
  };
}
