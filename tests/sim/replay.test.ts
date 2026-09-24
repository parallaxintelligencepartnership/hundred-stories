// The build log and replay: a tower rebuilt from its starting number and its logged commands
// reaches the same world hash as the tower that was played.

import fixture from '../../store/fixtures/demo-tower.json?raw';
import { describe, expect, it } from 'vitest';
import {
  applyAndRecord,
  buildLogOf,
  decodeCommand,
  encodeCommand,
  encodeEntries,
  startBuildLog,
} from '../../src/sim/buildlog';
import { editionCanReplay, markCheckpoint, replay, verifySave } from '../../src/sim/replay';
import { deserialize, hashWorld, serialize, SAVE_VERSION } from '../../src/sim/save';
import { tick } from '../../src/sim/tick';
import type { Command, CommandKind, Id, Room, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';

const SEED = 12345;
const DAY = 1440;
const SHAFT_X = 176;

function runTo(world: World, minute: number): void {
  while (world.time.minute < minute) tick(world);
}

function must(world: World, cmd: Command): void {
  const result = applyAndRecord(world, cmd);
  if (!result.ok) throw new Error(`${JSON.stringify(cmd)} refused: ${result.reason}`);
}

function officeAt(world: World, floor: number, x: number): Room {
  const room = [...world.rooms.values()].find((r) => r.kind === 'office' && r.floor === floor && r.x === x);
  if (!room) throw new Error(`no office on floor ${floor} at x ${x}`);
  return room;
}

/**
 * Three days of play: builds, elevator edits, a rent change, a late build and its demolition.
 * Hashes are taken at minutes where no command follows in the same minute, so a replay to that
 * minute holds exactly the same commands.
 */
function playScenario(): { world: World; hashes: { t: number; h: string }[] } {
  const world = createWorld(SEED);
  startBuildLog(world, 'full');
  const hashes: { t: number; h: string }[] = [];
  const note = () => hashes.push({ t: world.time.minute, h: hashWorld(world) });

  for (let x = 150; x <= 200; x++) must(world, { kind: 'build', room: 'lobby', floor: 1, x });
  must(world, { kind: 'shaft.build', shaft: 'standard', x: SHAFT_X, floorMin: 1, floorMax: 6 });
  for (let floor = 2; floor <= 5; floor++) for (const x of [158, 185]) must(world, { kind: 'build', room: 'office', floor, x });

  runTo(world, 12 * 60);
  note();
  markCheckpoint(world);
  runTo(world, 12 * 60 + 30);
  const shaft = [...world.shafts.values()][0] as { id: Id };
  must(world, { kind: 'shaft.addCar', shaftId: shaft.id });
  must(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 3, stops: false });
  must(world, { kind: 'shaft.setHome', shaftId: shaft.id, floor: 2 });
  const cars = world.shafts.get(shaft.id)!.cars;
  must(world, { kind: 'shaft.setCarServes', shaftId: shaft.id, carId: cars[1]!.id, serves: 'office' });
  must(world, { kind: 'shaft.setCarRange', shaftId: shaft.id, carId: cars[1]!.id, range: { lo: 1, hi: 4 } });
  must(world, { kind: 'room.setRent', roomId: officeAt(world, 2, 158).id, rent: 120 });

  runTo(world, DAY + 9 * 60);
  note();
  runTo(world, DAY + 9 * 60 + 15);
  must(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 3, stops: true });

  // A late office, taken down again before anyone moves in, and the car's range cleared once it is empty.
  runTo(world, DAY + 23 * 60);
  must(world, { kind: 'shaft.setCarRange', shaftId: shaft.id, carId: cars[1]!.id, range: null });
  must(world, { kind: 'build', room: 'office', floor: 6, x: 158 });
  runTo(world, DAY + 23 * 60 + 30);
  markCheckpoint(world);
  must(world, { kind: 'demolish', roomId: officeAt(world, 6, 158).id });

  runTo(world, 2 * DAY + 8 * 60);
  note();
  markCheckpoint(world);
  return { world, hashes };
}

describe('build log encoding', () => {
  it('round trips one command of every kind', () => {
    const samples = {
      build: { kind: 'build', room: 'office', floor: 2, x: 40 },
      demolish: { kind: 'demolish', roomId: 7 },
      'shaft.build': { kind: 'shaft.build', shaft: 'express', x: 10, floorMin: -2, floorMax: 30 },
      'shaft.demolish': { kind: 'shaft.demolish', shaftId: 3 },
      'shaft.extend': { kind: 'shaft.extend', shaftId: 3, floorMin: 1, floorMax: 9 },
      'shaft.addCar': { kind: 'shaft.addCar', shaftId: 3 },
      'shaft.removeCar': { kind: 'shaft.removeCar', shaftId: 3 },
      'shaft.setStop': { kind: 'shaft.setStop', shaftId: 3, floor: 4, stops: false },
      'shaft.setHome': { kind: 'shaft.setHome', shaftId: 3, floor: 4 },
      'shaft.setCarServes': { kind: 'shaft.setCarServes', shaftId: 3, carId: 4, serves: 'hotel' },
      'shaft.setCarRange': { kind: 'shaft.setCarRange', shaftId: 3, carId: 4, range: { lo: 2, hi: 8 } },
      'room.setRent': { kind: 'room.setRent', roomId: 7, rent: 130 },
      'bomb.pay': { kind: 'bomb.pay' },
      'fire.callHelicopter': { kind: 'fire.callHelicopter' },
    } satisfies { [K in CommandKind]: Extract<Command, { kind: K }> };
    for (const cmd of Object.values(samples) as Command[]) expect(decodeCommand(encodeCommand(cmd))).toEqual(cmd);
    const cleared: Command = { kind: 'shaft.setCarRange', shaftId: 3, carId: 4, range: null };
    expect(decodeCommand(encodeCommand(cleared))).toEqual(cleared);
  });

  it('stores each tick as the gap since the entry before', () => {
    const encoded = encodeEntries([
      { t: 360, cmd: { kind: 'build', room: 'lobby', floor: 1, x: 5 } },
      { t: 360, cmd: { kind: 'build', room: 'lobby', floor: 1, x: 6 } },
      { t: 2000, cmd: { kind: 'room.setRent', roomId: 9, rent: 90 } },
    ]);
    expect(encoded).toEqual([
      [360, 'b', 'lobby', 1, 5],
      [0, 'b', 'lobby', 1, 6],
      [1640, 'r', 9, 90],
    ]);
  });

  it('keeps accepted commands only', () => {
    const world = createWorld(SEED);
    startBuildLog(world, 'full');
    expect(applyAndRecord(world, { kind: 'build', room: 'lobby', floor: 1, x: 150 }).ok).toBe(true);
    expect(applyAndRecord(world, { kind: 'build', room: 'lobby', floor: 1, x: 150 }).ok).toBe(false);
    expect(buildLogOf(world).entries).toEqual([{ t: 360, cmd: { kind: 'build', room: 'lobby', floor: 1, x: 150 } }]);
  });
});

describe('replay', () => {
  const played = playScenario();
  const text = serialize(played.world);

  it('reaches the played hash at several ticks', () => {
    const entries = buildLogOf(played.world).entries;
    expect(entries.length).toBe(51 + 1 + 8 + 6 + 2 + 2);
    expect(played.hashes.length).toBe(3);
    for (const { t, h } of played.hashes) {
      const { world, refused } = replay(SEED, 'full', entries, t);
      expect(refused).toEqual([]);
      expect(world.time.minute).toBe(t);
      expect(hashWorld(world)).toBe(h);
    }
  });

  it('writes save v5 with the log beside the world, and leaves the hash alone', () => {
    expect(SAVE_VERSION).toBe(5);
    const data = JSON.parse(text);
    expect(data.version).toBe(5);
    expect(data.buildLog.unavailable).toBe(null);
    expect(data.buildLog.entries.length).toBe(70);
    expect(data.buildLog.checks.length).toBe(3);
    // The same world with an empty log hashes the same: the log is not in the projection.
    const loaded = deserialize(text);
    if (!loaded.ok) throw new Error(loaded.reason);
    const before = hashWorld(loaded.world);
    buildLogOf(loaded.world).entries.length = 0;
    expect(hashWorld(loaded.world)).toBe(before);
    expect(before).toBe(played.hashes[2]!.h);
  });

  it('verifies the save: replay matches its world hash and every checkpoint', () => {
    const result = verifySave(text);
    expect(result).toEqual({ status: 'match', tick: 2 * DAY + 8 * 60, hash: played.hashes[2]!.h, entries: 70, checkpoints: 3 });
  });

  it('names the tick of a tampered entry the replay refuses', () => {
    const data = JSON.parse(text);
    // Entry 52 is the first office (floor 2, x 158). Move it onto the second one at x 185.
    expect(data.buildLog.entries[52]).toEqual([0, 'b', 'office', 2, 158]);
    data.buildLog.entries[52] = [0, 'b', 'office', 2, 185];
    const result = verifySave(JSON.stringify(data));
    expect(result.status).toBe('mismatch');
    if (result.status !== 'mismatch') return;
    expect(result.refused?.index).toBe(53);
    expect(result.divergedAt).toBe(360);
    expect(result.lastMatch).toBe(null);
  });

  it('names the first checkpoint past a tampered entry the replay accepts', () => {
    const data = JSON.parse(text);
    // The rent change at 12:30 on day one: 120 becomes 130, still a legal rent.
    const index = data.buildLog.entries.findIndex((e: unknown[]) => e[1] === 'r');
    expect(data.buildLog.entries[index].slice(3)).toEqual([120]);
    data.buildLog.entries[index][3] = 130;
    const result = verifySave(JSON.stringify(data));
    expect(result.status).toBe('mismatch');
    if (result.status !== 'mismatch') return;
    expect(result.refused).toBe(null);
    expect(result.lastMatch).toBe(12 * 60); // the checkpoint before the change still matched
    expect(result.divergedAt).toBe(DAY + 23 * 60 + 30); // the next one did not
    expect(result.actual).not.toBe(result.expected);
  });

  it('loads a v4 save with an empty log and replay unavailable', () => {
    const data = JSON.parse(text);
    data.version = 4;
    delete data.buildLog;
    const loaded = deserialize(JSON.stringify(data));
    if (!loaded.ok) throw new Error(loaded.reason);
    expect(buildLogOf(loaded.world)).toMatchObject({ unavailable: 'startedBeforeLog', entries: [], checks: [] });
    expect(hashWorld(loaded.world)).toBe(played.hashes[2]!.h);
    expect(verifySave(JSON.stringify(data))).toEqual({ status: 'unavailable', why: 'startedBeforeLog' });
    // The committed demo tower is a v4 save too.
    expect(verifySave(fixture)).toEqual({ status: 'unavailable', why: 'startedBeforeLog' });
  });

  it('still loads a save whose log is damaged, with replay off', () => {
    const data = JSON.parse(text);
    data.buildLog.entries[3] = [0, 'nope'];
    const loaded = deserialize(JSON.stringify(data));
    if (!loaded.ok) throw new Error(loaded.reason);
    expect(buildLogOf(loaded.world).unavailable).toBe('damaged');
    expect(verifySave(JSON.stringify(data))).toEqual({ status: 'unavailable', why: 'damaged' });
  });

  it('keeps the log intact through save, load, more play and save again', () => {
    const loaded = deserialize(text);
    if (!loaded.ok) throw new Error(loaded.reason);
    const world = loaded.world;
    must(world, { kind: 'room.setRent', roomId: officeAt(world, 3, 185).id, rent: 80 });
    runTo(world, 3 * DAY + 8 * 60);
    markCheckpoint(world);
    const again = JSON.parse(serialize(world));
    const first = JSON.parse(text);
    expect(again.buildLog.entries.slice(0, 70)).toEqual(first.buildLog.entries);
    expect(again.buildLog.entries.length).toBe(71);
    expect(again.buildLog.checks.slice(0, 3)).toEqual(first.buildLog.checks);
    expect(again.buildLog.checks.length).toBe(4);
    expect(verifySave(JSON.stringify(again))).toMatchObject({ status: 'match', entries: 71 });
  });

  it('refuses to replay a web or full log inside the demo', () => {
    expect(editionCanReplay('demo', 'full')).toBe(true);
    expect(editionCanReplay('web', 'full')).toBe(true);
    expect(editionCanReplay('demo', 'demo')).toBe(true);
    expect(editionCanReplay('full', 'demo')).toBe(false);
  });
});
