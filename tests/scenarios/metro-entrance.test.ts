/**
 * A metro under the lobby before any shaft reaches it (audit 2026-09-28, lane B S2).
 *
 * The metro is an entrance, but a metro no car reaches is no way in and no way out: a
 * worker who came up from it, or a resident who left through it, found no route home and
 * the lease ended with "no way in" although the lobby reaches the room.
 */
import { describe, expect, it } from 'vitest';

import { entrances } from '../../src/sim/routing';
import type { Command, RoomKind, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { atOnDay, buildTower, lobbyRun, runDays, runMinutes } from './helpers';

function metroTower(kind: RoomKind, metroFloorMax: number | null): World {
  const world = createWorld(21);
  world.cash = 50_000_000;
  world.stars = 4;
  const script: Command[] = [...lobbyRun(100, 300)];
  if (metroFloorMax === null) script.push({ kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 10 });
  else script.push({ kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: metroFloorMax, floorMax: 10 });
  script.push({ kind: 'build', room: 'metro', floor: -3, x: 190 });
  script.push({ kind: 'build', room: kind, floor: 2, x: 200 });
  buildTower(world, script);
  return world;
}

const texts = (world: World, from = 0) => world.log.slice(from).map((e) => e.text);

describe('a metro no car reaches', () => {
  it('lets an office lease once and keep its workers through the morning', () => {
    const world = metroTower('office', null);
    expect(entrances(world).some((p) => p.floor === -3)).toBe(true);
    atOnDay(world, 3, 8, 0);
    const from = world.log.length;
    atOnDay(world, 3, 9, 30);
    const office = [...world.rooms.values()].find((r) => r.kind === 'office')!;
    expect(texts(world, from).filter((t) => t.includes('no way in'))).toEqual([]);
    expect(texts(world).filter((t) => t.includes('was rented'))).toHaveLength(1);
    expect(office.vacant).toBe(false);
  });

  it('sells a condo exactly once in ten days', () => {
    const world = metroTower('condo', null);
    runDays(world, 10);
    expect(texts(world).filter((t) => t.includes('was sold'))).toHaveLength(1);
    expect(texts(world).filter((t) => t.includes('no way in'))).toEqual([]);
  });

  it('still brings people in by a metro a shaft does reach', () => {
    const world = metroTower('office', -3);
    atOnDay(world, 3, 7, 0);
    let seenBelow = 0;
    for (let i = 0; i < 150; i++) {
      runMinutes(world, 1);
      for (const sim of world.sims.values()) if (sim.kind === 'worker' && sim.pos.floor === -3) seenBelow += 1;
    }
    expect(seenBelow).toBeGreaterThan(0);
  });
});
