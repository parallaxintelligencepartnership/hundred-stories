// A saved bomb's floor and x say where it goes off if a fire took its room. The loader used to
// read them unchecked, so a damaged save could log "The bomb went off on floor up" (audit
// 2026-09-28 sim review F2). Each is absent (an older save) or a whole number in range.
import { expect, it } from 'vitest';
import { deserialize, serialize } from '../../src/sim/save';
import { MAX_FLOOR, MIN_FLOOR, TOWER_WIDTH } from '../../src/sim/rules';
import { addRoom, createWorld } from '../../src/sim/world';
import type { Room } from '../../src/sim/types';

type Data = Record<string, any>;

function saved(bomb: Record<string, unknown>): Data {
  const world = createWorld(4242);
  addRoom(world, {
    id: 1, kind: 'lobby', floor: 1, x: 100, width: 40, height: 1, eval: 0.8, tenants: [], occupancy: 0, builtAtMinute: 0,
    vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  } as unknown as Room);
  world.nextId = 20;
  const d = JSON.parse(serialize(world)) as Data;
  d.events = [{ kind: 'bomb', roomId: 7, ransom: 300000, detonateAt: 780, found: false, ...bomb }];
  return d;
}

const load = (d: Data): string => {
  const res = deserialize(JSON.stringify(d));
  return res.ok ? 'LOADED' : res.reason;
};
const damaged = 'This save is damaged and was not loaded. (events[0])';

it('loads a bomb with a whole floor and x, or with neither (an older save)', () => {
  expect(load(saved({ floor: 2, x: 150 }))).toBe('LOADED');
  expect(load(saved({ floor: -3, x: 0 }))).toBe('LOADED');
  expect(load(saved({ floor: MAX_FLOOR, x: TOWER_WIDTH - 1 }))).toBe('LOADED');
  expect(load(saved({}))).toBe('LOADED');
});

it('refuses floor "up", a null x, and floors or tiles off the lot', () => {
  expect(load(saved({ floor: 'up', x: null }))).toBe(damaged);
  expect(load(saved({ floor: 'up', x: 150 }))).toBe(damaged);
  expect(load(saved({ floor: 2, x: null }))).toBe(damaged);
  expect(load(saved({ floor: 0, x: 150 }))).toBe(damaged);
  expect(load(saved({ floor: 2.5, x: 150 }))).toBe(damaged);
  expect(load(saved({ floor: MAX_FLOOR + 1, x: 150 }))).toBe(damaged);
  expect(load(saved({ floor: MIN_FLOOR - 1, x: 150 }))).toBe(damaged);
  expect(load(saved({ floor: 2, x: -1 }))).toBe(damaged);
  expect(load(saved({ floor: 2, x: TOWER_WIDTH }))).toBe(damaged);
  expect(load(saved({ floor: 2, x: 150.5 }))).toBe(damaged);
});
