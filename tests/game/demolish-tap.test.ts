// Matt's playtest, 2026-09-28: with Demolish in hand, a tap on a single hotel room whose guest
// was drawn one tile in did nothing at all. The renderer's hit carries a person or a room, never
// both, and the person won. With a build tool in hand a tap is about the room at that tile; the
// Look tool (and no tool) still picks the person.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, structureAt } from '../../src/game/game';
import { pickTargetAt, type PickHit, type Renderer } from '../../src/render/renderer';
import { applyCommand } from '../../src/sim/build';
import { createWorld } from '../../src/sim/world';
import type { Room } from '../../src/sim/types';

vi.mock('../../src/game/storage', () => ({
  writeSave: async (): Promise<void> => {},
  readSave: async (): Promise<string | null> => null,
  writeSlot: async (): Promise<void> => {},
  readSlot: async (): Promise<string | null> => null,
  stashUnreadable: () => {},
}));

afterEach(() => vi.unstubAllGlobals());

function setup(): { game: ReturnType<typeof createGame>; room: Room; pick(hit: PickHit): void } {
  vi.stubGlobal('window', { addEventListener: () => {} });
  let onPick: ((hit: PickHit) => void) | null = null;
  const renderer = {
    render: () => {},
    camera: { centerOn: () => {}, ensureFloorVisible: () => {}, setGroundLine: () => {}, setObstruction: () => {}, reset: () => {} },
    screenToTile: () => ({ floor: 2, x: 0 }),
    setGhost: () => {},
    ghostScreenRect: () => null,
    setSelection: () => {},
    onPick: (cb: (hit: PickHit) => void) => {
      onPick = cb;
    },
    setPanEnabled: () => {},
    setToolOwnsDrag: () => {},
    setReducedMotion: () => {},
    setChrome: () => {},
    resetMotion: () => {},
    commitMotion: () => {},
    destroy: () => {},
  } as unknown as Renderer;
  const game = createGame(1);
  game.attach(renderer, { addEventListener: () => {} } as unknown as HTMLElement);
  game.world.cash = 10_000_000;
  game.world.stars = 3;
  for (let x = 90; x < 130; x += 1) game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
  expect(game.apply({ kind: 'build', room: 'hotelSingle', floor: 2, x: 110 }).ok).toBe(true);
  const room = [...game.world.rooms.values()].find((r) => r.kind === 'hotelSingle')!;
  return { game, room, pick: (hit) => onPick!(hit) };
}

describe('a tap with Demolish in hand over a drawn person', () => {
  it('a booked room: the tap reaches the room and is refused in words', () => {
    const { game, room, pick } = setup();
    room.occupancy = 1; // the guest is in
    game.setTool({ kind: 'demolish' });
    const before = game.world.logTotal;
    pick({ simId: 36, floor: 2, x: room.x + 1 });
    expect(game.world.logTotal).toBe(before + 1);
    expect(game.world.log.at(-1)?.text).toBe('People are inside.');
    expect(game.world.rooms.has(room.id)).toBe(true);
  });

  it('an empty room under a passing person: it is demolished', () => {
    const { game, room, pick } = setup();
    game.setTool({ kind: 'demolish' });
    pick({ simId: 36, floor: 2, x: room.x });
    expect(game.world.rooms.has(room.id)).toBe(false);
  });

  it('a person on a tile with no room or elevator: the same as a tap on that empty tile', () => {
    const { game, pick } = setup();
    game.setTool({ kind: 'demolish' });
    const rooms = game.world.rooms.size;
    const before = game.world.logTotal;
    pick({ simId: 36, floor: 2, x: 60 });
    pick({ floor: 2, x: 60 });
    expect([game.world.logTotal, game.world.rooms.size]).toEqual([before, rooms]);
  });

  it('the Look tool still picks the person', () => {
    const { game, room, pick } = setup();
    game.setTool({ kind: 'query' });
    pick({ simId: 36, floor: 2, x: room.x + 1 });
    expect(game.getSelection()).toEqual({ simId: 36 });
  });
});

describe('the structure at a tile', () => {
  it('follows the renderer pick on every tile: stairs over the lobby, a shaft over the rooms, rooms, nothing', () => {
    const world = createWorld(1);
    world.cash = 1e9;
    for (let x = 100; x < 140; x++) applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x });
    expect(applyCommand(world, { kind: 'build', room: 'office', floor: 2, x: 100 }).ok).toBe(true);
    expect(applyCommand(world, { kind: 'shaft.build', shaft: 'standard', x: 104, floorMin: 1, floorMax: 3 }).ok).toBe(true);
    expect(applyCommand(world, { kind: 'build', room: 'stairs', floor: 1, x: 120 }).ok).toBe(true);
    for (let floor = 0; floor <= 4; floor += 1) {
      for (let x = 90; x < 150; x += 1) expect(structureAt(world, floor, x)).toEqual(pickTargetAt(world, floor, x));
    }
  });

  // Review of 38f23ec, A1: the two branches that differ from a plain room lookup, an escalator
  // over the rooms behind it and two stair flights sharing a floor (the newer one wins), with
  // basements and a shaft from B1 up.
  it('follows the renderer pick with an escalator, stacked stair flights and basements', () => {
    const world = createWorld(1);
    world.cash = 1e10;
    world.stars = 5;
    const build = (cmd: Parameters<typeof applyCommand>[1]): boolean => applyCommand(world, cmd).ok;
    for (let x = 100; x < 160; x += 1) build({ kind: 'build', room: 'lobby', floor: 1, x });
    for (const floor of [2, 3, 4]) for (let x = 100; x < 160; x += 9) build({ kind: 'build', room: 'office', floor, x });
    for (const floor of [-1, -2]) for (let x = 100; x < 160; x += 4) build({ kind: 'build', room: 'parkingSpace', floor, x });
    expect(build({ kind: 'build', room: 'stairs', floor: 2, x: 110 })).toBe(true);
    expect(build({ kind: 'build', room: 'stairs', floor: 3, x: 110 })).toBe(true);
    expect(build({ kind: 'build', room: 'escalator', floor: 2, x: 130 })).toBe(true);
    expect(build({ kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: -1, floorMax: 4 })).toBe(true);
    build({ kind: 'build', room: 'stairs', floor: -1, x: 120 });
    const hit = new Set<string>();
    for (let floor = -3; floor <= 6; floor += 1) {
      for (let x = 80; x < 180; x += 1) {
        const at = structureAt(world, floor, x);
        expect(at).toEqual(pickTargetAt(world, floor, x));
        if (at?.roomId !== undefined) hit.add(`${world.rooms.get(at.roomId)!.kind}@${floor}`);
      }
    }
    // The scene really has what the rule is about: an escalator picked over the offices, and the
    // floor both flights share.
    expect(hit).toContain('escalator@2');
    expect(hit).toContain('stairs@3');
  });
});
