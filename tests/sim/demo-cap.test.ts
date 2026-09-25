// The demo cap (store round S1): floors 1 to 20, basements to -2, the middle 150 tiles of the lot.
// Only the demo edition refuses; node resolves to the full edition so the bench hashes hold.

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as fullBuild from '../../src/sim/build';
import * as fullRules from '../../src/sim/rules';
import * as fullWorld from '../../src/sim/world';
import type { CommandResult, World } from '../../src/sim/types';

type BuildModule = typeof fullBuild;
type WorldModule = typeof fullWorld;

interface Sim {
  build: BuildModule;
  world: WorldModule;
}

/** The sim as the demo build compiles it: VITE_EDITION=demo, modules loaded fresh. */
async function demoSim(): Promise<Sim> {
  vi.stubEnv('VITE_EDITION', 'demo');
  vi.resetModules();
  const rules = await import('../../src/sim/rules');
  expect(rules.EDITION).toBe('demo');
  return { build: await import('../../src/sim/build'), world: await import('../../src/sim/world') };
}

const FULL: Sim = { build: fullBuild, world: fullWorld };

/** A lobby across the band's middle and an office on every floor 2 to 20, so floor 21 has support. */
function tower({ build, world: w }: Sim): World {
  const world = w.createWorld(42);
  world.cash = 1_000_000_000;
  world.stars = 6;
  for (let x = 140; x < 200; x += 1) expect(build.applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x })).toEqual({ ok: true });
  for (let floor = 2; floor <= 20; floor += 1) {
    expect(build.applyCommand(world, { kind: 'build', room: 'office', floor, x: 150 })).toEqual({ ok: true });
  }
  expect(build.applyCommand(world, { kind: 'build', room: 'parkingSpace', floor: -1, x: 150 })).toEqual({ ok: true });
  expect(build.applyCommand(world, { kind: 'build', room: 'parkingSpace', floor: -2, x: 150 })).toEqual({ ok: true });
  return world;
}

const refused = (res: CommandResult): void => {
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.code).toBe('demoCap');
    expect(res.reason).toBe(fullRules.DEMO_CAP_REASON);
  }
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('edition', () => {
  it('defaults to the full game in node, and to web in a browser build with no flag', () => {
    expect(fullRules.EDITION).toBe('full');
    expect(fullRules.resolveEdition(undefined, true)).toBe('full');
    expect(fullRules.resolveEdition(undefined, false)).toBe('web');
    expect(fullRules.resolveEdition('demo', true)).toBe('demo');
    expect(fullRules.resolveEdition('web', true)).toBe('web');
    expect(fullRules.resolveEdition('nonsense', false)).toBe('web');
  });

  it('names the cap figures from the decision: 20 floors, basement 2, the middle 150 of 375 tiles', () => {
    expect(fullRules.DEMO_MAX_FLOOR).toBe(20);
    expect(fullRules.DEMO_MIN_FLOOR).toBe(-2);
    expect(fullRules.DEMO_MAX_WIDTH_TILES).toBe(150);
    expect(fullRules.DEMO_X_MIN).toBe(112);
    expect(fullRules.DEMO_X_MAX).toBe(261);
    expect(fullRules.DEMO_X_MAX - fullRules.DEMO_X_MIN + 1).toBe(150);
    // Centred: the spare tiles either side differ by at most one.
    expect(Math.abs(fullRules.DEMO_X_MIN - (375 - 1 - fullRules.DEMO_X_MAX))).toBeLessThanOrEqual(1);
  });
});

describe('the demo cap on', () => {
  it('refuses a room above floor 20 or below basement 2, and the ghost says the same', async () => {
    const sim = await demoSim();
    const world = tower(sim);
    refused(sim.build.canBuild(world, 'office', 21, 150));
    refused(sim.build.applyCommand(world, { kind: 'build', room: 'office', floor: 21, x: 150 }));
    refused(sim.build.applyCommand(world, { kind: 'build', room: 'parkingSpace', floor: -3, x: 150 }));
    expect(world.rooms.size).toBe(60 + 19 + 2);
  });

  it('refuses a room with any tile outside the band', async () => {
    const sim = await demoSim();
    const world = tower(sim);
    refused(sim.build.applyCommand(world, { kind: 'build', room: 'office', floor: 2, x: 111 }));
    refused(sim.build.applyCommand(world, { kind: 'build', room: 'office', floor: 2, x: 254 }));
    refused(sim.build.applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x: 262 }));
  });

  it('allows rooms within the box, edge tiles included', async () => {
    const sim = await demoSim();
    const world = tower(sim);
    // A lobby tile under each edge office, so each rests on something.
    expect(sim.build.applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x: 120 })).toEqual({ ok: true });
    expect(sim.build.applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x: 253 })).toEqual({ ok: true });
    expect(sim.build.applyCommand(world, { kind: 'build', room: 'office', floor: 2, x: 112 })).toEqual({ ok: true });
    expect(sim.build.applyCommand(world, { kind: 'build', room: 'office', floor: 2, x: 253 })).toEqual({ ok: true });
    expect(sim.build.applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x: 261 })).toEqual({ ok: true });
  });

  it('caps elevators likewise: building and stretching', async () => {
    const sim = await demoSim();
    const world = tower(sim);
    refused(sim.build.applyCommand(world, { kind: 'shaft.build', shaft: 'standard', x: 170, floorMin: 1, floorMax: 21 }));
    refused(sim.build.applyCommand(world, { kind: 'shaft.build', shaft: 'standard', x: 110, floorMin: 1, floorMax: 5 }));
    refused(sim.build.applyCommand(world, { kind: 'shaft.build', shaft: 'service', x: 170, floorMin: -3, floorMax: 1 }));
    expect(sim.build.applyCommand(world, { kind: 'shaft.build', shaft: 'standard', x: 170, floorMin: 1, floorMax: 15 })).toEqual({ ok: true });
    const shaft = [...world.shafts.values()][0];
    if (!shaft) throw new Error('no shaft');
    expect(sim.build.canExtendShaft(world, shaft.id, 1, 20)).toEqual({ ok: true });
    refused(sim.build.applyCommand(world, { kind: 'shaft.extend', shaftId: shaft.id, floorMin: 1, floorMax: 21 }));
  });

  // Audit 2026-09-25 I S8: every case above uses one-floor rooms, so a cap that checked only
  // a room's base floor passed. A cinema on floor 20 has its top floor at 21.
  it('I S8: refuses a two-floor cinema on floor 20, whose top floor is 21', async () => {
    const { build, world: w } = await demoSim();
    const world = w.createWorld(42);
    world.cash = 1_000_000_000;
    world.stars = 6;
    for (let x = 140; x < 200; x += 1) expect(build.applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x })).toEqual({ ok: true });
    for (let floor = 2; floor <= 19; floor += 1) {
      for (const x of [150, 159, 168]) expect(build.applyCommand(world, { kind: 'build', room: 'office', floor, x })).toEqual({ ok: true });
    }
    const rooms = world.rooms.size;
    refused(build.applyCommand(world, { kind: 'build', room: 'cinema', floor: 20, x: 150 }));
    expect(world.rooms.size).toBe(rooms);
  });
});

describe('the full edition', () => {
  it('allows both: above the floor cap and outside the band', () => {
    const world = tower(FULL);
    expect(fullBuild.applyCommand(world, { kind: 'build', room: 'office', floor: 21, x: 150 })).toEqual({ ok: true });
    // A lobby tile outside the band holds up the office outside the band.
    expect(fullBuild.applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x: 104 })).toEqual({ ok: true });
    expect(fullBuild.applyCommand(world, { kind: 'build', room: 'office', floor: 2, x: 100 })).toEqual({ ok: true });
    expect(fullBuild.applyCommand(world, { kind: 'build', room: 'office', floor: 2, x: 150 + 9 })).toEqual({ ok: true });
    expect(fullBuild.applyCommand(world, { kind: 'shaft.build', shaft: 'standard', x: 170, floorMin: 1, floorMax: 21 })).toEqual({ ok: true });
  });
});
