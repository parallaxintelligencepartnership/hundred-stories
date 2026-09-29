// Today's tower and a friend's tower each live in their own save slot, driven through the game
// api with the slots held in memory. My tower is never rewritten by either.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, DAILY_OVER_REASON } from '../../src/game/game';
import { DAILY_END_MINUTE, TIGHT_MONEY_CASH, dailyStart, dailyTwist } from '../../src/game/daily';
import { boot, bootTarget } from '../../src/main';
import { LIMITS } from '../../src/sim/rules';
import { buildLogOf } from '../../src/sim/buildlog';
import { verifySave } from '../../src/sim/replay';

const slots = vi.hoisted(() => new Map<string, string>());
// Slots whose read fails (the store could not be read, which is not "empty").
const failing = vi.hoisted(() => new Set<string>());
vi.mock('../../src/game/storage', () => ({
  writeSave: vi.fn(async (text: string) => {
    slots.set('mine', text);
  }),
  readSave: async () => slots.get('mine') ?? null,
  writeSlot: vi.fn(async (slot: string, text: string) => {
    slots.set(slot, text);
  }),
  readSlot: async (slot: string) => {
    if (failing.has(slot)) throw new Error('the store could not be read');
    return slots.get(slot) ?? null;
  },
  stashUnreadable: vi.fn(),
  readDailyRecord: () => {
    const text = slots.get('daily-record');
    return text ? JSON.parse(text) : null;
  },
  writeDailyRecord: (record: unknown) => {
    slots.set('daily-record', JSON.stringify(record));
    return true;
  },
}));

beforeEach(() => {
  slots.clear();
  failing.clear();
});

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A game on a hand driven clock: every stepOnce is one second of wall time. */
function gameOn(today: string, seed = 11) {
  let now = 0;
  const game = createGame(seed, {
    now: () => now,
    hidden: () => true,
    scheduleIdle: (run) => {
      run();
      return () => {};
    },
    today: () => today,
    freshSeed: () => 77,
  });
  const second = (): void => {
    now += 1000;
    game.stepOnce();
  };
  return { game, second };
}

// Tight money falls on this date and Normal day on the one before (pinned in daily.test.ts).
const TIGHT_DAY = '2026-09-28';

describe("today's tower", () => {
  it('starts the day\'s tower in its own slot and leaves My tower byte for byte unchanged', async () => {
    const { game, second } = gameOn(TIGHT_DAY);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 }).ok).toBe(true);
    await game.save();
    const mine = slots.get('mine');
    expect(mine).toBeTruthy();

    await game.openDaily();
    expect(game.getSlot()).toBe('daily');
    expect(game.world.seed).toBe(dailyStart(TIGHT_DAY));
    expect(game.world.cash).toBe(TIGHT_MONEY_CASH);
    expect(game.getDaily()).toMatchObject({ date: TIGHT_DAY, finished: false, twist: { name: 'Tight money' } });
    expect(game.getSpeed()).toBe(1);

    // Play the daily: build, run, save. My tower does not move.
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 }).ok).toBe(true);
    for (let i = 0; i < 5; i++) second();
    await game.save();
    expect(slots.get('mine')).toBe(mine);
    expect(slots.get('daily')).toBeTruthy();

    // One call back to My tower: the tower it saved, not the daily.
    await game.openMyTower();
    expect(game.getSlot()).toBe('mine');
    expect(game.getDaily()).toBe(null);
    expect(game.world.cash).toBe(JSON.parse(mine!).cash);
    expect(game.world.cash).toBeLessThan(LIMITS.startingCash); // the lobby it paid for
    expect(slots.get('mine')).toBe(mine);
  });

  it('saves My tower on the way out only when it moved, and then with its own tower', async () => {
    const { game, second } = gameOn(TIGHT_DAY);
    await game.save();
    second(); // My tower moves on
    const minute = game.world.time.minute;
    await game.openDaily();
    expect(JSON.parse(slots.get('mine')!).minute).toBe(minute);
    expect(JSON.parse(slots.get('mine')!).seed).toBe(11);
  });

  it('each slot carries its own build log, and a Tight money daily replays to the same world', async () => {
    const { game, second } = gameOn(TIGHT_DAY);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await game.save();
    await game.openDaily();
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 120 }).ok).toBe(true);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 }).ok).toBe(true);
    for (let i = 0; i < 20; i++) second();
    await game.save();
    expect(buildLogOf(game.world).start).toEqual({ cash: TIGHT_MONEY_CASH });
    expect(verifySave(slots.get('daily')!)).toMatchObject({ status: 'match', entries: 2 });
    expect(verifySave(slots.get('mine')!)).toMatchObject({ status: 'match', entries: 1 });
  });

  it('ends after eight game days: stops, keeps the result, refuses builds and a restart of the clock', async () => {
    const { game, second } = gameOn(TIGHT_DAY);
    await game.openDaily();
    game.world.time.minute = DAILY_END_MINUTE - 3; // 05:57, the night rate: 80 minutes a second
    second();
    expect(game.world.time.minute).toBe(DAILY_END_MINUTE); // not one tick past
    expect(game.getSpeed()).toBe(0);
    expect(game.getDaily()?.finished).toBe(true);
    await settle();
    expect(JSON.parse(slots.get('daily')!).minute).toBe(DAILY_END_MINUTE);
    game.setSpeed(1);
    expect(game.getSpeed()).toBe(0);
    second();
    expect(game.world.time.minute).toBe(DAILY_END_MINUTE);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 })).toEqual({ ok: false, reason: DAILY_OVER_REASON });
  });

  it("offers Finish yesterday's or Start today's for an unfinished daily from yesterday", async () => {
    const yesterday = gameOn('2026-09-27');
    await yesterday.game.openDaily();
    yesterday.game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await yesterday.game.save();

    const { game } = gameOn(TIGHT_DAY);
    await game.openDaily();
    expect(game.getDailyChoice()).toEqual({ savedDate: '2026-09-27', today: TIGHT_DAY, yesterday: true, ahead: false });
    expect(game.world.seed).toBe(dailyStart('2026-09-27'));
    expect(game.getSpeed()).toBe(0);
    game.setSpeed(1); // the choice stands until it is answered
    expect(game.getSpeed()).toBe(0);

    await game.chooseDaily('finish');
    expect(game.getDailyChoice()).toBe(null);
    expect(game.getDaily()?.date).toBe('2026-09-27');
    expect(game.getSpeed()).toBe(1);
  });

  it("Start today's begins today's tower fresh; a fresh start is only ever today's date", async () => {
    const yesterday = gameOn('2026-09-27');
    await yesterday.game.openDaily();
    await yesterday.game.save();

    const { game } = gameOn(TIGHT_DAY);
    await game.openDaily();
    await game.chooseDaily('today');
    expect(game.getDaily()).toMatchObject({ date: TIGHT_DAY, twist: { name: dailyTwist(TIGHT_DAY).name } });
    expect(game.world.seed).toBe(dailyStart(TIGHT_DAY));
    expect(JSON.parse(slots.get('daily')!).seed).toBe(dailyStart(TIGHT_DAY));
  });

  it('a finished daily from an earlier date gives way to today\'s with no question', async () => {
    const old = gameOn('2026-09-27');
    await old.game.openDaily();
    old.game.world.time.minute = DAILY_END_MINUTE - 1;
    old.second();
    await settle();

    const { game } = gameOn(TIGHT_DAY);
    await game.openDaily();
    expect(game.getDailyChoice()).toBe(null);
    expect(game.getDaily()?.date).toBe(TIGHT_DAY);
  });
});

// 2026-09-29 (Matt: "lock it"): moving the device's date back and forward never gives a second
// try at a Today's tower date. The record of dates played sits beside the daily slot.
describe("a Today's tower date already played", () => {
  async function finishDaily(date: string) {
    const played = gameOn(date);
    await played.game.openDaily();
    played.game.world.time.minute = DAILY_END_MINUTE - 1;
    played.second();
    await settle();
    expect(played.game.getDaily()?.finished).toBe(true);
    return played;
  }

  it('the date moved back to a finished day opens no fresh tower, and a boot link lands on My tower', async () => {
    const mine = gameOn('2026-09-27');
    mine.game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await mine.game.save();
    await finishDaily('2026-09-27');
    await finishDaily(TIGHT_DAY);
    const daily = slots.get('daily');

    const { game } = gameOn('2026-09-27'); // a fresh page, as from a ?daily link
    await game.openDaily();
    expect(game.getDailyChoice()).toMatchObject({ locked: 'clock-back', today: '2026-09-27' });
    expect(game.getSlot()).toBe('mine');
    expect(game.world.cash).toBe(JSON.parse(slots.get('mine')!).cash); // My tower, not the stand-in
    expect(game.world.cash).toBeLessThan(LIMITS.startingCash);
    expect(slots.get('daily')).toBe(daily); // the finished tower is untouched
    await game.chooseDaily('today'); // no way to start one, even asked
    expect(game.getSlot()).toBe('mine');
    expect(slots.get('daily')).toBe(daily);
    expect(game.getDailyChoice()).toBe(null);
  });

  it('forward then back: the later tower stands behind the card to keep playing, and today never starts', async () => {
    const later = gameOn('2026-09-29');
    await later.game.openDaily();
    later.game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await later.game.save();

    const { game } = gameOn(TIGHT_DAY);
    await game.openDaily();
    expect(game.getDailyChoice()).toEqual({ savedDate: '2026-09-29', today: TIGHT_DAY, yesterday: false, ahead: false, locked: 'clock-back' });
    expect(game.getDaily()?.date).toBe('2026-09-29');
    expect(game.getSpeed()).toBe(0);
    await game.chooseDaily('today');
    expect(game.getDaily()?.date).toBe('2026-09-29'); // kept, not replaced
    expect(game.getSpeed()).toBe(1);
    expect(JSON.parse(slots.get('daily')!).seed).toBe(dailyStart('2026-09-29'));
  });

  it('today finished and gone from the slot: done, and no second try', async () => {
    await finishDaily(TIGHT_DAY);
    slots.delete('daily');
    const { game } = gameOn(TIGHT_DAY);
    await game.openDaily();
    expect(game.getDailyChoice()).toMatchObject({ locked: 'done' });
    expect(game.getSlot()).toBe('mine');
    expect(slots.has('daily')).toBe(false);
  });

  it('the same date, finished and still in the slot, opens on its result as before', async () => {
    await finishDaily(TIGHT_DAY);
    const { game } = gameOn(TIGHT_DAY);
    await game.openDaily();
    expect(game.getDailyChoice()).toBe(null);
    expect(game.getDaily()).toMatchObject({ date: TIGHT_DAY, finished: true });
    expect(game.getSpeed()).toBe(0);
  });

  it('an older install with a finished daily and no record is locked from its first open', async () => {
    await finishDaily(TIGHT_DAY);
    slots.delete('daily-record'); // as before the record existed
    const daily = slots.get('daily');
    const { game } = gameOn('2026-09-27');
    await game.openDaily();
    expect(game.getDailyChoice()).toMatchObject({ locked: 'clock-back' });
    expect(slots.get('daily')).toBe(daily);
    expect(JSON.parse(slots.get('daily-record')!)).toEqual({ latest: TIGHT_DAY, finished: [TIGHT_DAY] });
  });

  it('a stand-in for a daily slot that would not read never writes the record, started or finished', async () => {
    // An earlier daily, unfinished, sits in the slot.
    const earlier = gameOn('2026-09-27');
    await earlier.game.openDaily();
    earlier.game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await earlier.game.save();
    const record = slots.get('daily-record');
    const daily = slots.get('daily');
    expect(JSON.parse(record!)).toEqual({ latest: '2026-09-27', finished: [] });

    failing.add('daily');
    const { game, second } = gameOn(TIGHT_DAY);
    await game.openDaily();
    expect(game.getDaily()).toMatchObject({ date: TIGHT_DAY, finished: false }); // the stand-in
    expect(slots.get('daily-record')).toBe(record);
    game.world.time.minute = DAILY_END_MINUTE - 1;
    second();
    await settle();
    expect(game.getDaily()?.finished).toBe(true);
    expect(slots.get('daily-record')).toBe(record);
    expect(slots.get('daily')).toBe(daily);

    // The slot reads again: the earlier tower is still on offer.
    failing.clear();
    const healthy = gameOn(TIGHT_DAY);
    await healthy.game.openDaily();
    const choice = healthy.game.getDailyChoice();
    expect(choice).toMatchObject({ savedDate: '2026-09-27', today: TIGHT_DAY, ahead: false });
    expect(choice?.locked).toBeUndefined();
  });

  it('a record dated years ahead (a clock set wrong once) does not lock today: latest comes back, finished dates stay', async () => {
    slots.set('daily-record', JSON.stringify({ latest: '2031-01-01', finished: ['2026-09-20', '2031-01-01'] }));
    const { game } = gameOn('2026-09-30');
    await game.openDaily();
    expect(game.getDailyChoice()).toBe(null);
    expect(game.getDaily()).toMatchObject({ date: '2026-09-30', finished: false });
    expect(JSON.parse(slots.get('daily-record')!)).toEqual({ latest: '2026-09-30', finished: ['2026-09-20', '2031-01-01'] });
  });

  it('a record one day ahead (another time zone) still waits', async () => {
    slots.set('daily-record', JSON.stringify({ latest: '2026-10-01', finished: [] }));
    const { game } = gameOn('2026-09-30');
    await game.openDaily();
    expect(game.getDailyChoice()).toMatchObject({ locked: 'clock-back' });
    expect(JSON.parse(slots.get('daily-record')!)).toEqual({ latest: '2026-10-01', finished: [] });
  });

  it('a daily the bank takes back is finished for the record too', async () => {
    const { game, second } = gameOn(TIGHT_DAY);
    await game.openDaily();
    // One bad quarter behind it, deep in debt, a minute before the next settle (day 3, 05:00).
    game.world.cash = -1_000_000;
    game.world.stats.badQuarterStreak = 1;
    game.world.time.minute = 3 * 1440 + 5 * 60 - 1;
    second();
    await settle();
    expect(game.world.gameOver).not.toBe(null);
    expect(JSON.parse(slots.get('daily-record')!).finished).toEqual([TIGHT_DAY]);
  });
});

describe("a friend's link", () => {
  it('reads ?seed=N as a friend\'s tower, ?daily as today\'s, anything else as My tower', () => {
    expect(bootTarget('?seed=4242')).toEqual({ kind: 'friend', seed: 4242 });
    expect(bootTarget('?daily=today')).toEqual({ kind: 'daily' });
    expect(bootTarget('?daily=2026-09-24')).toEqual({ kind: 'daily' });
    expect(bootTarget('')).toEqual({ kind: 'mine', fresh: false });
    expect(bootTarget('?new')).toEqual({ kind: 'mine', fresh: true });
    expect(bootTarget('?seed=abc')).toEqual({ kind: 'mine', fresh: false });
  });

  it('opens the same tower in the Friend slot and never touches My tower', async () => {
    const { game } = gameOn(TIGHT_DAY);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await game.save();
    const mine = slots.get('mine');

    await game.openFriend(4242);
    expect(game.getSlot()).toBe('friend');
    expect(game.world.seed).toBe(4242);
    expect(game.world.rooms.size).toBe(0);
    expect(JSON.parse(slots.get('friend')!).seed).toBe(4242);
    expect(slots.get('mine')).toBe(mine);

    // The same link again goes on with that tower; a different one starts over.
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await game.save();
    const other = gameOn(TIGHT_DAY);
    await other.game.openFriend(4242);
    expect(other.game.world.rooms.size).toBe(1);
    await other.game.openFriend(99);
    expect(other.game.world.seed).toBe(99);
    expect(other.game.world.rooms.size).toBe(0);
    expect(slots.get('mine')).toBe(mine);
  });

  it('boots a /play/?seed=N link into the Friend slot, with My tower left alone', async () => {
    slots.set('mine', 'my own tower');
    let booted: ReturnType<typeof createGame> | null = null;
    const app = { innerHTML: '', append: () => {} } as unknown as HTMLElement;
    await boot(app, {
      createRenderer: async () => ({}) as never,
      // The real game, with the renderer and the frame loop left out: node has neither.
      createGame: ((seed: number) => (booted = Object.assign(createGame(seed), { attach: () => {}, start: () => {} }))) as never,
      createUi: (() => ({ update: () => {} })) as never,
      createElement: () => ({ id: '' }) as unknown as HTMLElement,
      online: () => true,
      hasController: () => false,
      search: () => '?seed=4242',
    });
    expect(booted!.getSlot()).toBe('friend');
    expect(booted!.world.seed).toBe(4242);
    expect(slots.get('mine')).toBe('my own tower');
  });
});
