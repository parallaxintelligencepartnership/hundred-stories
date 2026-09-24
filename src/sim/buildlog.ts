// The build log: every accepted player command, with the minute it went in, so a tower can be
// rebuilt from its starting number (src/sim/replay.ts).
//
// The simulation is deterministic: the same starting number and the same commands at the same
// minutes give the same world hash. The log therefore sits beside the world, never inside it:
// it is held here in a WeakMap keyed by the World object, is saved from v5 (src/sim/save.ts),
// and is not part of hashWorld, so no existing hash or baseline moves.
//
// The boundary: every player command enters the sim through applyCommand in build.ts, and the
// game shell (src/game/game.ts) calls it only through applyAndRecord below. Only accepted
// commands are kept. A refused command changes nothing, so leaving it out keeps the log small
// (a lobby drag repaints the same tiles many times) and replays the same world.

import { applyCommand } from './build';
import { EDITION, ROOMS, SHAFTS, type Edition } from './rules';
import type { Car, Command, CommandKind, CommandResult, RoomKind, ShaftKind, World } from './types';

/** One accepted command and the minute it was applied at, before that minute's tick ran. */
export interface BuildLogEntry {
  t: number;
  cmd: Command;
}

/**
 * The world hash at a known point: minute `t`, after exactly `n` entries were applied. Written
 * when the game saves, so a replay that drifts can be located between two of them.
 */
export interface Checkpoint {
  t: number;
  n: number;
  h: string;
}

/** Why a tower cannot be replayed: it was begun before logging existed, or its log was damaged. */
export type ReplayUnavailable = 'startedBeforeLog' | 'damaged';

export interface BuildLog {
  /** Null when the log runs from the first minute of the tower; otherwise why it does not. */
  unavailable: ReplayUnavailable | null;
  /** The edition the tower was started in: the demo refuses builds outside its box. */
  edition: Edition;
  entries: BuildLogEntry[];
  checks: Checkpoint[];
}

// ---------------------------------------------------------------------------------------------
// Encoding.
//
// On disk each entry is one flat JSON array: [ticksSincePreviousEntry, op, ...arguments], for
// example [0,"b","office",2,40] or [1312,"r",845,120]. Why this shape:
// - A tuple drops the repeated key names. A lobby drag is one entry per tile and a big tower is
//   thousands of entries, so an object per entry ({"t":..,"cmd":{"kind":"build",..}}) would be
//   about three times the bytes for the same information.
// - The tick is stored as the gap since the previous entry. Builds come in bursts, so the gap is
//   mostly 0 or a few digits, where an absolute minute grows to six digits over a long game.
// - It is still plain JSON inside the save: no binary step, readable in a bug report, and the
//   save stays one JSON.parse.
// Measured (2026-09-24), about 21 bytes an entry: the bench towers log 8 KB (small, 376
// entries), 16 KB (medium, 746) and 28 KB (large, 1251); the large tower plus a game year of 20
// edits a day and a checkpoint a day is 169 KB (8451 entries). Under the 200 KB line, so no
// compression or run-length step; lobby runs would be the first thing to fold if it is needed.
// The op codes are short and fixed forever once written: change one and old logs misread.
// ---------------------------------------------------------------------------------------------

export type EncodedEntry = (number | string)[];
type Args = (number | string)[];

export const BUILD_LOG_FORMAT = 1;

class BadEntry extends Error {}

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new BadEntry();
  return value;
}

function roomKind(value: unknown): RoomKind {
  if (typeof value !== 'string' || !Object.hasOwn(ROOMS, value)) throw new BadEntry();
  return value as RoomKind;
}

function shaftKind(value: unknown): ShaftKind {
  if (typeof value !== 'string' || !Object.hasOwn(SHAFTS, value)) throw new BadEntry();
  return value as ShaftKind;
}

const SERVES = { any: true, hotel: true, office: true } satisfies Record<Car['serves'], true>;

function serves(value: unknown): Car['serves'] {
  if (typeof value !== 'string' || !Object.hasOwn(SERVES, value)) throw new BadEntry();
  return value as Car['serves'];
}

type CommandOf<K extends CommandKind> = Extract<Command, { kind: K }>;

/**
 * One row per command kind. `satisfies` over every CommandKind makes a new command a typecheck
 * error here until it is given a code, so nothing the player can do slips past the log.
 */
const CODEC = {
  build: { op: 'b', enc: (c) => [c.room, c.floor, c.x], dec: (a) => ({ kind: 'build', room: roomKind(a[0]), floor: int(a[1]), x: int(a[2]) }) },
  demolish: { op: 'd', enc: (c) => [c.roomId], dec: (a) => ({ kind: 'demolish', roomId: int(a[0]) }) },
  'shaft.build': {
    op: 's',
    enc: (c) => [c.shaft, c.x, c.floorMin, c.floorMax],
    dec: (a) => ({ kind: 'shaft.build', shaft: shaftKind(a[0]), x: int(a[1]), floorMin: int(a[2]), floorMax: int(a[3]) }),
  },
  'shaft.demolish': { op: 'sd', enc: (c) => [c.shaftId], dec: (a) => ({ kind: 'shaft.demolish', shaftId: int(a[0]) }) },
  'shaft.extend': {
    op: 'se',
    enc: (c) => [c.shaftId, c.floorMin, c.floorMax],
    dec: (a) => ({ kind: 'shaft.extend', shaftId: int(a[0]), floorMin: int(a[1]), floorMax: int(a[2]) }),
  },
  'shaft.addCar': { op: 'ca', enc: (c) => [c.shaftId], dec: (a) => ({ kind: 'shaft.addCar', shaftId: int(a[0]) }) },
  'shaft.removeCar': { op: 'cr', enc: (c) => [c.shaftId], dec: (a) => ({ kind: 'shaft.removeCar', shaftId: int(a[0]) }) },
  'shaft.setStop': {
    op: 'st',
    enc: (c) => [c.shaftId, c.floor, c.stops ? 1 : 0],
    dec: (a) => {
      const flag = int(a[2]);
      if (flag !== 0 && flag !== 1) throw new BadEntry();
      return { kind: 'shaft.setStop', shaftId: int(a[0]), floor: int(a[1]), stops: flag === 1 };
    },
  },
  'shaft.setHome': { op: 'sh', enc: (c) => [c.shaftId, c.floor], dec: (a) => ({ kind: 'shaft.setHome', shaftId: int(a[0]), floor: int(a[1]) }) },
  'shaft.setCarServes': {
    op: 'cs',
    enc: (c) => [c.shaftId, c.carId, c.serves],
    dec: (a) => ({ kind: 'shaft.setCarServes', shaftId: int(a[0]), carId: int(a[1]), serves: serves(a[2]) }),
  },
  // A cleared range is written with no bounds: [id, carId].
  'shaft.setCarRange': {
    op: 'cg',
    enc: (c) => (c.range === null ? [c.shaftId, c.carId] : [c.shaftId, c.carId, c.range.lo, c.range.hi]),
    dec: (a) => {
      if (a.length !== 2 && a.length !== 4) throw new BadEntry();
      const range = a.length === 2 ? null : { lo: int(a[2]), hi: int(a[3]) };
      return { kind: 'shaft.setCarRange', shaftId: int(a[0]), carId: int(a[1]), range };
    },
  },
  'room.setRent': { op: 'r', enc: (c) => [c.roomId, c.rent], dec: (a) => ({ kind: 'room.setRent', roomId: int(a[0]), rent: int(a[1]) }) },
  'bomb.pay': { op: 'bp', enc: () => [], dec: () => ({ kind: 'bomb.pay' }) },
  'fire.callHelicopter': { op: 'fh', enc: () => [], dec: () => ({ kind: 'fire.callHelicopter' }) },
} satisfies { [K in CommandKind]: { op: string; enc: (c: CommandOf<K>) => Args; dec: (a: readonly unknown[]) => CommandOf<K> } };

type Codec = { op: string; enc: (c: Command) => Args; dec: (a: readonly unknown[]) => Command };
const CODECS = CODEC as unknown as Record<CommandKind, Codec>;
const BY_OP = new Map<string, Codec>(Object.values(CODECS).map((row) => [row.op, row]));
if (BY_OP.size !== Object.keys(CODECS).length) throw new Error('Two build log commands share an op code.');

export function encodeCommand(cmd: Command): Args {
  const row = CODECS[cmd.kind];
  return [row.op, ...row.enc(cmd)];
}

/** Throws on anything that is not a command this file wrote. */
export function decodeCommand(encoded: readonly unknown[]): Command {
  const row = typeof encoded[0] === 'string' ? BY_OP.get(encoded[0]) : undefined;
  if (!row) throw new BadEntry();
  return row.dec(encoded.slice(1));
}

export function encodeEntries(entries: readonly BuildLogEntry[]): EncodedEntry[] {
  let prev = 0;
  return entries.map((entry) => {
    const gap = entry.t - prev;
    prev = entry.t;
    return [gap, ...encodeCommand(entry.cmd)];
  });
}

/** Throws when any entry is malformed or the ticks run backwards. */
export function decodeEntries(encoded: unknown): BuildLogEntry[] {
  if (!Array.isArray(encoded)) throw new BadEntry();
  let t = 0;
  return encoded.map((raw: unknown) => {
    if (!Array.isArray(raw)) throw new BadEntry();
    const gap = int(raw[0]);
    if (gap < 0) throw new BadEntry();
    t += gap;
    return { t, cmd: decodeCommand(raw.slice(1)) };
  });
}

// ---------------------------------------------------------------------------------------------
// The log held beside each world.
// ---------------------------------------------------------------------------------------------

const logs = new WeakMap<World, BuildLog>();

/** A fresh, replayable log for a world that has just been created and not touched. */
export function startBuildLog(world: World, edition: Edition = EDITION): BuildLog {
  const log: BuildLog = { unavailable: null, edition, entries: [], checks: [] };
  logs.set(world, log);
  return log;
}

/**
 * The world's log. A world nobody started a log for (a hand built test tower, the smoke demo) has
 * an unknown past, so it gets one that says replay is unavailable.
 */
export function buildLogOf(world: World): BuildLog {
  let log = logs.get(world);
  if (!log) {
    log = { unavailable: 'startedBeforeLog', edition: EDITION, entries: [], checks: [] };
    logs.set(world, log);
  }
  return log;
}

/** Put a log beside a world, as the loader does. */
export function setBuildLog(world: World, log: BuildLog): void {
  logs.set(world, log);
}

/** The recording boundary: apply one player command and keep it when the sim accepted it. */
export function applyAndRecord(world: World, cmd: Command): CommandResult {
  const minute = world.time.minute;
  const result = applyCommand(world, cmd);
  // Kept through its own encoding, so what is logged is exactly what a replay will apply.
  if (result.ok) buildLogOf(world).entries.push({ t: minute, cmd: decodeCommand(encodeCommand(cmd)) });
  return result;
}

/** Note the world hash at this moment. A second note at the same point replaces the first. */
export function recordCheckpoint(world: World, hash: string): void {
  const log = buildLogOf(world);
  const check: Checkpoint = { t: world.time.minute, n: log.entries.length, h: hash };
  const last = log.checks[log.checks.length - 1];
  if (last && last.t === check.t && last.n === check.n) log.checks[log.checks.length - 1] = check;
  else log.checks.push(check);
}

// ---------------------------------------------------------------------------------------------
// Save form (save v5).
// ---------------------------------------------------------------------------------------------

export interface SavedBuildLog {
  format: number;
  edition: Edition;
  unavailable: ReplayUnavailable | null;
  entries: EncodedEntry[];
  checks: [number, number, string][];
}

export function buildLogToSave(world: World): SavedBuildLog {
  const log = buildLogOf(world);
  return {
    format: BUILD_LOG_FORMAT,
    edition: log.edition,
    unavailable: log.unavailable,
    entries: encodeEntries(log.entries),
    checks: log.checks.map((c) => [c.t, c.n, c.h]),
  };
}

const EDITIONS = { web: true, demo: true, full: true } satisfies Record<Edition, true>;

/**
 * The log from a save. A save older than v5 (raw undefined) started before logging. A log that
 * does not read is marked damaged: the tower still loads, only replay is off. Never a refusal.
 */
export function buildLogFromSave(raw: unknown): BuildLog {
  if (raw === undefined) return { unavailable: 'startedBeforeLog', edition: EDITION, entries: [], checks: [] };
  const damaged: BuildLog = { unavailable: 'damaged', edition: EDITION, entries: [], checks: [] };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return damaged;
  const r = raw as Record<string, unknown>;
  if (r.format !== BUILD_LOG_FORMAT) return damaged;
  if (typeof r.edition !== 'string' || !Object.hasOwn(EDITIONS, r.edition)) return damaged;
  const edition = r.edition as Edition;
  const unavailable = r.unavailable === 'startedBeforeLog' || r.unavailable === 'damaged' ? r.unavailable : null;
  if (unavailable === null && r.unavailable !== null) return damaged;
  try {
    const entries = decodeEntries(r.entries);
    if (!Array.isArray(r.checks)) throw new BadEntry();
    const checks = r.checks.map((c: unknown): Checkpoint => {
      if (!Array.isArray(c) || c.length !== 3 || typeof c[2] !== 'string') throw new BadEntry();
      const n = int(c[1]);
      if (n < 0 || n > entries.length) throw new BadEntry();
      return { t: int(c[0]), n, h: c[2] };
    });
    return { unavailable, edition, entries, checks };
  } catch {
    return { ...damaged, edition };
  }
}
