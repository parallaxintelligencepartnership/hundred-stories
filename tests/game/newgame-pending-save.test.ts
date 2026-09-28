// New game while an idle save of the old tower is waiting (2026-09-28 audit, lane D S3): the old
// tower must not be written after the new one, or a reload brings it back.
import { afterEach, expect, it, vi } from 'vitest';

const data = new Map<string, string>();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  data.clear();
});

it('New game drops an idle save of the old tower that has not started', async () => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  });
  vi.resetModules();
  const { createGame } = await import('../../src/game/game');
  const idle: (() => void)[] = [];
  const game = createGame(11, {
    now: () => 0,
    hidden: () => true,
    scheduleIdle: (run: () => void) => {
      idle.push(run);
      return () => {
        const i = idle.indexOf(run);
        if (i >= 0) idle.splice(i, 1);
      };
    },
    today: () => '2026-09-28',
    freshSeed: () => 77,
  });
  game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
  await game.save();
  game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 151 });
  game.setSpeed(0); // pausing a moved tower asks for an idle save, not run yet
  expect(idle.length).toBeGreaterThan(0);
  game.newGame(12);
  await new Promise((r) => setTimeout(r, 0));
  for (const run of idle.splice(0)) run(); // the idle slot comes
  await new Promise((r) => setTimeout(r, 0));
  const stored = JSON.parse(data.get('hundred-stories:autosave')!) as { seed: number; rooms: unknown[] };
  expect(stored.seed).toBe(12);
  expect(stored.rooms.length).toBe(0);
});
