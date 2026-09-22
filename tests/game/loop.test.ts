// The clock loop: the tick time box, and the autosave that runs in an idle slot.
// Both are driven through injected clocks, so no real wall time and no real idle callback is needed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, drainTicks } from '../../src/game/game';
import { writeSave } from '../../src/game/storage';
import type { Renderer } from '../../src/render/renderer';

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

describe('drainTicks beforeLastTick', () => {
  it('calls the hook once, immediately before the tick that leaves the accumulator under one', () => {
    const loop = { accumulator: 5.25 };
    const events: string[] = [];
    let ticks = 0;
    const n = drainTicks(loop, () => events.push(`tick${++ticks}`), () => 0, {
      maxTicks: 240,
      maxMs: Infinity,
      beforeLastTick: () => events.push('hook'),
    });

    expect(n).toBe(5);
    expect(events).toEqual(['tick1', 'tick2', 'tick3', 'tick4', 'hook', 'tick5']);
  });

  it('calls the hook before the last tick the cap allows', () => {
    const loop = { accumulator: 10 };
    const events: string[] = [];
    let ticks = 0;
    drainTicks(loop, () => events.push(`tick${++ticks}`), () => 0, {
      maxTicks: 3,
      maxMs: Infinity,
      beforeLastTick: () => events.push('hook'),
    });

    expect(events).toEqual(['tick1', 'tick2', 'hook', 'tick3']);
  });

  it('does not call the hook when no tick runs', () => {
    let hooks = 0;
    const n = drainTicks({ accumulator: 0.9 }, () => {}, () => 0, {
      maxTicks: 240,
      maxMs: Infinity,
      beforeLastTick: () => hooks++,
    });

    expect(n).toBe(0);
    expect(hooks).toBe(0);
  });
});

const FRAME_MS = 16.667;

/**
 * A game on a hand wound clock whose visibility the test flips, with a stub renderer that records
 * every alpha it is handed and the world minute each time the game asks it to commit motion.
 */
function gameWithAFrameLoop(hidden: boolean) {
  const clock = { ms: 0, hidden };
  const game = createGame(11, {
    now: () => clock.ms,
    scheduleIdle: () => () => {},
    hidden: () => clock.hidden,
  });
  const alphas: number[] = [];
  const commits: number[] = [];
  const renderer = {
    render: (_w: unknown, alpha: number) => alphas.push(alpha),
    commitMotion: () => commits.push(game.world.time.minute),
    resetMotion: () => {},
    camera: { reset: () => {}, ensureFloorVisible: () => {} },
    setGhost: () => {},
    setSelection: () => {},
    onPick: () => {},
    setToolOwnsDrag: () => {},
    setReducedMotion: () => {},
    setChrome: () => {},
  } as unknown as Renderer;
  game.attach(renderer, { addEventListener: () => {} } as unknown as HTMLElement);
  /** Wind the clock one frame and run it; say how many ticks it ran. */
  const frame = (): number => {
    const before = game.world.time.minute;
    clock.ms += FRAME_MS;
    game.frameOnce();
    return game.world.time.minute - before;
  };
  return { game, clock, alphas, commits, frame };
}

describe('frame driven ticks', () => {
  it('runs 40 ticks in 60 frames at 4x by day, never two in a frame, with alpha in [0, 1)', () => {
    const { game, alphas, frame } = gameWithAFrameLoop(false);
    game.world.time.minute = 12 * 60; // noon: no night multiplier
    game.setSpeed(4);

    const batches: number[] = [];
    for (let i = 0; i < 60; i++) batches.push(frame());

    expect(batches.reduce((a, b) => a + b, 0)).toBe(40);
    expect(Math.max(...batches)).toBeLessThanOrEqual(1);
    expect(alphas).toHaveLength(60);
    for (const alpha of alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('commits motion once per frame with ticks, one minute before the batch ends, at night 4x', () => {
    const { game, commits, frame } = gameWithAFrameLoop(false);
    game.world.time.minute = 23 * 60 + 5; // just after 23:00: 320 ticks a second
    game.setSpeed(4);

    const batches: number[] = [];
    const finals: number[] = [];
    for (let i = 0; i < 12; i++) {
      batches.push(frame());
      finals.push(game.world.time.minute);
    }

    // 320 ticks a second is 5.33 a frame: every batch is five or six ticks, and both happen.
    for (const n of batches) expect([5, 6]).toContain(n);
    expect(batches).toContain(5);
    expect(batches).toContain(6);
    // One commit per frame, each taken with the world one minute short of where the frame ends.
    expect(commits).toEqual(finals.map((m) => m - 1));
  });

  it('lets the timer drive the sim while hidden, and not while visible', () => {
    const { game, clock } = gameWithAFrameLoop(true);
    game.world.time.minute = 12 * 60;
    game.setSpeed(1);

    const start = game.world.time.minute;
    for (let i = 0; i < 20; i++) {
      clock.ms += 50;
      game.stepOnce();
    }
    expect(game.world.time.minute - start).toBe(10);

    clock.hidden = false;
    const accumulator = game.accumulator();
    const minute = game.world.time.minute;
    clock.ms += 50;
    game.stepOnce();
    expect(game.world.time.minute).toBe(minute);
    expect(game.accumulator()).toBe(accumulator);
  });

  it('runs at most one tick on the first frame after a hidden second', () => {
    const { game, clock, frame } = gameWithAFrameLoop(true);
    game.world.time.minute = 12 * 60;
    game.setSpeed(1);
    for (let i = 0; i < 20; i++) {
      clock.ms += 50;
      game.stepOnce();
    }

    clock.hidden = false;
    expect(frame()).toBeLessThanOrEqual(1);
  });

  it('neither advances nor renders on a frame while hidden', () => {
    const { game, alphas, frame } = gameWithAFrameLoop(true);
    game.world.time.minute = 12 * 60;
    game.setSpeed(4);

    for (let i = 0; i < 10; i++) expect(frame()).toBe(0);
    expect(alphas).toHaveLength(0);
  });
});
