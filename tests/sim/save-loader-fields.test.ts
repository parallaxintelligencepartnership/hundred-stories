// Fields the loader used to copy as they are (2026-09-28 audit, lane D S5 and S6): a game-over
// record with no minute or reason, car riders and calls that are not lists, and room scalars
// such as a venue's head count. Each is refused as damaged, naming the field.
import { describe, expect, it } from 'vitest';
import { addRoom, addShaft, createWorld } from '../../src/sim/world';
import { deserialize, serialize } from '../../src/sim/save';
import { ROOMS } from '../../src/sim/rules';
import type { Room, Shaft } from '../../src/sim/types';

type Data = Record<string, any>;

function room(overrides: Partial<Room>): Room {
  return {
    id: 1,
    kind: 'office',
    floor: 2,
    x: 100,
    width: 10,
    height: 1,
    eval: 0.8,
    tenants: [],
    occupancy: 0,
    builtAtMinute: 0,
    vacant: true,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    rent: 100,
    ...overrides,
  };
}

function shaft(): Shaft {
  return {
    id: 10,
    kind: 'standard',
    x: 150,
    width: 2,
    floorMin: 1,
    floorMax: 10,
    stops: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    homeFloor: 1,
    cars: [
      { id: 11, shaftId: 10, y: 1, dir: 0, state: 'idle', doorTimer: 0, idleSince: 0, passengers: [], calls: new Set([5]), serves: 'any', range: null },
    ],
    hallCalls: new Map(),
  };
}

function baseData(): Data {
  const world = createWorld(4242);
  addRoom(world, room({ id: 1, kind: 'lobby', floor: 1, x: 100, width: 40, vacant: false }));
  addRoom(world, room({ id: 2, kind: 'fastFood', floor: 2, x: 100, width: ROOMS.fastFood.width, vacant: false, occupancy: 3 }));
  addShaft(world, shaft());
  world.nextId = 20;
  return JSON.parse(serialize(world)) as Data;
}

function reasonAfter(change: (d: Data) => void): string {
  const d = baseData();
  change(d);
  const res = deserialize(JSON.stringify(d));
  return res.ok ? 'LOADED' : res.reason;
}

const damaged = (field: string): string => `This save is damaged and was not loaded. (${field})`;

describe('the sound file loads', () => {
  it('as built, and with a real game-over record', () => {
    expect(reasonAfter(() => {})).toBe('LOADED');
    expect(reasonAfter((d) => (d.gameOver = { at: 900, reason: 'The bank took the tower back.' }))).toBe('LOADED');
    expect(reasonAfter((d) => (d.shafts[0].cars[0].idleSince = null))).toBe('LOADED');
    expect(reasonAfter((d) => (d.rooms[0].lowEvalSinceMinute = 120))).toBe('LOADED');
  });
});

describe('S5: game-over record and car fields', () => {
  it('refuses a game-over record with no minute or reason', () => {
    expect(reasonAfter((d) => (d.gameOver = {}))).toBe(damaged('gameOver'));
    expect(reasonAfter((d) => (d.gameOver = { at: 900, reason: '' }))).toBe(damaged('gameOver'));
    expect(reasonAfter((d) => (d.gameOver = { at: 'x', reason: 'Gone.' }))).toBe(damaged('gameOver'));
    expect(reasonAfter((d) => (d.gameOver = { at: -1, reason: 'Gone.' }))).toBe(damaged('gameOver'));
  });

  it('refuses riders and calls that are not lists as damaged, naming the field', () => {
    expect(reasonAfter((d) => (d.shafts[0].cars[0].passengers = 5))).toBe(damaged('shafts[0].cars[0].passengers'));
    expect(reasonAfter((d) => (d.shafts[0].cars[0].passengers = ['a']))).toBe(damaged('shafts[0].cars[0].passengers'));
    expect(reasonAfter((d) => (d.shafts[0].cars[0].calls = 5))).toBe(damaged('shafts[0].cars[0].calls'));
    expect(reasonAfter((d) => (d.shafts[0].cars[0].calls = [2.5]))).toBe(damaged('shafts[0].cars[0].calls'));
  });

  it('refuses a bad direction, door timer or idle minute', () => {
    expect(reasonAfter((d) => (d.shafts[0].cars[0].dir = 2))).toBe(damaged('shafts[0].cars[0].dir'));
    expect(reasonAfter((d) => (d.shafts[0].cars[0].doorTimer = null))).toBe(damaged('shafts[0].cars[0].doorTimer'));
    expect(reasonAfter((d) => (d.shafts[0].cars[0].idleSince = 'x'))).toBe(damaged('shafts[0].cars[0].idleSince'));
  });
});

describe('S6: a room head count that is not a count', () => {
  const venue = (d: Data): Data => d.rooms.find((r: Data) => r.kind === 'fastFood');
  it('refuses a venue whose occupancy is text, an object, missing or negative', () => {
    expect(reasonAfter((d) => (venue(d).occupancy = 'x'))).toBe(damaged('rooms[1].occupancy'));
    expect(reasonAfter((d) => (venue(d).occupancy = {}))).toBe(damaged('rooms[1].occupancy'));
    expect(reasonAfter((d) => delete venue(d).occupancy)).toBe(damaged('rooms[1].occupancy'));
    expect(reasonAfter((d) => (venue(d).occupancy = -1))).toBe(damaged('rooms[1].occupancy'));
  });

  it('refuses the other room scalars the loader copies as they are', () => {
    expect(reasonAfter((d) => (venue(d).vacant = 'no'))).toBe(damaged('rooms[1].vacant'));
    expect(reasonAfter((d) => (venue(d).onFire = 1))).toBe(damaged('rooms[1].onFire'));
    expect(reasonAfter((d) => (venue(d).dirty = 'yes'))).toBe(damaged('rooms[1].dirty'));
    expect(reasonAfter((d) => delete venue(d).infested)).toBe(damaged('rooms[1].infested'));
    expect(reasonAfter((d) => (venue(d).builtAtMinute = null))).toBe(damaged('rooms[1].builtAtMinute'));
    expect(reasonAfter((d) => (venue(d).lowEvalSinceMinute = 'x'))).toBe(damaged('rooms[1].lowEvalSinceMinute'));
  });
});
