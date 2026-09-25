/**
 * Demolishing a room with a fire or a bomb in it is refused (audit 2026-09-25, A S1 / C S3 /
 * new S3 and A S2 / C S4, decision 1). The fire keeps burning and ends the normal way, with its
 * damage charged; the bomb stays in its own room and goes off there, not in the oldest rooms.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { EVENT_TEST_HOOKS, resetEventTestHooks, startBomb, startFire } from '../../src/sim/events';
import { EVENTS } from '../../src/sim/rules';
import { tick } from '../../src/sim/tick';
import { clockOf } from '../../src/sim/types';
import type { Room, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { buildTower } from './helpers';

function tower(security: boolean): World {
  const world = createWorld(7);
  world.cash = 60_000_000;
  world.stars = 3;
  const script: Parameters<typeof buildTower>[1][number][] = [];
  for (let x = 100; x < 200; x++) script.push({ kind: 'build', room: 'lobby', floor: 1, x });
  script.push({ kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 6 });
  for (let f = 2; f <= 5; f++) {
    for (let x = 100; x + 9 <= 200; x += 9) script.push({ kind: 'build', room: 'office', floor: f, x });
  }
  if (security) script.push({ kind: 'build', room: 'security', floor: 6, x: 100 });
  buildTower(world, script);
  return world;
}

function officeAt(world: World, floor: number, x: number): Room {
  const room = [...world.rooms.values()].find((r) => r.kind === 'office' && r.floor === floor && r.x === x);
  if (!room) throw new Error(`no office on floor ${floor} at x ${x}`);
  return room;
}

beforeEach(() => {
  resetEventTestHooks();
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 0, theft: 0 };
});
afterEach(() => resetEventTestHooks());

describe('demolish while a fire or a bomb is in the room', () => {
  it('refuses to demolish a burning room; the fire burns on, ends, and its damage is charged', () => {
    const world = tower(true);
    const target = officeAt(world, 5, 190); // top floor: nothing rests on it
    EVENT_TEST_HOOKS.target.fire = target.id;
    startFire(world);
    expect(target.onFire).toBe(true);

    expect(applyCommand(world, { kind: 'demolish', roomId: target.id })).toEqual({
      ok: false,
      reason: 'Put the fire out first.',
    });
    expect(world.rooms.has(target.id)).toBe(true);
    expect(world.events.some((e) => e.kind === 'fire')).toBe(true);

    let guard = 0;
    while (world.events.some((e) => e.kind === 'fire') && guard++ < 600) tick(world);
    expect(world.events.some((e) => e.kind === 'fire')).toBe(false);
    expect(world.rooms.has(target.id)).toBe(false);
    const end = world.log.map((l) => l.text).find((t) => t.startsWith('Security put the fire out.'));
    expect(end).toBeDefined();
    const lost = Number(/(\d+) rooms? burned down/.exec(end ?? '')?.[1]);
    expect(lost).toBeGreaterThanOrEqual(1);
    const charge = (lost * EVENTS.fire.damagePerRoom).toLocaleString('en-US');
    expect(end).toContain(`clearing the damage cost $${charge}.`);
  });

  it('refuses to demolish the bomb room; at 13:00 the bomb goes off there, not in the oldest rooms', () => {
    const world = tower(false);
    const target = officeAt(world, 5, 127);
    EVENT_TEST_HOOKS.target.bomb = target.id;
    startBomb(world);
    expect(world.events.some((e) => e.kind === 'bomb')).toBe(true);

    expect(applyCommand(world, { kind: 'demolish', roomId: target.id })).toEqual({
      ok: false,
      reason: 'Deal with the bomb first.',
    });
    expect(world.rooms.has(target.id)).toBe(true);

    const before = new Map([...world.rooms.values()].map((r) => [r.id, r]));
    const cash = world.cash;
    while (clockOf(world.time.minute).minuteOfDay !== 13 * 60 + 1) tick(world);

    expect(world.events.some((e) => e.kind === 'bomb')).toBe(false);
    const destroyed = [...before.values()].filter((r) => !world.rooms.has(r.id));
    // The bomb rule itself: its own room and the nearest ones, all on the bomb's floor here.
    expect(destroyed).toHaveLength(EVENTS.bomb.damageRooms);
    expect(destroyed.map((r) => r.id)).toContain(target.id);
    expect(destroyed.every((r) => r.floor === 5 && r.kind === 'office')).toBe(true);
    expect(world.rooms.size).toBe(before.size - EVENTS.bomb.damageRooms);
    expect(world.cash).toBe(cash - EVENTS.bomb.damageCash);
    expect(world.log.some((l) => l.text.startsWith('The bomb went off on floor 5.'))).toBe(true);
  });

  it('still demolishes an empty room that is not burning while a fire burns elsewhere', () => {
    const world = tower(true);
    const burning = officeAt(world, 5, 190);
    EVENT_TEST_HOOKS.target.fire = burning.id;
    startFire(world);
    const other = officeAt(world, 5, 154);
    expect(other.occupancy).toBe(0);
    expect(applyCommand(world, { kind: 'demolish', roomId: other.id })).toEqual({ ok: true });
  });
});
