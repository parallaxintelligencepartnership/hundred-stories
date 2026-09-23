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
    world.time.minute = 3 * 1440; // day one of the second quarter
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
    expect(seen.map((e) => e.kind)).toEqual(['log']); // the refusal line, no build sound

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
    expect(seen.map((e) => e.kind)).toEqual(['log']); // the lobby built before subscribing is not replayed
    seen.length = 0;
    game.newGame(9);
    game.apply({ kind: 'shaft.removeCar', shaftId: 12345 });
    expect(seen.map((e) => e.kind)).toEqual(['log']); // the swap to a new world is not news
  });

  it('hears rent day from a tick batch that crosses into a new quarter', () => {
    const clock = { ms: 0 };
    const game = createGame(5, { now: () => clock.ms, scheduleIdle: () => () => {} });
    const seen: GameEvent[] = [];
    game.subscribeEvents((e) => seen.push(e));
    game.setSpeed(1);
    game.world.time.minute = 3 * 1440 - 1; // 23:59 on the last day of the first quarter
    clock.ms += 100;
    game.stepOnce();
    expect(game.world.time.minute).toBeGreaterThanOrEqual(3 * 1440);
    expect(seen.filter((e) => e.kind === 'rentDay')).toHaveLength(1);
  });
});
