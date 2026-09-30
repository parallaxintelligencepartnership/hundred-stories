// The clock loop: the tick time box, and the autosave that runs in an idle slot.
// Both are driven through injected clocks, so no real wall time and no real idle callback is needed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  it('stops at the box when a tick is slow, and carries the ticks it could not run to the next drain', () => {
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
    expect(loop.accumulator).toBeCloseTo(15.5, 10); // package P3 F4: carried, not dropped
  });

  it('runs a cut batch\'s leftover on the next drain and drops what that drain cannot run', () => {
    let ms = 0;
    let cost = 10;
    const tick = (): void => {
      ms += cost;
    };
    const loop: { accumulator: number; carried?: number } = { accumulator: 6.5 };
    expect(drainTicks(loop, tick, () => ms)).toBe(1); // cut by the box: 5 whole ticks carried
    expect(loop.accumulator).toBeCloseTo(5.5, 10);

    // The next drain is cut again after one tick: the 4 carried ticks it could not run are dropped,
    // and only the ticks this drain earned (2) wait for the one after.
    loop.accumulator += 2;
    expect(drainTicks(loop, tick, () => ms)).toBe(1);
    expect(loop.accumulator).toBeCloseTo(2.5, 10);

    // Load lifts: the drain after runs what the last one carried, and nothing older.
    cost = 0;
    expect(drainTicks(loop, tick, () => ms)).toBe(2);
    expect(loop.accumulator).toBeCloseTo(0.5, 10);
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
  const resets: unknown[] = [];
  const renderer = {
    render: (_w: unknown, alpha: number) => alphas.push(alpha),
    commitMotion: () => commits.push(game.world.time.minute),
    resetMotion: () => resets.push(game.world),
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
  return { game, clock, alphas, commits, resets, frame };
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

/**
 * start() and stop() with the browser globals stubbed: the 50 ms timer, the frame request and the
 * visibilitychange listener are recorded so the test can fire and inspect them.
 */
function stubBrowserLoop() {
  const listeners = new Map<string, () => void>();
  const removed: string[] = [];
  const cleared: number[] = [];
  const cancelled: number[] = [];
  const intervals: { id: number; ms: number }[] = [];
  vi.stubGlobal('window', {
    setInterval: (_fn: () => void, ms: number) => {
      intervals.push({ id: 7, ms });
      return 7;
    },
    clearInterval: (id: number) => cleared.push(id),
  });
  vi.stubGlobal('document', {
    hidden: true,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string, fn: () => void) => {
      if (listeners.get(type) === fn) removed.push(type);
    },
  });
  vi.stubGlobal('requestAnimationFrame', () => 3);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => cancelled.push(id));
  return { listeners, removed, cleared, cancelled, intervals };
}

// Package P3 F4: the 8 ms time box used to cut a batch after the tick that crossed it, before the
// hook that snapshots motion had run, and drop the missed ticks. At 3 ms a tick at 4x night every
// frame ended with no snapshot, so walkers lerped from a stale point or snapped. Here the tick's
// cost is on the injected clock: each game minute the frame runs moves it TICK_MS on.
describe('a batch the time box cuts', () => {
  function slowTicks(tickMs: number) {
    const clock = { ms: 0, base: 0 };
    const holder: { game: ReturnType<typeof createGame> | null } = { game: null };
    const game = createGame(11, {
      now: () => clock.ms + tickMs * (holder.game ? holder.game.world.time.minute - clock.base : 0),
      scheduleIdle: () => () => {},
      hidden: () => false,
    });
    holder.game = game;
    const commits: number[] = [];
    const renderer = {
      render: () => {},
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
    /** One frame: the ticks it ran, and the minute of the last snapshot it took (null for none). */
    const frame = (): { ran: number; final: number; snapshot: number | null } => {
      clock.base = game.world.time.minute;
      clock.ms += FRAME_MS;
      const before = commits.length;
      game.frameOnce();
      const final = game.world.time.minute;
      return { ran: final - clock.base, final, snapshot: commits.length > before ? commits[commits.length - 1]! : null };
    };
    return { game, frame };
  }

  it('leaves a consistent motion snapshot on every frame at 3 ms a tick at 4x night, and keeps no backlog', () => {
    const { game, frame } = slowTicks(3);
    game.world.time.minute = 23 * 60 + 5; // 5.33 ticks earned a frame
    game.setSpeed(4);
    let ran = 0;
    for (let i = 0; i < 60; i++) {
      const f = frame();
      ran += f.ran;
      expect(f.ran, `frame ${i}`).toBeGreaterThan(0);
      // The pair the renderer lerps across is at most the frame's last tick: taken before it, or,
      // when a tick ran long past the box, right after it (no lerp, and never a stale point).
      expect(f.snapshot, `frame ${i}`).not.toBeNull();
      expect(f.final - f.snapshot!, `frame ${i}`).toBeLessThanOrEqual(1);
    }
    // The box still holds each frame to about 8 ms (three 3 ms ticks). What it could not run waits
    // for the next frame only, so the backlog never passes one frame's earnings (5.33) and a carry.
    expect(ran).toBe(180);
    expect(game.accumulator()).toBeLessThan(7);
  });

  it('still snapshots when a single tick runs past the box', () => {
    const { game, frame } = slowTicks(12);
    game.world.time.minute = 23 * 60 + 5;
    game.setSpeed(4);
    for (let i = 0; i < 10; i++) {
      const f = frame();
      expect(f.ran).toBe(1);
      expect(f.snapshot).not.toBeNull();
      expect(f.final - f.snapshot!).toBeLessThanOrEqual(1);
    }
  });
});

describe('start and stop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts the 50 ms timer and the visibility listener, and stop takes both away', () => {
    const stubs = stubBrowserLoop();
    const { game } = gameWithAFrameLoop(true);

    game.start();
    expect(stubs.intervals).toEqual([{ id: 7, ms: 50 }]);
    expect(stubs.listeners.has('visibilitychange')).toBe(true);

    game.stop();
    expect(stubs.removed).toEqual(['visibilitychange']);
    expect(stubs.cleared).toEqual([7]);
    expect(stubs.cancelled).toEqual([3]);
  });

  it('coming back after a stalled hidden stretch runs at most one tick on the first frame', () => {
    const stubs = stubBrowserLoop();
    const { game, clock, frame } = gameWithAFrameLoop(true);
    game.world.time.minute = 12 * 60;
    game.setSpeed(4);
    game.start();

    // A throttled hidden tab: the timer never fires for 30 s, then the tab is shown again.
    clock.ms += 30_000;
    clock.hidden = false;
    stubs.listeners.get('visibilitychange')?.();

    expect(frame()).toBeLessThanOrEqual(1);
    game.stop();
  });
});

describe('motion resets when the world is replaced', () => {
  it('resets motion on import and on a new game, with the new world already in place', () => {
    const { game, resets } = gameWithAFrameLoop(true);
    const text = game.exportSave();

    expect(game.importSave(text)).toEqual({ ok: true });
    expect(resets).toEqual([game.world]);

    game.newGame(5);
    expect(resets).toHaveLength(2);
    expect(resets[1]).toBe(game.world);
  });

  it('keeps motion when an import is refused', () => {
    const { game, resets } = gameWithAFrameLoop(true);
    expect(game.importSave('not a save').ok).toBe(false);
    expect(resets).toHaveLength(0);
  });
});

// Package P3 fix round, I1: the ticks a cut batch carries had outlived pause, a speed change, New
// game and a hidden tab, and ran as a burst of up to 74 game minutes in one frame once the load
// lifted. The backlog is built here at 3 ms a tick at 4x night (5.33 ticks earned a frame, three
// run), then the load lifts to nothing and the player acts.
describe('a carried backlog', () => {
  function loadedGame() {
    const clock = { ms: 0, base: 0, tickMs: 3, hidden: false };
    const holder: { game: ReturnType<typeof createGame> | null } = { game: null };
    const game = createGame(11, {
      now: () => clock.ms + clock.tickMs * (holder.game ? holder.game.world.time.minute - clock.base : 0),
      scheduleIdle: () => () => {},
      hidden: () => clock.hidden,
    });
    holder.game = game;
    const renderer = {
      render: () => {},
      commitMotion: () => {},
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
    const frame = (): number => {
      clock.base = game.world.time.minute;
      clock.ms += FRAME_MS;
      game.frameOnce();
      return game.world.time.minute - clock.base;
    };
    /** Sixty overloaded frames at 4x night, then the load lifts. */
    const buildBacklog = (): void => {
      game.world.time.minute = 23 * 60 + 5;
      clock.base = game.world.time.minute; // the injected clock does not jump with the minute set
      game.setSpeed(4);
      for (let i = 0; i < 60; i++) frame();
      clock.tickMs = 0;
    };
    return { game, clock, frame, buildBacklog };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs no burst when the player picks 1x after a backlog', () => {
    const { game, frame, buildBacklog } = loadedGame();
    buildBacklog();
    game.setSpeed(1);
    expect(frame()).toBeLessThanOrEqual(2); // 1x night earns 1.33 a frame
  });

  it('runs no burst on Resume after a pause', () => {
    const { game, frame, buildBacklog } = loadedGame();
    buildBacklog();
    game.setSpeed(0);
    for (let i = 0; i < 30; i++) expect(frame()).toBe(0);
    game.setSpeed(4);
    expect(frame()).toBeLessThanOrEqual(6); // 4x night earns 5.33 a frame
  });

  it('runs none of the old tower\'s backlog on a New game', () => {
    const { game, frame, buildBacklog } = loadedGame();
    buildBacklog();
    game.newGame(5);
    const start = game.world.time.minute;
    expect(frame()).toBeLessThanOrEqual(1); // 4x by day earns 0.67 a frame
    for (let i = 0; i < 9; i++) frame();
    expect(game.world.time.minute - start).toBeLessThanOrEqual(7);
  });

  it('runs no burst when the tab becomes visible again', () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('window', { setInterval: () => 7, clearInterval: () => {} });
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: () => {},
    });
    vi.stubGlobal('requestAnimationFrame', () => 3);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const { game, clock, frame, buildBacklog } = loadedGame();
    game.world.time.minute = 23 * 60 + 5;
    clock.base = game.world.time.minute;
    game.start();
    buildBacklog();
    clock.hidden = true;
    listeners.get('visibilitychange')?.();
    clock.hidden = false;
    listeners.get('visibilitychange')?.();
    expect(frame()).toBeLessThanOrEqual(6);
    game.stop();
  });

  it('runs a cut batch\'s leftover on the next frame', () => {
    const { game, clock, frame } = loadedGame();
    game.world.time.minute = 23 * 60 + 5;
    clock.base = game.world.time.minute;
    game.setSpeed(4);
    expect(frame()).toBe(3); // cut by the box: two whole ticks carried
    clock.tickMs = 0;
    const next = frame(); // the carried two plus this frame's 5.33
    expect(next).toBeGreaterThanOrEqual(7);
    expect(next).toBeLessThanOrEqual(8);
  });

  it('drops a carried tick the next frame could not run, so nothing older runs later', () => {
    const { frame, buildBacklog } = loadedGame();
    buildBacklog(); // sixty cut frames, then the load lifts
    // At most the last cut batch's leftover (under 6) and this frame's 5.33, then normal frames.
    expect(frame()).toBeLessThanOrEqual(12);
    for (let i = 0; i < 5; i++) expect(frame()).toBeLessThanOrEqual(6);
  });
});
