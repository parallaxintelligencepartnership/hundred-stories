/**
 * A bomb whose room a fire destroyed before it went off.
 *
 * The only security office catches fire at the 06:00 roll and the bomb sits in the office
 * next door. The fire burns both rooms down. Until 2026-09-28 the bomb then went off in the
 * lobby's first tiles; from 2026-09-28 it went off where it was planted. Matt, 2026-09-29:
 * the bomb is gone with its room. The fire ends the threat: no 1 PM blast, no loss, no ransom.
 */
import { describe, expect, it } from 'vitest';

import { EVENTS } from '../../src/sim/rules';
import { BOMB_BURNED_TEXT, handleEventCommand, startBomb } from '../../src/sim/events';
import { createWorld, setOnFire } from '../../src/sim/world';
import { buildTower, lobbyRun, runMinutes } from './helpers';

const DAY = 1440;

/** A fire in the bomb's own room at 6 AM on day 1, with no security in the tower. */
function bombRoomOnFire() {
  const world = createWorld(99);
  world.cash = 50_000_000;
  buildTower(world, [...lobbyRun(150, 243), { kind: 'build', room: 'office', floor: 2, x: 187 }]);
  const bombRoom = [...world.rooms.values()].find((r) => r.kind === 'office')!;
  runMinutes(world, DAY + 360 - world.time.minute);
  const m0 = world.time.minute;
  setOnFire(world, bombRoom, true);
  world.events.push({ kind: 'fire', roomIds: [bombRoom.id], startedAt: m0, spreadAt: m0 + EVENTS.fire.spreadMinutes });
  world.events.push({
    kind: 'bomb', roomId: bombRoom.id, ransom: EVENTS.bomb.ransom, detonateAt: DAY + EVENTS.bomb.detonateAtMinuteOfDay,
    found: false, floor: bombRoom.floor, x: bombRoom.x,
  });
  return { world, bombRoom };
}

describe('a bomb in a room the fire took: said once, ended at once', () => {
  it('writes the line and the beat once when the fire burns out in its room during a tick', () => {
    const { world, bombRoom } = bombRoomOnFire();
    while (world.rooms.has(bombRoom.id) && world.time.minute < DAY + 13 * 60) runMinutes(world, 1);
    expect(world.rooms.has(bombRoom.id)).toBe(false);
    runMinutes(world, 5);
    expect(world.log.filter((l) => l.text === BOMB_BURNED_TEXT)).toHaveLength(1);
    expect(world.story.recent.filter((b) => b.code === 'bomb.resolved')).toHaveLength(1);
  });

  it('ends with the helicopter call itself, before any tick, when the helicopter clears its room', () => {
    const { world, bombRoom } = bombRoomOnFire();
    expect(handleEventCommand(world, { kind: 'fire.callHelicopter' })).toEqual({ ok: true });
    expect(world.rooms.has(bombRoom.id)).toBe(false);
    expect(world.events.some((e) => e.kind === 'bomb')).toBe(false);
    expect(world.log.filter((l) => l.text === BOMB_BURNED_TEXT)).toHaveLength(1);
  });
});

describe('a bomb in a room the fire took', () => {
  it('ends when the fire takes its room: no blast at 1 PM, no loss, a log line and a beat', () => {
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
    // Run until the fire has taken the bomb's room.
    while (world.rooms.has(bombRoom.id) && world.time.minute < DAY + 13 * 60) runMinutes(world, 1);
    expect(world.rooms.has(bombRoom.id)).toBe(false);
    expect(world.time.minute).toBeLessThan(DAY + EVENTS.bomb.detonateAtMinuteOfDay);
    // At once, in the same minute the room burned.
    expect(world.events.some((e) => e.kind === 'bomb')).toBe(false);
    const fireOut = world.log.find((l) => / burned down and clearing the damage cost /.test(l.text));
    const line = world.log.find((l) => l.text === BOMB_BURNED_TEXT);
    expect(fireOut).toBeDefined();
    expect(line?.minute).toBe(fireOut?.minute);
    expect(world.story.recent.some((b) => b.code === 'bomb.resolved' && b.roomId === bombRoom.id && b.minute === fireOut?.minute)).toBe(true);
    runMinutes(world, DAY + 13 * 60 - 1 - world.time.minute);
    const cash = world.cash;
    const standing = new Set(world.rooms.keys());
    runMinutes(world, 3);
    expect(world.cash).toBe(cash);
    expect(world.stats.lossesByKind.bomb ?? 0).toBe(0);
    expect(world.stats.lossesByKind.ransom ?? 0).toBe(0);
    expect([...standing].every((id) => world.rooms.has(id))).toBe(true);
    expect(world.log.some((l) => l.text.startsWith('The bomb went off'))).toBe(false);
    expect(world.story.recent.some((b) => b.code === 'bomb.failed')).toBe(false);
  });

  it('ends on the next tick when a save holds a bomb whose room already burned', () => {
    const world = createWorld(99);
    world.cash = 50_000_000;
    buildTower(world, [...lobbyRun(150, 243), { kind: 'build', room: 'office', floor: 2, x: 187 }]);
    runMinutes(world, DAY + 12 * 60 - world.time.minute);
    const rooms = world.rooms.size;
    const cash = world.cash;
    // Saved under the 2026-09-28 rule: the fire took room 9999 and the bomb stayed pending.
    world.events.push({
      kind: 'bomb', roomId: 9999, ransom: EVENTS.bomb.ransom, detonateAt: DAY + EVENTS.bomb.detonateAtMinuteOfDay,
      found: false, floor: 2, x: 187,
    });
    runMinutes(world, 1);
    expect(world.events.some((e) => e.kind === 'bomb')).toBe(false);
    expect(world.log.some((l) => l.text === BOMB_BURNED_TEXT)).toBe(true);
    runMinutes(world, 62);
    expect(world.rooms.size).toBe(rooms);
    expect(world.stats.lossesByKind.bomb ?? 0).toBe(0);
    expect(world.log.some((l) => l.text.startsWith('The bomb went off'))).toBe(false);
    expect(cash - world.cash).toBeLessThan(EVENTS.bomb.damageCash);
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
