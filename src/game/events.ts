// The game's event stream: what just happened, for listeners that react to moments rather than
// state (the sound module). Fed from the tick batches and command results the shell already
// runs; it only reads the world, and only while someone is listening.
import { clockOf, type Command, type Id, type LogEntry, type World } from '../sim/types';
import type { StoryBeat } from '../sim/story';

export type GameEvent =
  /** A new line in the world log, as the ticker and the toasts see it. */
  | { kind: 'log'; entry: LogEntry }
  /** A build command the sim accepted. */
  | { kind: 'build'; command: Command['kind'] }
  /** A command the sim refused (the haptics' double tap). */
  | { kind: 'refused'; command: Command['kind'] }
  /** The clock crossed into a new quarter, when office rent is paid. */
  | { kind: 'rentDay' }
  /** The star rating moved. */
  | { kind: 'stars'; from: number; to: number }
  /** A car stopped and opened its doors. */
  | { kind: 'car.arrive'; shaftId: Id; carId: Id }
  /** A car closed its doors. */
  | { kind: 'car.doors'; shaftId: Id; carId: Id }
  /** A story beat, as recorded for presentation. */
  | { kind: 'beat'; beat: StoryBeat };

export type GameEventListener = (event: GameEvent) => void;

/** The commands that put something new up, which the build sound answers. */
const BUILD_COMMANDS: ReadonlySet<Command['kind']> = new Set<Command['kind']>(['build', 'shaft.build', 'shaft.extend', 'shaft.addCar']);

export function isBuildCommand(kind: Command['kind']): boolean {
  return BUILD_COMMANDS.has(kind);
}

/** What the tap saw last time, so the next look can tell what changed. */
export interface EventTap {
  logTotal: number;
  stars: number;
  quarter: number;
  /** Car id to whether its doors were open. */
  doors: Map<Id, boolean>;
  /** The story's beat counter when the tap last looked. Beats are tracked by seq, not index: recent is capped. */
  storySeq: number;
}

function absoluteQuarter(minute: number): number {
  const clock = clockOf(minute);
  return (clock.year - 1) * 4 + clock.quarter;
}

/** A tap primed on this world: nothing that is already true counts as news. */
export function createTap(world: World): EventTap {
  const tap: EventTap = { logTotal: 0, stars: 0, quarter: 0, doors: new Map(), storySeq: 0 };
  primeTap(tap, world);
  return tap;
}

/** Forget what the tap saw and take the world as it stands: a load or a new game is not news. */
export function primeTap(tap: EventTap, world: World): void {
  tap.logTotal = world.logTotal;
  tap.stars = world.stars;
  tap.quarter = absoluteQuarter(world.time.minute);
  tap.storySeq = world.story?.seq ?? 0;
  tap.doors.clear();
  for (const shaft of world.shafts.values()) {
    for (const car of shaft.cars) tap.doors.set(car.id, car.state === 'doorsOpen');
  }
}

/**
 * Emit what changed since the tap last looked, and remember the world as it is now.
 *
 * Run after a batch of ticks or a command, never on a timer of its own. Car doors are compared
 * per batch, so a car that opened and closed inside one batch (possible at night speed) is
 * not heard; the sound only needs the rhythm of the tower, not every stop.
 */
export function drainTap(tap: EventTap, world: World, emit: GameEventListener): void {
  const fresh = Math.max(0, Math.min(world.logTotal - tap.logTotal, world.log.length));
  for (let i = world.log.length - fresh; i < world.log.length; i += 1) {
    const entry = world.log[i];
    if (entry) emit({ kind: 'log', entry });
  }
  tap.logTotal = world.logTotal;

  // Story beats since the last look, oldest first. More than the list holds arrived only if
  // a batch outran it; then what the list still has is what there is to tell.
  const story = world.story;
  if (story) {
    const freshBeats = Math.max(0, Math.min(story.seq - tap.storySeq, story.recent.length));
    for (let i = story.recent.length - freshBeats; i < story.recent.length; i += 1) {
      const beat = story.recent[i];
      if (beat) emit({ kind: 'beat', beat });
    }
    tap.storySeq = story.seq;
  }

  const quarter = absoluteQuarter(world.time.minute);
  if (quarter > tap.quarter) emit({ kind: 'rentDay' });
  tap.quarter = quarter;

  if (world.stars !== tap.stars) emit({ kind: 'stars', from: tap.stars, to: world.stars });
  tap.stars = world.stars;

  for (const shaft of world.shafts.values()) {
    for (const car of shaft.cars) {
      const open = car.state === 'doorsOpen';
      const was = tap.doors.get(car.id);
      if (was === false && open) emit({ kind: 'car.arrive', shaftId: shaft.id, carId: car.id });
      else if (was === true && !open) emit({ kind: 'car.doors', shaftId: shaft.id, carId: car.id });
      tap.doors.set(car.id, open);
    }
  }
}
