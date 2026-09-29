// Decision 2026-09-28: the evening rush is spread. Workers leave between 4:30 and 7:30 PM, each
// office at its own quitting time drawn once at the lease, its workers within a few minutes of
// it, so a big office tower empties in waves across three hours instead of one spike at five.

import { describe, expect, it } from 'vitest';

import { ROOMS, SCHEDULES } from '../../src/sim/rules';
import type { Command, Room, Sim } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { atOnDay, buildTower, lobbyRun, runMinutes } from './helpers';

const FLOORS = [2, 3, 4, 5];
const PER_FLOOR = 5;
const WIDTH = ROOMS.office.width;

function twentyOffices() {
  const world = createWorld(20260928);
  world.cash = 50_000_000;
  const script: Command[] = [...lobbyRun(100, 100 + PER_FLOOR * WIDTH + 12)];
  for (const floor of FLOORS) for (let i = 0; i < PER_FLOOR; i++) script.push({ kind: 'build', room: 'office', floor, x: 100 + i * WIDTH });
  const shaftX = 100 + PER_FLOOR * WIDTH + 4;
  script.push({ kind: 'shaft.build', shaft: 'standard', x: shaftX, floorMin: 1, floorMax: 5 });
  script.push({ kind: 'shaft.build', shaft: 'standard', x: shaftX + 4, floorMin: 1, floorMax: 5 });
  buildTower(world, script);
  return world;
}

function exitMinute(sim: Sim): number {
  const entry = sim.schedule.find((e) => e.goal.kind === 'exit');
  if (!entry) throw new Error(`worker ${sim.id} has no way home`);
  return entry.minuteOfDay;
}

describe('the evening rush is spread across 4:30 to 7:30 PM', () => {
  it('twenty offices go home in waves: each company together, the tower spread over three hours', () => {
    const world = twentyOffices();
    const offices = [...world.rooms.values()].filter((r): r is Room => r.kind === 'office');
    expect(offices).toHaveLength(20);

    // Every office leases on the first weekday morning; note who is at work at 4 PM.
    atOnDay(world, 0, 16, 0);
    expect(offices.every((o) => !o.vacant)).toBe(true);
    const workers = [...world.sims.values()].filter((s) => s.kind === 'worker');
    expect(workers).toHaveLength(20 * ROOMS.office.capacity);

    // Scheduled times: inside the window, one office's staff close together, the tower spread wide.
    const { leaveStart, leaveEnd, quitJitterMinutes } = SCHEDULES.worker;
    const times = workers.map(exitMinute);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(16 * 60 + 30);
    expect(Math.max(...times)).toBeLessThanOrEqual(19 * 60 + 30);
    expect(leaveStart).toBe(16 * 60 + 30);
    expect(leaveEnd).toBe(19 * 60 + 30);
    for (const office of offices) {
      const own = workers.filter((w) => w.homeRoomId === office.id).map(exitMinute);
      expect(Math.max(...own) - Math.min(...own)).toBeLessThanOrEqual(2 * quitJitterMinutes);
    }
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThanOrEqual(120);

    // Actual departures, minute by minute: the moment each worker walks out of the office.
    const leftAt = new Map<number, number>();
    const inOffice = new Set(workers.filter((w) => w.inRoomId === w.homeRoomId).map((w) => w.id));
    while (world.time.minute < 19 * 60 + 45) {
      runMinutes(world, 1);
      for (const id of [...inOffice]) {
        const sim = world.sims.get(id);
        if (sim && sim.inRoomId === sim.homeRoomId) continue;
        inOffice.delete(id);
        leftAt.set(id, world.time.minute % 1440);
      }
    }
    const left = [...leftAt.values()];
    expect(left.length).toBeGreaterThan(workers.length * 0.9);
    expect(Math.min(...left)).toBeGreaterThanOrEqual(16 * 60 + 30);
    expect(Math.max(...left)).toBeLessThanOrEqual(19 * 60 + 30 + 1);
    const buckets = new Map<number, number>();
    for (const m of left) buckets.set(Math.floor(m / 10), (buckets.get(Math.floor(m / 10)) ?? 0) + 1);
    expect(Math.max(...buckets.values())).toBeLessThanOrEqual(workers.length / 3);
  }, 60_000);
});
