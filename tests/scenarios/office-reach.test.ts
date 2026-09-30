// Audit 2026-09-25 B S1, revised by the owner's rule of 2026-09-29: a car's rider setting
// means "those riders first", so an office whose only car is kept for hotel guests still
// leases, its workers riding when the car is free. An office nobody can reach at all (its
// only shaft demolished) is still an office nobody rents, and a lease that loses its way in ends.

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

describe('B S1: an office and the car that reaches it', () => {
  it('leases, and its workers ride, when the only car carries hotel guests first', () => {
    const { world, office } = officeTower();
    carriesOnly(world, 'hotel');
    const car = onlyShaft(world).cars[0];
    let workerRides = 0;
    const end = 12 * 60;
    while (world.time.minute < end) {
      runMinutes(world, 1);
      for (const id of car?.passengers ?? []) if (world.sims.get(id)?.kind === 'worker') workerRides++;
    }
    expect(office.vacant).toBe(false);
    expect(office.occupancy).toBeGreaterThan(0);
    expect(workerRides).toBeGreaterThan(0);
    expect(populationOf(world)).toBeGreaterThan(0);
  });

  it('stays leased over a day once its only car is given to hotel guests after the lease', () => {
    const { world, office } = officeTower();
    atOnDay(world, 0, 12);
    expect(office.vacant).toBe(false);
    carriesOnly(world, 'hotel');
    runMinutes(world, EVAL.leaveAfterMinutes + 1440);
    expect(office.vacant).toBe(false);
    expect(office.tenants.length).toBeGreaterThan(0);
    expect(world.log.some((e) => /no way in/.test(e.text))).toBe(false);
  });

  it('is vacated once its only shaft is demolished after the lease', () => {
    const { world, office } = officeTower();
    atOnDay(world, 0, 12);
    expect(office.vacant).toBe(false);
    const result = applyCommand(world, { kind: 'shaft.demolish', shaftId: onlyShaft(world).id });
    expect(result.ok).toBe(true);
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
