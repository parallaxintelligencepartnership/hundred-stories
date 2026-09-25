// A tower that did not start with the standard cash keeps its start in the build log, so a
// replay begins from the same place. A standard tower's log is written exactly as before.
import { describe, expect, it } from 'vitest';
import { applyAndRecord, buildLogFromSave, buildLogOf, buildLogToSave, startBuildLog } from '../../src/sim/buildlog';
import { markCheckpoint, verifySave } from '../../src/sim/replay';
import { serialize } from '../../src/sim/save';
import { tick } from '../../src/sim/tick';
import { createWorld } from '../../src/sim/world';

function run(start: { cash?: number }): string {
  const world = createWorld(31, start);
  startBuildLog(world, 'full', { start, mode: 'daily:2026-09-28' });
  expect(applyAndRecord(world, { kind: 'build', room: 'lobby', floor: 1, x: 150 }).ok).toBe(true);
  for (let i = 0; i < 200; i++) tick(world);
  markCheckpoint(world);
  return serialize(world);
}

describe('the start in the build log', () => {
  it('replays a tower that began with less cash to the same world', () => {
    const text = run({ cash: 1_000_000 });
    expect(verifySave(text)).toMatchObject({ status: 'match', entries: 1 });
  });

  it('carries the start and the mode through a save, and leaves a standard log unchanged', () => {
    const world = createWorld(31, { cash: 1_000_000 });
    startBuildLog(world, 'full', { start: { cash: 1_000_000 }, mode: 'daily:2026-09-28' });
    const saved = buildLogToSave(world);
    expect(saved).toMatchObject({ start: { cash: 1_000_000 }, mode: 'daily:2026-09-28' });
    expect(buildLogFromSave(JSON.parse(JSON.stringify(saved)))).toMatchObject({ unavailable: null, start: { cash: 1_000_000 }, mode: 'daily:2026-09-28' });

    const plain = createWorld(31);
    startBuildLog(plain, 'full');
    expect(Object.keys(buildLogToSave(plain)).sort()).toEqual(['checks', 'edition', 'entries', 'format', 'unavailable']);
    expect(buildLogOf(plain).start).toBeUndefined();
  });

  it('marks a log with a damaged start as damaged, never refusing the tower', () => {
    const world = createWorld(31);
    startBuildLog(world, 'full', { start: { cash: 5 } });
    const saved = { ...buildLogToSave(world), start: { cash: 'lots' } };
    expect(buildLogFromSave(saved).unavailable).toBe('damaged');
  });
});
