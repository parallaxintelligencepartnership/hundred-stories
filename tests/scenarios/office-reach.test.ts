// Audit 2026-09-25 B S1: an office only its workers' cars can reach is an office nobody
// rents. Leasing asks the rider-class question, and a lease whose only car is later given
// to hotel guests ends, because its workers can no longer get in.

import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { EVAL } from '../../src/sim/rules';
import { populationOf } from '../../src/sim/stars';
import type { Room, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { atOnDay, buildTower, lobbyRun, onlyShaft, runMinutes } from './helpers';

function officeTower(): { world: World; office: Room } {
  const world = createWorld(11);
  world.cash = 50_000_000;
  buildTower(world, [
    ...lobbyRun(100, 159),
    { kind: 'build', room: 'office', floor: 2, x: 100 },
    { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 2 },
  ]);
  const office = [...world.rooms.values()].find((r) => r.kind === 'office') as Room;
  return { world, office };
}

function carriesOnly(world: World, serves: 'hotel' | 'office' | 'any'): void {
  const shaft = onlyShaft(world);
  const car = shaft.cars[0];
  if (!car) throw new Error('no car');
  const result = applyCommand(world, { kind: 'shaft.setCarServes', shaftId: shaft.id, carId: car.id, serves });
  expect(result.ok).toBe(true);
}

describe('B S1: an office its workers cannot reach', () => {
  it('stays vacant and adds no population when the only car carries hotel guests', () => {
    const { world, office } = officeTower();
    carriesOnly(world, 'hotel');
    atOnDay(world, 0, 12); // a whole weekday morning, arrivals included
    expect(office.vacant).toBe(true);
    expect(office.tenants).toHaveLength(0);
    expect(populationOf(world)).toBe(0);
  });

  it('is vacated once its only car is given to hotel guests after the lease', () => {
    const { world, office } = officeTower();
    atOnDay(world, 0, 12);
    expect(office.vacant).toBe(false);
    expect(office.occupancy).toBeGreaterThan(0);
    carriesOnly(world, 'hotel');
    runMinutes(world, EVAL.leaveAfterMinutes + 1440);
    expect(office.vacant).toBe(true);
    expect(office.tenants).toHaveLength(0);
    expect(populationOf(world)).toBe(0);
    expect(world.log.some((e) => e.text === 'The office on floor 2 had no way in, so its tenants moved out.')).toBe(true);
  });

  it('keeps an office whose car carries everyone leased (control)', () => {
    const { world, office } = officeTower();
    atOnDay(world, 1, 12);
    expect(office.vacant).toBe(false);
    expect(populationOf(world)).toBeGreaterThan(0);
  });
});
