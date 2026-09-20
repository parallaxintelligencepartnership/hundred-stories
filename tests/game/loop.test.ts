// The clock loop: the tick time box, and the autosave that runs in an idle slot.
// Both are driven through injected clocks, so no real wall time and no real idle callback is needed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, drainTicks } from '../../src/game/game';
import { writeSave } from '../../src/game/storage';

// The browser save slot stands in as one in memory string, the same stand-in game.test.ts uses.
const slot = vi.hoisted(() => ({ text: null as string | null, refuse: false }));
vi.mock('../../src/game/storage', () => ({
  writeSave: vi.fn(async (text: string): Promise<void> => {
    if (slot.refuse) throw new Error('The browser refused to store the save.');
    slot.text = text;
  }),
  readSave: async (): Promise<string | null> => slot.text,
  stashUnreadable: vi.fn(),
}));

beforeEach(() => {
  slot.text = null;
  slot.refuse = false;
  vi.mocked(writeSave).mockClear();
});

/** Let the idle callback's save promise settle, the way game.test.ts waits on newGame's save. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('drainTicks', () => {
  it('drops the whole missed ticks and keeps the fraction when a tick is slow', () => {
    // 10 ms a tick against an 8 ms box: the first tick spends the whole budget.
    let ms = 0;
    const loop = { accumulator: 16.5 };
    let ticks = 0;
    const n = drainTicks(loop, () => {
      ticks++;
      ms += 10;
    }, () => ms);

    expect(n).toBe(1);
    expect(ticks).toBe(1);
    expect(loop.accumulator).toBeLessThan(1);
    expect(loop.accumulator).toBeCloseTo(0.5, 10); // the fraction survives, so the clock keeps its place
  });

  it('runs every earned tick when the ticks are fast', () => {
    const loop = { accumulator: 16.5 };
    let ticks = 0;
    const n = drainTicks(loop, () => ticks++, () => 0);

    expect(n).toBe(16);
    expect(ticks).toBe(16);
    expect(loop.accumulator).toBeCloseTo(0.5, 10);
  });

  it('runs all sixteen slow ticks without the time box, which is what the box prevents', () => {
    let ms = 0;
    const loop = { accumulator: 16.5 };
    let ticks = 0;
    const n = drainTicks(loop, () => {
      ticks++;
      ms += 10;
    }, () => ms, { maxTicks: 240, maxMs: Infinity });

    expect(n).toBe(16);
    expect(ticks).toBe(16);
  });

  it('stops at the tick cap and resets an accumulator that outran it', () => {
    const loop = { accumulator: 10_000 };
    let ticks = 0;
    const n = drainTicks(loop, () => ticks++, () => 0, { maxTicks: 240, maxMs: Infinity });

    expect(n).toBe(240);
    expect(ticks).toBe(240);
    expect(loop.accumulator).toBe(0);
  });
});

const MORNING = 6 * 60; // 06:00, the autosave boundary
const DAY = 1440;

/** A game on a clock the test winds by hand, with the idle slot captured instead of run. */
function gameOnATestClock() {
  const clock = { ms: 0 };
  const idle: { pending: Array<() => void>; cancels: number } = { pending: [], cancels: 0 };
  const game = createGame(11, {
    now: () => clock.ms,
    scheduleIdle: (run) => {
      idle.pending.push(run);
      return () => {
        idle.cancels++;
      };
    },
  });
  game.setSpeed(1);
  // 100 ms of wall time at 1x through the night is 8 ticks, enough to step over a 06:00 boundary.
  const stepOver = (morningMinute: number): void => {
    game.world.time.minute = morningMinute - 1;
    clock.ms += 100;
    game.stepOnce();
    expect(game.world.time.minute).toBeGreaterThan(morningMinute);
  };
  return { game, idle, stepOver };
}

describe('autosave through the idle slot', () => {
  it('writes the save when the idle callback runs, and not before', async () => {
    const { game, idle, stepOver } = gameOnATestClock();
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 })).toEqual({ ok: true });

    stepOver(MORNING + DAY); // 06:00 on day two

    expect(idle.pending).toHaveLength(1); // the step scheduled it
    expect(writeSave).not.toHaveBeenCalled(); // and wrote nothing inside the step itself

    idle.pending[0]!();
    await flush();

    expect(writeSave).toHaveBeenCalledTimes(1);
    expect(typeof vi.mocked(writeSave).mock.calls[0]![0]).toBe('string');
  });

  it('writes nothing while the idle slot never fires, and schedules no second save behind the first', async () => {
    const { idle, stepOver } = gameOnATestClock();

    stepOver(MORNING + DAY); // 06:00 on day two
    expect(idle.pending).toHaveLength(1);

    // The idle callback never runs, so that save is still in flight.
    stepOver(MORNING + 2 * DAY); // 06:00 on day three
    await flush();

    expect(idle.pending).toHaveLength(1); // the in flight guard held: no pile of writes
    expect(writeSave).not.toHaveBeenCalled();
  });
});
