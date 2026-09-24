/**
 * A person can tell a true story: one worker's long morning wait, a car added, a later
 * shorter trip, and a card that states the before and after without claiming a cause.
 *
 * Built the way a player builds it (applyCommand), run through tick.ts. The only thing done
 * outside a command is following the worker, which is presentation state, not a command.
 */

import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import { STORY } from '../../src/sim/rules';
import {
  createStoryState,
  followSim,
  minutesText,
  personCard,
  STORY_FOLLOWED_CAP,
  type StoryBeat,
} from '../../src/sim/story';
import { tick } from '../../src/sim/tick';
import { createWorld } from '../../src/sim/world';
import { at, buildRow, buildTower, lobbyRun, onlyShaft } from './helpers';
import type { Command, Sim, World } from '../../src/sim/types';

const SEED = 2026;
const SHAFT_X = 148;
/** Six offices either side of the shaft, the nearest two against its doors. */
const OFFICE_XS = [94, 103, 112, 121, 130, 139, 152, 161, 170, 179, 188, 197];
const NEXT_TO_SHAFT = [139, 152];
const TOP_FLOOR = 4;

/**
 * One standard shaft with one car, and twelve offices on each floor from 2 to 4: 216 workers
 * for one car of 21 makes the morning queue long, and the rides stay short, so a wait and a
 * whole trip can be compared honestly.
 */
function busyTower(seed = SEED): World {
  const world = createWorld(seed);
  const script: Command[] = [
    ...lobbyRun(140, 160),
    { kind: 'shaft.build', shaft: 'standard', x: SHAFT_X, floorMin: 1, floorMax: TOP_FLOOR },
  ];
  for (let floor = 2; floor <= TOP_FLOOR; floor++) script.push(...buildRow('office', floor, OFFICE_XS));
  buildTower(world, script);
  return world;
}

/** The top floor worker beside the shaft due in latest this morning: the back of the queue. */
function lateTopFloorWorker(world: World): Sim {
  let best: Sim | null = null;
  for (const sim of world.sims.values()) {
    if (sim.kind !== 'worker') continue;
    const home = sim.homeRoomId !== null ? world.rooms.get(sim.homeRoomId) : undefined;
    if (!home || home.floor !== TOP_FLOOR || !NEXT_TO_SHAFT.includes(home.x)) continue;
    const arrive = sim.schedule[0]?.minuteOfDay ?? 0;
    if (!best || arrive > (best.schedule[0]?.minuteOfDay ?? 0) || (arrive === (best.schedule[0]?.minuteOfDay ?? 0) && sim.id < best.id)) best = sim;
  }
  if (!best) throw new Error('No top floor worker.');
  return best;
}

function beatsOf(world: World, simId: number, code: StoryBeat['code']): StoryBeat[] {
  return (world.story.threads[simId] ?? []).filter((beat) => beat.code === code);
}

/** Tick until `done` holds, or fail after `limit` minutes. */
function runUntil(world: World, done: () => boolean, limit: number, what: string): void {
  for (let i = 0; i < limit; i++) {
    if (done()) return;
    tick(world);
  }
  if (!done()) throw new Error(`Gave up after ${limit} minutes waiting for ${what}.`);
}

describe('a worker story', () => {
  it('records a long wait, then a shorter trip after a car is added, and says so without a cause', () => {
    const world = busyTower();
    at(world, 8, 1); // the offices lease at 08:00 and the workers are on their way
    const worker = lateTopFloorWorker(world);
    expect(followSim(world.story, worker.id)).toBe(true);

    runUntil(world, () => beatsOf(world, worker.id, 'wait.long').length > 0, 1440, 'a long wait');
    const wait = beatsOf(world, worker.id, 'wait.long')[0] as StoryBeat;
    expect(wait.value).toBeGreaterThanOrEqual(STORY.longWaitMinutes);

    // The wait's beat keeps counting while that wait lasts: let it end before reading it.
    runUntil(world, () => world.sims.get(worker.id)?.state !== 'waiting', 240, 'the wait to end');
    const waited = wait.value as number;

    const shaft = onlyShaft(world);
    expect(applyCommand(world, { kind: 'shaft.addCar', shaftId: shaft.id }).ok).toBe(true);
    const changedAt = world.time.minute;

    // The next trip that began after the change.
    const later = (): StoryBeat | undefined =>
      beatsOf(world, worker.id, 'trip.arrived').find((beat) => beat.minute - (beat.value ?? 0) >= changedAt);
    runUntil(world, () => later() !== undefined, 3 * 1440, 'a trip after the new car');
    const trip = later() as StoryBeat;
    expect(trip.value).toBeLessThan(waited);

    const sim = world.sims.get(worker.id) as Sim;
    const card = personCard(world, sim);
    const chapter = card.chapter.join(' ').toLowerCase();
    expect(chapter).toContain(minutesText(waited));
    expect(chapter).toContain(minutesText(trip.value as number));
    expect(chapter).not.toContain('because');
    expect(chapter).not.toContain('caused');

    // Save and load keep the followed thread, beat for beat.
    const loaded = deserialize(serialize(world));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.world.story.followed).toEqual([worker.id]);
    expect(loaded.world.story.threads[worker.id]).toEqual(world.story.threads[worker.id]);
    expect(hashWorld(loaded.world)).toBe(hashWorld(world));
  });

  it('replays the same story facts from the same seed and commands', () => {
    const run = (): StoryBeat[] => {
      const world = busyTower();
      at(world, 8, 1);
      followSim(world.story, lateTopFloorWorker(world).id);
      at(world, 12, 0);
      return world.story.recent.map((beat) => ({ ...beat }));
    };
    const first = run();
    expect(first.length).toBeGreaterThan(0);
    expect(run()).toEqual(first);
  });

  it('never changes the simulation: the hash with a followed cast matches the hash without', () => {
    const plain = busyTower();
    const told = busyTower();
    at(plain, 8, 1);
    at(told, 8, 1);
    for (const sim of [...told.sims.values()].slice(0, STORY_FOLLOWED_CAP)) followSim(told.story, sim.id);
    at(plain, 18, 0);
    at(told, 18, 0);
    expect(told.story.recent.length).toBeGreaterThan(0);
    expect(hashWorld(told)).toBe(hashWorld(plain));
  });
});

describe('story in the save', () => {
  it('loads a v3 save with an empty story', () => {
    const world = busyTower();
    at(world, 9, 0);
    followSim(world.story, lateTopFloorWorker(world).id);
    const data = JSON.parse(serialize(world));
    data.version = 3;
    delete data.story; // a v3 save never had one
    const result = deserialize(JSON.stringify(data));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.story).toEqual(createStoryState());
  });

  it('loads a v4 save with nine followed people as eight, and drops what does not check out', () => {
    const world = busyTower();
    at(world, 9, 0);
    const data = JSON.parse(serialize(world));
    const ids = [...world.sims.keys()].slice(0, STORY_FOLLOWED_CAP + 1);
    expect(ids).toHaveLength(9);
    data.story = {
      seq: 3,
      followed: ids,
      threads: Object.fromEntries(ids.map((id) => [id, Array.from({ length: 9 }, (_, i) => ({ code: 'trip.arrived', minute: i, simId: id, value: 2 }))])),
      recent: [
        { code: 'wait.long', minute: 1, simId: ids[0], value: 7 },
        { code: 'made.up', minute: 2 },
        { code: 'trip.arrived', minute: 'soon' },
        { code: 'star.gained', minute: 3, value: null },
      ],
    };
    const result = deserialize(JSON.stringify(data));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const story = result.world.story;
    expect(story.followed).toEqual(ids.slice(0, STORY_FOLLOWED_CAP));
    expect(Object.keys(story.threads)).toHaveLength(STORY_FOLLOWED_CAP);
    expect(story.threads[ids[0] as number]).toHaveLength(6);
    expect(story.recent).toEqual([
      { code: 'wait.long', minute: 1, simId: ids[0], value: 7 },
      { code: 'star.gained', minute: 3 },
    ]);
  });

  it('keeps the save loadable when the story is not a story at all', () => {
    const world = busyTower();
    const data = JSON.parse(serialize(world));
    data.story = 'nonsense';
    const result = deserialize(JSON.stringify(data));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.story).toEqual(createStoryState());
  });
});
