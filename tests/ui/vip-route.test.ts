// The VIP checklist's route item (audit 2026-09-25, E2 S2) ticks when the VIP can really get
// from the lobby door to the suite the way the sim routes a hotel guest: stairs, escalators and a
// sky lobby transfer count, not only one car from floor 1. A suite with no way up stays unticked.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { EVENT_TEST_HOOKS, resetEventTestHooks } from '../../src/sim/events';
import { applyCommand } from '../../src/sim/build';
import { EVENTS, ROOMS } from '../../src/sim/rules';
import type { Command } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { vipView } from '../../src/ui/vip';
import { atOnDay, buildTower, lobbyRun } from '../scenarios/helpers';

beforeEach(() => {
  resetEventTestHooks();
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 1 };
});
afterEach(() => resetEventTestHooks());

/** Build the script; `tolerant` skips a refused filler command (a sky lobby tile over a gap, say). */
function booked(commands: Command[], tolerant = false) {
  const world = createWorld(11);
  world.stars = EVENTS.vip.minStar;
  world.cash = 1_000_000_000;
  if (tolerant) for (const cmd of commands) applyCommand(world, cmd);
  else buildTower(world, commands);
  atOnDay(world, 0, 6, 1);
  if (!world.events.some((e) => e.kind === 'vip')) throw new Error('no visit booked');
  return world;
}

const routeItem = (world: ReturnType<typeof createWorld>) => vipView(world)?.checklist?.[2];

it('stairs only: the VIP can walk up to the suite, so the item is done', () => {
  const world = booked([
    ...lobbyRun(90, 170),
    { kind: 'build', room: 'stairs', floor: 1, x: 100 },
    { kind: 'build', room: 'hotelSuite', floor: 2, x: 120 },
  ]);
  expect(world.shafts.size).toBe(0);
  expect(routeItem(world)).toEqual({ label: 'The VIP can get to floor 2', done: true });
});

it('no way up to the suite: the item stays unticked', () => {
  const world = booked([
    ...lobbyRun(90, 170),
    { kind: 'build', room: 'office', floor: 2, x: 120 },
    { kind: 'build', room: 'hotelSuite', floor: 3, x: 120 },
  ]);
  expect(routeItem(world)).toEqual({ label: 'The VIP can get to floor 3', done: false });
});

it('a sky lobby transfer reaches a suite above floor 31, and the item ticks', () => {
  const W = ROOMS.office.width;
  const commands: Command[] = [...lobbyRun(90, 200)];
  for (let f = 2; f <= 29; f += 1) for (let x = 90; x + W <= 200; x += W) commands.push({ kind: 'build', room: 'office', floor: f, x });
  for (let x = 90; x < 200; x += 1) commands.push({ kind: 'build', room: 'skyLobby', floor: 30, x });
  for (let f = 31; f <= 35; f += 1) for (let x = 90; x + W <= 200; x += W) commands.push({ kind: 'build', room: 'office', floor: f, x });
  commands.push({ kind: 'shaft.build', shaft: 'express', x: 150, floorMin: 1, floorMax: 30 });
  commands.push({ kind: 'shaft.build', shaft: 'standard', x: 170, floorMin: 30, floorMax: 37 });
  commands.push({ kind: 'build', room: 'hotelSuite', floor: 36, x: 90 });
  const world = booked(commands, true);
  expect([...world.shafts.values()].map((s) => `${s.kind} ${s.floorMin}-${s.floorMax}`)).toEqual(['express 1-30', 'standard 30-37']);
  expect([...world.rooms.values()].some((r) => r.kind === 'hotelSuite' && r.floor === 36)).toBe(true);
  expect(routeItem(world)).toEqual({ label: 'The VIP can get to floor 36', done: true });
});
