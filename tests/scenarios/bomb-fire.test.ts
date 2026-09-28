/**
 * A bomb whose room a fire destroyed before it went off (audit 2026-09-28, lane C S2).
 *
 * The only security office catches fire at the 06:00 roll and the bomb sits in the office
 * next door. The fire burns both rooms down; at 13:00 the bomb used to go off in the ground
 * lobby's first tiles (the lowest room ids, the entrance end) and named floor 1. It goes
 * off where it was planted.
 */
import { describe, expect, it } from 'vitest';

import { EVENTS } from '../../src/sim/rules';
import { startBomb } from '../../src/sim/events';
import { createWorld, setOnFire } from '../../src/sim/world';
import { buildTower, lobbyRun, runMinutes } from './helpers';

const DAY = 1440;

describe('a bomb in a room the fire took', () => {
  it('goes off on its own floor and leaves the lobby doors standing', () => {
    const world = createWorld(99);
    world.cash = 50_000_000;
    buildTower(world, [...lobbyRun(150, 243), { kind: 'shaft.build', shaft: 'standard', x: 160, floorMin: 1, floorMax: 6 }]);
    world.stars = 3;
    buildTower(world, [
      { kind: 'build', room: 'security', floor: 2, x: 170 },
      { kind: 'build', room: 'office', floor: 2, x: 187 },
      { kind: 'build', room: 'office', floor: 2, x: 215 },
    ]);
    const rooms = [...world.rooms.values()];
    const sec = rooms.find((r) => r.kind === 'security')!;
    const bombRoom = rooms.find((r) => r.kind === 'office' && r.x === 187)!;
    runMinutes(world, DAY + 360 - world.time.minute);
    const m0 = world.time.minute;
    setOnFire(world, sec, true);
    world.events.push({ kind: 'fire', roomIds: [sec.id], startedAt: m0, spreadAt: m0 + EVENTS.fire.spreadMinutes });
    // Written as startBomb writes it.
    world.events.push({
      kind: 'bomb', roomId: bombRoom.id, ransom: EVENTS.bomb.ransom, detonateAt: DAY + EVENTS.bomb.detonateAtMinuteOfDay,
      found: false, floor: bombRoom.floor, x: bombRoom.x,
    });
    runMinutes(world, DAY + 13 * 60 + 2 - world.time.minute);
    expect(world.rooms.has(bombRoom.id)).toBe(false);
    const lobbyXs = new Set([...world.rooms.values()].filter((r) => r.kind === 'lobby').map((r) => r.x));
    const missing: number[] = [];
    for (let x = 150; x <= 243; x++) if (!lobbyXs.has(x)) missing.push(x);
    // Ranked by the planted position, as when the room stands: the far office on floor 2,
    // then the lobby tiles straight below the bomb. The lobby ends (the doors) stand.
    expect(lobbyXs.has(150) && lobbyXs.has(243)).toBe(true);
    expect(missing.every((x) => Math.abs(x - bombRoom.x) <= 3)).toBe(true);
    const went = world.log.find((l) => l.text.startsWith('The bomb went off'));
    expect(went?.text).toMatch(/^The bomb went off on floor 2\./);
  });

  it('records where it was planted', () => {
    const world = createWorld(99);
    world.cash = 50_000_000;
    buildTower(world, [...lobbyRun(150, 243), { kind: 'build', room: 'office', floor: 2, x: 187 }]);
    startBomb(world);
    const bomb = world.events.find((e) => e.kind === 'bomb');
    expect(bomb).toBeDefined();
    if (bomb?.kind !== 'bomb') return;
    const room = world.rooms.get(bomb.roomId)!;
    expect(bomb.floor).toBe(room.floor);
    expect(bomb.x).toBe(room.x);
  });
});
