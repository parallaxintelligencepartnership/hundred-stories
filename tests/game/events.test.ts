// The game's event stream: the tap that turns tick batches and commands into moments.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/game/storage', () => ({
  readSave: vi.fn(async () => null),
  writeSave: vi.fn(async () => {}),
  stashUnreadable: vi.fn(),
}));

import { createGame } from '../../src/game/game';
import { createTap, drainTap, type GameEvent } from '../../src/game/events';
import { createWorld } from '../../src/sim/world';
import { recordBeat, STORY_RECENT_CAP } from '../../src/sim/story';
import type { Car, Shaft, World } from '../../src/sim/types';

function carIn(world: World, state: Car['state']): Car {
  const car = { id: 900, state } as Car;
  world.shafts.set(77, { id: 77, cars: [car] } as unknown as Shaft);
  return car;
}

describe('event tap', () => {
  it('reports nothing for a world as it stands', () => {
    const world = createWorld(3);
    const tap = createTap(world);
    const seen: GameEvent[] = [];
    drainTap(tap, world, (e) => seen.push(e));
    expect(seen).toEqual([]);
  });

  it('reports new log lines, a star change, the turn of a quarter, and car doors', () => {
    const world = createWorld(3);
    const car = carIn(world, 'moving');
    const tap = createTap(world);
    const seen: GameEvent[] = [];
    const emit = (e: GameEvent) => seen.push(e);

    world.log.push({ minute: 0, text: 'Fire broke out.', level: 'alert' });
    world.logTotal += 1;
    world.stars = 2;
    world.time.minute = 3 * 1440 + 301; // 05:01 on day one of the second quarter: rent was just paid
    car.state = 'doorsOpen';
    drainTap(tap, world, emit);
    expect(seen.map((e) => e.kind)).toEqual(['log', 'rentDay', 'stars', 'car.arrive']);
    expect(seen[2]).toEqual({ kind: 'stars', from: 1, to: 2 });

    seen.length = 0;
    car.state = 'idle';
    drainTap(tap, world, emit);
    expect(seen).toEqual([{ kind: 'car.doors', shaftId: 77, carId: 900 }]);

    seen.length = 0;
    drainTap(tap, world, emit);
    expect(seen).toEqual([]); // nothing twice
  });
});

describe('story beats on the event stream', () => {
  it('emits each new beat once, in order, and a primed tap treats old beats as history', () => {
    const world = createWorld(3);
    recordBeat(world.story, { code: 'star.gained', minute: 1, value: 2 });
    const tap = createTap(world);
    const seen: GameEvent[] = [];
    const emit = (e: GameEvent) => seen.push(e);
    drainTap(tap, world, emit);
    expect(seen).toEqual([]);

    recordBeat(world.story, { code: 'wait.long', minute: 2, simId: 5, value: 6 });
    recordBeat(world.story, { code: 'trip.arrived', minute: 3, simId: 5, value: 4 });
    drainTap(tap, world, emit);
    drainTap(tap, world, emit);
    expect(seen.map((e) => (e.kind === 'beat' ? e.beat.code : e.kind))).toEqual(['wait.long', 'trip.arrived']);
  });

  it('tracks beats by count, not position: a batch longer than the list emits what the list holds', () => {
    const world = createWorld(3);
    const tap = createTap(world);
    for (let i = 0; i < STORY_RECENT_CAP + 44; i++) recordBeat(world.story, { code: 'wait.long', minute: i, simId: 1, value: 6 });
    const seen: GameEvent[] = [];
    drainTap(tap, world, (e) => seen.push(e));
    const beats = seen.filter((e) => e.kind === 'beat');
    expect(beats).toHaveLength(STORY_RECENT_CAP);
    expect(beats[0]?.kind === 'beat' && beats[0].beat.minute).toBe(44);
    recordBeat(world.story, { code: 'trip.arrived', minute: 999, simId: 1, value: 3 });
    const next: GameEvent[] = [];
    drainTap(tap, world, (e) => next.push(e));
    expect(next).toEqual([{ kind: 'beat', beat: { code: 'trip.arrived', minute: 999, simId: 1, value: 3 } }]);
  });
});

describe('subscribeEvents on the game shell', () => {
  it('hears an accepted build and its log line, and nothing after unsubscribing', () => {
    const game = createGame(5, { now: () => 0 });
    const seen: GameEvent[] = [];
    const off = game.subscribeEvents((e) => seen.push(e));
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 })).toEqual({ ok: true });
    expect(seen[0]).toEqual({ kind: 'build', command: 'build' });
    expect(seen.some((e) => e.kind === 'log' && e.entry.text.startsWith('Built'))).toBe(true);

    seen.length = 0;
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 }); // refused: the tile is taken
    // The refusal (the haptics' double tap) and its line, no build sound.
    expect(seen.map((e) => e.kind)).toEqual(['refused', 'log']);
    expect(seen[0]).toEqual({ kind: 'refused', command: 'build' });

    off();
    seen.length = 0;
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 });
    expect(seen).toEqual([]);
  });

  it('does not replay what happened while nobody listened, or a new game', () => {
    const game = createGame(5, { now: () => 0 });
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 });
    const seen: GameEvent[] = [];
    game.subscribeEvents((e) => seen.push(e));
    game.apply({ kind: 'shaft.removeCar', shaftId: 12345 }); // refused, one line
    expect(seen.map((e) => e.kind)).toEqual(['refused', 'log']); // the lobby built before subscribing is not replayed
    seen.length = 0;
    game.newGame(9);
    game.apply({ kind: 'shaft.removeCar', shaftId: 12345 });
    expect(seen.map((e) => e.kind)).toEqual(['refused', 'log']); // the swap to a new world is not news
  });

  it('hears rent day from the tick batch that pays the rent at 05:00, not at midnight (audit D S10 / I S11)', () => {
    const run = (startMinute: number): { seen: GameEvent[]; minute: number } => {
      const clock = { ms: 0 };
      const game = createGame(5, { now: () => clock.ms, scheduleIdle: () => () => {} });
      const seen: GameEvent[] = [];
      game.subscribeEvents((e) => seen.push(e));
      game.setSpeed(1);
      game.world.time.minute = startMinute;
      clock.ms += 100;
      game.stepOnce();
      return { seen, minute: game.world.time.minute };
    };
    // 04:59 on the first day of the second quarter: the batch runs the 05:00 settlement
    const paid = run(3 * 1440 + 299);
    expect(paid.minute).toBeGreaterThan(3 * 1440 + 300);
    expect(paid.seen.filter((e) => e.kind === 'rentDay')).toHaveLength(1);
    // 23:59 on the last day of the first quarter: midnight passes, no rent is paid yet
    const midnight = run(3 * 1440 - 1);
    expect(midnight.minute).toBeGreaterThanOrEqual(3 * 1440);
    expect(midnight.minute).toBeLessThanOrEqual(3 * 1440 + 300);
    expect(midnight.seen.filter((e) => e.kind === 'rentDay')).toHaveLength(0);
  });
});
