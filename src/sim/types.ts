// Hundred Stories: the simulation contract.
// Every sim module and the renderer build against these shapes. See docs/DESIGN.md.
// The sim is pure: nothing in src/sim may touch the DOM, Date, Math.random, or pixi.js.

import type { Rng } from './rng';

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
  | 'vip';

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
  hallCalls: Map<number, { up: boolean; down: boolean }>;
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
  | { kind: 'bomb.pay' }
  | { kind: 'fire.callHelicopter' };

export type CommandKind = Command['kind'];

export type CommandResult = { ok: true } | { ok: false; reason: string };

export interface LogEntry {
  minute: number;
  text: string;
  level: 'info' | 'warn' | 'alert';
  roomId?: Id;
  simId?: Id;
}

export type ActiveEvent =
  | { kind: 'fire'; roomIds: Id[]; startedAt: number; spreadAt: number }
  | { kind: 'bomb'; roomId: Id; ransom: number; detonateAt: number; found: boolean }
  | { kind: 'vip'; simId: Id; arrivesAt: number; leavesAt: number; score: number; suiteId: Id | null }
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
  stars: Star;
  population: number;
  rooms: Map<Id, Room>;
  shafts: Map<Id, Shaft>;
  sims: Map<Id, Sim>;
  nextId: Id;
  log: LogEntry[];
  events: ActiveEvent[];
  stats: Stats;
  floorIndex: FloorIndex;
  routingDirty: boolean;
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
