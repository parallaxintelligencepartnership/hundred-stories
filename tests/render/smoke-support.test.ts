import { describe, expect, it, vi } from 'vitest';

// The demo world is pure sim data; the renderer it can boot is not needed here.
vi.mock('../../src/render/renderer', () => ({ createRenderer: vi.fn() }));

import { isHeldUp } from '../../src/sim/build';
import { animateDemo, buildDemoWorld, buildHeroWorld, walkRange } from '../../src/render/smoke';

describe('the demo world (landing hero and ?smoke)', () => {
  it('shows no room the build rules would refuse: every room rests on structure', () => {
    const world = buildDemoWorld();
    const floating = [...world.rooms.values()]
      .filter((room) => !isHeldUp(world, room))
      .map((room) => `${room.kind} on floor ${room.floor} at x ${room.x}`);
    expect(floating).toEqual([]);
  });

  it('paces each crowd inside its own floor: the hero between x 110 and 149, the ?smoke lobby 101.5 to 176', () => {
    const demo = buildDemoWorld();
    expect(walkRange(demo, 1)).toEqual({ min: 101.5, max: 176 });
    // The ?smoke condo floors end at x 175 (the shaft at 150 to 153 is inside), so their walkers turn at 173.
    expect(walkRange(demo, 4)).toEqual({ min: 101.5, max: 173 });
    const hero = buildHeroWorld();
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 60_000; t += 100) {
      animateDemo(hero, 100, { minutesPerMs: 0, fire: false });
      for (const sim of hero.sims.values()) {
        lo = Math.min(lo, sim.pos.x);
        hi = Math.max(hi, sim.pos.x);
      }
    }
    expect(lo).toBeGreaterThanOrEqual(110);
    expect(hi).toBeLessThanOrEqual(149);
    // They still walk the lobby end to end rather than stand about.
    expect(hi - lo).toBeGreaterThan(30);
  });

  it('keeps the hero floor 7 walkers within its condos plus the shaft', () => {
    const hero = buildHeroWorld();
    expect(walkRange(hero, 7)).toEqual({ min: 111.5, max: 147 });
    const onSeven = [...hero.sims.values()].filter((sim) => sim.pos.floor === 7);
    expect(onSeven.length).toBeGreaterThan(0);
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 60_000; t += 100) {
      animateDemo(hero, 100, { minutesPerMs: 0, fire: false });
      for (const sim of onSeven) {
        lo = Math.min(lo, sim.pos.x);
        hi = Math.max(hi, sim.pos.x);
      }
    }
    const condos = [...hero.rooms.values()].filter((room) => room.floor === 7);
    const shaft = [...hero.shafts.values()][0]!;
    expect(condos.map((room) => room.kind)).toEqual(['condo', 'condo']);
    expect(lo).toBeGreaterThanOrEqual(Math.min(...condos.map((room) => room.x)));
    expect(hi).toBeLessThanOrEqual(shaft.x + shaft.width);
  });
});
