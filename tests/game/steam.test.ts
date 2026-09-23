// Steam achievements: the star to achievement map (kept in step with the Rust shell's table)
// and the report_star wiring from the game's event stream, driven with a stub Tauri global and
// a recording invoke.
import { describe, expect, it } from 'vitest';
import achievementsRs from '../../src-tauri/src/achievements.rs?raw';
import { createSteam, REPORT_STAR_COMMAND, STAR_ACHIEVEMENTS, type Invoke } from '../../src/steam/steam';
import type { GameEvent, GameEventListener } from '../../src/game/api';
import type { World } from '../../src/sim/types';

function fakeGame(stars: number): { world: World; subscribeEvents(l: GameEventListener): () => void; emit(e: GameEvent): void; listeners: Set<GameEventListener> } {
  const listeners = new Set<GameEventListener>();
  return {
    world: { stars } as unknown as World,
    listeners,
    subscribeEvents(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit(e) {
      for (const l of listeners) l(e);
    },
  };
}

function recorder(): { invoke: Invoke; calls: [string, { n: number }][] } {
  const calls: [string, { n: number }][] = [];
  return {
    calls,
    invoke: async (cmd, args) => {
      calls.push([cmd, args]);
    },
  };
}

const tauri = { __TAURI_INTERNALS__: {} };

describe('the achievement map', () => {
  it('maps the six stars to six distinct ids: FIRST_TOWER, then STAR_2 to STAR_6', () => {
    expect(STAR_ACHIEVEMENTS).toEqual({ 1: 'FIRST_TOWER', 2: 'STAR_2', 3: 'STAR_3', 4: 'STAR_4', 5: 'STAR_5', 6: 'STAR_6' });
    expect(new Set(Object.values(STAR_ACHIEVEMENTS)).size).toBe(6);
  });

  it('is the same table the Rust shell unlocks from', () => {
    const table = achievementsRs.slice(achievementsRs.indexOf('STAR_ACHIEVEMENTS'), achievementsRs.indexOf('];'));
    const pairs = [...table.matchAll(/\((\d), "([A-Z_0-9]+)"\)/g)].map((m) => [Number(m[1]), m[2]]);
    expect(pairs).toEqual(Object.entries(STAR_ACHIEVEMENTS).map(([n, id]) => [Number(n), id]));
  });
});

describe('createSteam', () => {
  it('is inert outside Tauri: no subscription and no call', () => {
    const game = fakeGame(3);
    const rec = recorder();
    createSteam(game, { global: {}, invoke: rec.invoke });
    createSteam(game, { global: { Capacitor: { isNativePlatform: () => true } }, invoke: rec.invoke });
    expect(game.listeners.size).toBe(0);
    expect(rec.calls).toEqual([]);
  });

  it('reports the current star at start, then each rise through report_star(n)', () => {
    const game = fakeGame(1);
    const rec = recorder();
    createSteam(game, { global: tauri, invoke: rec.invoke });
    game.emit({ kind: 'stars', from: 1, to: 2 });
    game.emit({ kind: 'rentDay' });
    game.emit({ kind: 'stars', from: 2, to: 3 });
    expect(rec.calls).toEqual([
      [REPORT_STAR_COMMAND, { n: 1 }],
      [REPORT_STAR_COMMAND, { n: 2 }],
      [REPORT_STAR_COMMAND, { n: 3 }],
    ]);
    expect(REPORT_STAR_COMMAND).toBe('report_star');
  });

  it('does not report a fall, nor a climb back to a star already reported', () => {
    const game = fakeGame(4);
    const rec = recorder();
    createSteam(game, { global: tauri, invoke: rec.invoke });
    game.emit({ kind: 'stars', from: 4, to: 3 });
    game.emit({ kind: 'stars', from: 3, to: 4 });
    game.emit({ kind: 'stars', from: 4, to: 5 });
    expect(rec.calls.map(([, a]) => a.n)).toEqual([4, 5]);
  });

  it('swallows a failed call, and the returned function unsubscribes', async () => {
    const game = fakeGame(1);
    const stop = createSteam(game, { global: tauri, invoke: async () => Promise.reject(new Error('command report_star not found')) });
    game.emit({ kind: 'stars', from: 1, to: 2 });
    await Promise.resolve();
    stop();
    expect(game.listeners.size).toBe(0);
  });
});
