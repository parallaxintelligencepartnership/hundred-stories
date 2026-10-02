// The guard who reaches the thief in the minute the thief boards a car (game readiness review
// 2026-10-01, Guards). The guard sent arrived on the thief's floor and tile while the thief
// stepped into the car at the same door, and the next check ruled the theft escaped because the
// thief was riding. Now a thief in a car whose doors are still open on the theft floor is caught
// by the guard sent, and taken off the car. Only the dispatched guard catches, as before.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EVENT_TEST_HOOKS, resetEventTestHooks, startTheft } from '../../src/sim/events';
import { deserialize, serialize } from '../../src/sim/save';
import { tick } from '../../src/sim/tick';
import type { ActiveEvent, Shaft, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { atOnDay, buildTower, lobbyRun } from './helpers';

type Theft = Extract<ActiveEvent, { kind: 'theft' }>;

beforeEach(() => {
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 0, theft: 0 };
});
afterEach(() => resetEventTestHooks());

function theftOf(world: World): Theft | undefined {
  return world.events.find((e): e is Theft => e.kind === 'theft');
}

function seatProblems(world: World): string[] {
  const out: string[] = [];
  const cars = new Map<number, Shaft['cars'][number]>();
  for (const shaft of world.shafts.values()) {
    for (const car of shaft.cars) {
      cars.set(car.id, car);
      for (const id of car.passengers) {
        const sim = world.sims.get(id);
        if (!sim) out.push(`car ${car.id}: seat for removed sim ${id}`);
        else if (sim.state !== 'riding') out.push(`car ${car.id}: sim ${id} aboard but ${sim.state}`);
        else if (sim.inCarId !== car.id) out.push(`car ${car.id}: sim ${id} has inCarId ${sim.inCarId}`);
      }
    }
  }
  for (const sim of world.sims.values()) {
    if (sim.inCarId !== null && !cars.get(sim.inCarId)?.passengers.includes(sim.id)) out.push(`sim ${sim.id} in car ${sim.inCarId} but not seated`);
  }
  return out;
}

/** One shaft 1 to 10, offices for support, the only shop on 9 and the security office on 10. */
function securityTower(): World {
  const world = createWorld(17);
  world.cash = 50_000_000;
  world.stars = 3;
  const script: Parameters<typeof buildTower>[1][number][] = [...lobbyRun(0, 200), { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 10 }];
  for (let f = 2; f <= 10; f++) {
    if (f === 9) script.push({ kind: 'build', room: 'shop', floor: 9, x: 100 });
    else if (f === 10) script.push({ kind: 'build', room: 'security', floor: 10, x: 100 });
    else script.push({ kind: 'build', room: 'office', floor: f, x: 100 }, { kind: 'build', room: 'office', floor: f, x: 109 });
  }
  buildTower(world, script);
  return world;
}

interface Outcome {
  result: 'caught' | 'escaped' | 'called off';
  raced: boolean;
  problems: string[];
  /** The caught thief's stop still on its car's call list with nobody else aboard bound there (review of P2, A3). */
  leftCalls: string[];
  /** Catches checked for that: the thief caught aboard with nobody else bound to its floor. */
  checked: number;
}

/** One theft from `enter` (minute of day) to its end, noting whether the guard sent met the thief at the car door. */
function runTheft(base: World, enter: number, alone = false): Outcome {
  const loaded = deserialize(serialize(base));
  if (!loaded.ok) throw new Error(loaded.reason);
  const w = loaded.world;
  startTheft(w, enter);
  const t0 = w.logTotal;
  let raced = false;
  const problems: string[] = [];
  const leftCalls: string[] = [];
  let checked = 0;
  for (let i = 0; i < 1440 && theftOf(w); i++) {
    const ev = theftOf(w) as Theft;
    const thief = ev.simId === null ? undefined : w.sims.get(ev.simId);
    const guard = ev.guardId === null ? undefined : w.sims.get(ev.guardId);
    // The race: the thief has just boarded on the theft floor, the guard sent stands on that floor by the car.
    if (thief && guard && ev.phase === 'leaving' && thief.state === 'riding' && guard.state !== 'riding' && guard.pos.floor === ev.floor && Math.abs(guard.pos.x - thief.pos.x) <= 1) raced = true;
    const leg = thief?.state === 'riding' ? thief.route[0] : undefined;
    const ride = thief && leg?.kind === 'ride' && thief.inCarId !== null ? { carId: thief.inCarId, toFloor: leg.toFloor } : null;
    const carOf = (id: number) => [...w.shafts.values()].flatMap((sh) => sh.cars).find((c) => c.id === id);
    if (alone && raced && ride) {
      // Everyone else aboard bound to the thief's floor leaves the tower, so the thief's call is its own.
      const car = carOf(ride.carId);
      for (const id of [...(car?.passengers ?? [])]) {
        const next = w.sims.get(id)?.route[0];
        if (id === thief?.id || next?.kind !== 'ride' || next.toFloor !== ride.toFloor) continue;
        if (car) car.passengers = car.passengers.filter((p) => p !== id);
        w.sims.delete(id);
      }
    }
    const caughtBefore = w.logTotal;
    tick(w);
    problems.push(...seatProblems(w));
    const caughtNow = w.log.slice(Math.max(0, w.log.length - (w.logTotal - caughtBefore))).some((l) => l.text.startsWith('Thief caught'));
    if (ride && caughtNow) {
      const car = carOf(ride.carId);
      const wanted = car?.passengers.some((id) => {
        if (id === thief?.id) return false;
        const next = w.sims.get(id)?.route[0];
        return next?.kind === 'ride' && next.toFloor === ride.toFloor;
      });
      if (car && !wanted) {
        checked += 1;
        if (car.calls.has(ride.toFloor)) leftCalls.push(`car ${car.id} still stops at ${ride.toFloor}`);
      }
    }
  }
  const lines = w.log.slice(Math.max(0, w.log.length - (w.logTotal - t0))).map((l) => l.text);
  const result = lines.some((t) => t.startsWith('Thief caught')) ? 'caught' : lines.some((t) => t.startsWith('Thief escaped')) ? 'escaped' : 'called off';
  return { result, raced, problems, leftCalls, checked };
}

describe('the guard and the thief at the car door', () => {
  it('a guard sent who reaches the thief in the minute it boards catches it, and the car keeps no seat for it', () => {
    const base = securityTower();
    atOnDay(base, 0, 6, 1);
    let races = 0;
    // The same twenty entry times the review used, across 10:00 to 19:59.
    for (let k = 0; k < 20; k++) {
      const out = runTheft(base, 10 * 60 + ((k * 47) % 600));
      expect(out.problems).toEqual([]);
      if (out.raced) {
        races += 1;
        expect(out.result).toBe('caught');
        expect(out.leftCalls).toEqual([]);
      }
    }
    expect(races).toBeGreaterThan(0);
  });

  it('the caught thief takes its car call with it when nobody else aboard is bound there (review of P2, A3)', () => {
    const base = securityTower();
    atOnDay(base, 0, 6, 1);
    let checked = 0;
    for (let k = 0; k < 20; k++) {
      const out = runTheft(base, 10 * 60 + ((k * 47) % 600), true);
      expect(out.problems).toEqual([]);
      expect(out.leftCalls).toEqual([]);
      checked += out.checked;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
