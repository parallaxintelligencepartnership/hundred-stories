// A lobby painted by pointer drag goes through the same door as every other command: it is
// marked unsaved (so pagehide and a slot switch write it, even with the clock paused), it is in
// the build log (so the save replays), and it is refused once Today's tower is over.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../src/game/game';
import { DAILY_END_MINUTE } from '../../src/game/daily';
import type { Renderer } from '../../src/render/renderer';
import { buildLogOf } from '../../src/sim/buildlog';
import { verifySave } from '../../src/sim/replay';

const slots = vi.hoisted(() => new Map<string, string>());
vi.mock('../../src/game/storage', () => ({
  writeSave: vi.fn(async (text: string) => {
    slots.set('mine', text);
  }),
  readSave: async () => slots.get('mine') ?? null,
  writeSlot: vi.fn(async (slot: string, text: string) => {
    slots.set(slot, text);
  }),
  readSlot: async (slot: string) => slots.get(slot) ?? null,
  stashUnreadable: vi.fn(),
  readDailyRecord: () => null,
  writeDailyRecord: () => true,
}));

type Handler = (event: unknown) => void;
const windowHandlers = new Map<string, Handler>();

beforeEach(() => {
  slots.clear();
  windowHandlers.clear();
  vi.stubGlobal('window', {
    setInterval: () => 7,
    clearInterval: () => {},
    addEventListener: (type: string, fn: Handler) => windowHandlers.set(type, fn),
    removeEventListener: () => {},
  });
  vi.stubGlobal('document', { hidden: true, addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal('requestAnimationFrame', () => 3);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Eight screen pixels to the tile, everything on floor 1. */
function fakeRenderer(): Renderer {
  return {
    render: () => {},
    commitMotion: () => {},
    camera: { centerOn: () => {}, ensureFloorVisible: () => {}, setGroundLine: () => {}, setObstruction: () => {}, reset: () => {} },
    screenToTile: (sx: number) => ({ floor: 1, x: Math.floor(sx / 8) }),
    setGhost: () => {},
    ghostScreenRect: () => null,
    setSelection: () => {},
    onPick: () => {},
    setPanEnabled: () => {},
    setToolOwnsDrag: () => {},
    setReducedMotion: () => {},
    setChrome: () => {},
    resetMotion: () => {},
    destroy: () => {},
  } as unknown as Renderer;
}

/**
 * A started game whose idle saves never come: only pagehide or a slot switch can write, so a
 * write proves the tower was marked unsaved.
 */
function started() {
  let now = 0;
  const game = createGame(11, {
    now: () => now,
    hidden: () => true,
    scheduleIdle: () => () => {},
    today: () => '2026-09-28',
    freshSeed: () => 77,
  });
  const handlers = new Map<string, Handler[]>();
  const el = {
    addEventListener: (type: string, fn: Handler) => handlers.set(type, [...(handlers.get(type) ?? []), fn]),
  } as unknown as HTMLElement;
  const fire = (type: string, x: number): void => {
    const ev = { button: 0, offsetX: x * 8, offsetY: 50, clientX: x * 8, clientY: 50, pointerId: 1, pointerType: 'mouse', timeStamp: 0 };
    for (const fn of handlers.get(type) ?? []) fn(ev);
  };
  game.attach(fakeRenderer(), el);
  game.start();
  const second = (): void => {
    now += 1000;
    game.stepOnce();
  };
  /** Drag the lobby tool from tile `from` to tile `to`, with one move on the way. */
  const drag = (from: number, to: number): void => {
    game.setTool({ kind: 'room', room: 'lobby' });
    fire('pointerdown', from);
    fire('pointermove', Math.floor((from + to) / 2));
    fire('pointermove', to);
    fire('pointerup', to);
  };
  return { game, drag, second };
}

const roomsIn = (text: string | undefined): number => JSON.parse(text!).rooms.length;

describe('a lobby dragged while paused', () => {
  it('is saved by pagehide: 11 tiles in hand, 11 on disk, and the save replays', async () => {
    const { game, drag } = started();
    await game.save();
    expect(roomsIn(slots.get('mine'))).toBe(0);
    game.setSpeed(0);
    drag(100, 110);
    expect(game.world.rooms.size).toBe(11);
    expect(buildLogOf(game.world).entries.length).toBe(11);

    windowHandlers.get('pagehide')!({});
    await settle();
    expect(roomsIn(slots.get('mine'))).toBe(11);
    expect(verifySave(slots.get('mine')!)).toMatchObject({ status: 'match', entries: 11 });
    game.stop();
  });

  it("survives Today's tower and back: My tower loads with 11 rooms", async () => {
    const { game, drag } = started();
    await game.save();
    game.setSpeed(0);
    drag(100, 110);
    await game.openDaily();
    await game.openMyTower();
    expect(game.getSlot()).toBe('mine');
    expect(game.world.rooms.size).toBe(11);
    expect(roomsIn(slots.get('mine'))).toBe(11);
    game.stop();
  });
});

describe("a lobby dragged after Today's tower ends", () => {
  it('places nothing, spends nothing and records nothing', async () => {
    const { game, drag, second } = started();
    await game.openDaily();
    game.world.time.minute = DAILY_END_MINUTE - 1;
    second();
    expect(game.getDaily()?.finished).toBe(true);
    const rooms = game.world.rooms.size;
    const cash = game.world.cash;
    const entries = buildLogOf(game.world).entries.length;
    drag(100, 109);
    expect(game.world.rooms.size).toBe(rooms);
    expect(game.world.cash).toBe(cash);
    expect(buildLogOf(game.world).entries.length).toBe(entries);
    game.stop();
  });
});
