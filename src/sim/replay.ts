// Replay: rebuild a tower from its starting number and its build log (src/sim/buildlog.ts), and
// check a save by replaying it. Pure: no DOM, no clock, no Math.random; the sim's own public
// functions only (createWorld, tick, applyCommand, hashWorld), called unchanged.

import { applyCommand } from './build';
import { buildLogOf, recordCheckpoint, type BuildLogEntry, type Checkpoint, type ReplayUnavailable } from './buildlog';
import { EDITION, type Edition } from './rules';
import { deserialize, hashWorld } from './save';
import { tick } from './tick';
import type { World } from './types';
import { createWorld } from './world';

/** An entry the replay's sim refused. The original accepted it, so the worlds had parted by then. */
export interface RefusedEntry {
  index: number;
  t: number;
  reason: string;
}

export interface ReplayResult {
  world: World;
  /** Every refused entry, in order. Empty when the replay kept step with the log. */
  refused: RefusedEntry[];
}

/**
 * Can this build run replay a log written in `edition`? The demo refuses builds outside its box
 * and the other editions do not, and only accepted commands are logged. So a demo log replays
 * anywhere, but a web or full log cannot replay inside a demo build.
 */
export function editionCanReplay(edition: Edition, running: Edition = EDITION): boolean {
  return running !== 'demo' || edition === 'demo';
}

/** Tick until the world reaches this minute. A tower that went bankrupt stops where it stopped. */
function runTo(world: World, minute: number): void {
  while (world.time.minute < minute && !world.gameOver) tick(world);
}

/**
 * The walk shared by replay and verify. `onCheck` is called at each checkpoint, in order, with the
 * replayed world at exactly that point; returning false stops the walk there.
 */
function walk(
  startingNumber: number,
  entries: readonly BuildLogEntry[],
  untilTick: number,
  checks: readonly Checkpoint[],
  onCheck: (check: Checkpoint, world: World) => boolean,
): ReplayResult & { stopped: boolean } {
  const world = createWorld(startingNumber);
  const refused: RefusedEntry[] = [];
  let c = 0;
  const checksBefore = (n: number): boolean => {
    while (c < checks.length && (checks[c] as Checkpoint).n <= n) {
      const check = checks[c] as Checkpoint;
      c++;
      if (check.n < n) continue; // cannot happen in a log this game wrote; skipped, never guessed at
      runTo(world, check.t);
      if (!onCheck(check, world)) return false;
    }
    return true;
  };
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as BuildLogEntry;
    if (entry.t > untilTick) break;
    if (!checksBefore(i)) return { world, refused, stopped: true };
    runTo(world, entry.t);
    const result = applyCommand(world, entry.cmd);
    if (!result.ok) refused.push({ index: i, t: entry.t, reason: result.reason });
  }
  if (!checksBefore(entries.length)) return { world, refused, stopped: true };
  runTo(world, untilTick);
  return { world, refused, stopped: false };
}

/**
 * Build a fresh world from its starting number and apply each logged command before the tick it
 * was applied before, then run on to `untilTick`. The world returned sits at minute `untilTick`
 * with every entry logged at or before that minute applied, which is the state a save written at
 * that minute holds. Throws when this build's edition cannot replay the log's.
 */
export function replay(startingNumber: number, edition: Edition, log: readonly BuildLogEntry[], untilTick: number): ReplayResult {
  if (!editionCanReplay(edition)) throw new Error(`A log from the ${edition} edition cannot be replayed in the ${EDITION} edition.`);
  const { world, refused } = walk(startingNumber, log, untilTick, [], () => true);
  return { world, refused };
}

export type VerifyResult =
  | { status: 'unreadable'; reason: string }
  | { status: 'unavailable'; why: ReplayUnavailable | 'edition' }
  | { status: 'match'; tick: number; hash: string; entries: number; checkpoints: number }
  | {
      status: 'mismatch';
      /** The first tick known to differ: a refused entry's tick, or the first checkpoint whose hash differs. */
      divergedAt: number;
      /** The last checkpoint that still matched, or null when none did. The drift is after it. */
      lastMatch: number | null;
      /** The first refused entry, when there was one. */
      refused: RefusedEntry | null;
      expected: string;
      actual: string;
    };

/**
 * Replay a save's log and compare the replayed world's hash with the save's own world hash, and
 * with every checkpoint the game wrote on the way. Stops at the first checkpoint that differs.
 */
export function verifySave(text: string): VerifyResult {
  const loaded = deserialize(text);
  if (!loaded.ok) return { status: 'unreadable', reason: loaded.reason };
  const saved = loaded.world;
  const log = buildLogOf(saved);
  if (log.unavailable) return { status: 'unavailable', why: log.unavailable };
  if (!editionCanReplay(log.edition)) return { status: 'unavailable', why: 'edition' };

  const minute = saved.time.minute;
  const finalHash = hashWorld(saved);
  // The save itself is the last checkpoint.
  const checks: Checkpoint[] = [...log.checks.filter((c) => c.t <= minute), { t: minute, n: log.entries.length, h: finalHash }];
  let lastMatch: number | null = null;
  let bad: { check: Checkpoint; actual: string } | null = null;
  const { refused } = walk(saved.seed, log.entries, minute, checks, (check, world) => {
    const actual = hashWorld(world);
    if (actual === check.h && world.time.minute === check.t) {
      lastMatch = check.t;
      return true;
    }
    bad = { check, actual };
    return false;
  });
  const firstRefused = refused[0] ?? null;
  if (bad === null && firstRefused === null) {
    return { status: 'match', tick: minute, hash: finalHash, entries: log.entries.length, checkpoints: log.checks.length };
  }
  const found = bad as { check: Checkpoint; actual: string } | null;
  const badTick = found ? found.check.t : minute;
  return {
    status: 'mismatch',
    divergedAt: firstRefused && firstRefused.t <= badTick ? firstRefused.t : badTick,
    lastMatch,
    refused: firstRefused,
    expected: found ? found.check.h : finalHash,
    actual: found ? found.actual : finalHash,
  };
}

/** Note the world hash in its build log, so a later replay can locate a drift. The game calls this as it saves. */
export function markCheckpoint(world: World): void {
  recordCheckpoint(world, hashWorld(world));
}
